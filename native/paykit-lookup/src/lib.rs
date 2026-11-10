//! Native entry points for public Paykit Payment List lookups.
//!
//! Every entry point blocks its calling thread and answers with one JSON
//! envelope: `{"ok":[{"appId","identifier","payload"}]}` in the order the
//! lookup returned, or `{"error":{"code","message"}}`.

use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use paykit_discovery::{get_payment_list, Error, PaymentEndpoint};
use serde_json::{json, Value};
use tokio::runtime::{Builder, Runtime};

const INVALID_PUBKY: &str = "INVALID_PUBKY";
const LOOKUP_FAILED: &str = "LOOKUP_FAILED";

fn runtime() -> Result<&'static Runtime, std::io::Error> {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    if let Some(runtime) = RUNTIME.get() {
        return Ok(runtime);
    }
    // A failed build is not cached, so a later call can try again.
    let runtime = Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("paykit-lookup")
        .enable_all()
        .build()?;
    Ok(RUNTIME.get_or_init(|| runtime))
}

fn ok_envelope(endpoints: &[PaymentEndpoint]) -> String {
    let list: Vec<Value> = endpoints
        .iter()
        .map(|endpoint| {
            json!({
                "appId": endpoint.app_id,
                "identifier": endpoint.identifier,
                "payload": endpoint.payload,
            })
        })
        .collect();
    json!({ "ok": list }).to_string()
}

fn error_envelope(code: &str, message: &str) -> String {
    json!({ "error": { "code": code, "message": message } }).to_string()
}

fn lookup_error_envelope(error: &Error) -> String {
    let code = match error {
        Error::InvalidPubky => INVALID_PUBKY,
        _ => LOOKUP_FAILED,
    };
    error_envelope(code, &error.to_string())
}

fn invalid_pubky_envelope() -> String {
    lookup_error_envelope(&Error::InvalidPubky)
}

/// Look up `pubky` and return the envelope. Blocks until the lookup settles.
fn lookup(pubky: &str) -> String {
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let runtime = match runtime() {
            Ok(runtime) => runtime,
            Err(error) => {
                return error_envelope(
                    LOOKUP_FAILED,
                    &format!("could not start the lookup runtime: {error}"),
                )
            }
        };
        match runtime.block_on(get_payment_list(pubky)) {
            Ok(endpoints) => ok_envelope(&endpoints),
            Err(error) => lookup_error_envelope(&error),
        }
    }));
    outcome.unwrap_or_else(|_| error_envelope(LOOKUP_FAILED, "the lookup stopped unexpectedly"))
}

/// Look up the Payment List of the NUL-terminated UTF-8 `pubky`.
///
/// Returns a NUL-terminated JSON envelope that the caller hands back to
/// [`chicory_paykit_free`], or null if the envelope could not be allocated.
///
/// # Safety
///
/// `pubky` must be null or point to a NUL-terminated string that stays valid
/// for the whole call.
#[no_mangle]
pub unsafe extern "C" fn chicory_paykit_get_payment_list(pubky: *const c_char) -> *mut c_char {
    let envelope = if pubky.is_null() {
        invalid_pubky_envelope()
    } else {
        match CStr::from_ptr(pubky).to_str() {
            Ok(pubky) => lookup(pubky),
            Err(_) => invalid_pubky_envelope(),
        }
    };
    // serde_json escapes NUL, so this only fails if that ever changes.
    CString::new(envelope).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Free an envelope returned by [`chicory_paykit_get_payment_list`].
///
/// # Safety
///
/// `envelope` must be null or a pointer this library returned that has not
/// been freed yet.
#[no_mangle]
pub unsafe extern "C" fn chicory_paykit_free(envelope: *mut c_char) {
    if !envelope.is_null() {
        drop(CString::from_raw(envelope));
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JObject, JString};
    use jni::sys::jstring;
    use jni::JNIEnv;

    /// `PaykitDiscoveryModule.nativeGetPaymentList(String): String?`
    #[no_mangle]
    pub extern "system" fn Java_com_chicory_PaykitDiscoveryModule_nativeGetPaymentList<'local>(
        mut env: JNIEnv<'local>,
        _this: JObject<'local>,
        pubky: JString<'local>,
    ) -> jstring {
        let envelope = match env.get_string(&pubky) {
            Ok(pubky) => super::lookup(&String::from(pubky)),
            Err(_) => super::invalid_pubky_envelope(),
        };
        // Null tells the caller the envelope could not cross into the JVM.
        env.new_string(envelope)
            .map_or(std::ptr::null_mut(), JString::into_raw)
    }
}

#[cfg(target_os = "android")]
mod android_tls {
    use jni22::errors::Error;
    use jni22::objects::JObject;
    use jni22::sys::{jboolean, jobject, JNIEnv};
    use jni22::{EnvUnowned, Outcome};

    /// `PaykitDiscoveryModule.nativeInit(Context): Boolean`
    ///
    /// Hands the app's context to the platform certificate verifier, which the
    /// relay and homeserver connections fail without. Safe to call again.
    ///
    /// # Safety
    ///
    /// Called by the JVM as a native method, with its own `env` and a local
    /// reference to an `android.content.Context`.
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_chicory_PaykitDiscoveryModule_nativeInit(
        env: *mut JNIEnv,
        _this: jobject,
        context: jobject,
    ) -> jboolean {
        if env.is_null() || context.is_null() {
            return false as jboolean;
        }
        let mut unowned = EnvUnowned::from_raw(env);
        let outcome = unowned
            .with_env(|env| -> Result<(), Error> {
                let context = JObject::from_raw(env, context);
                rustls_platform_verifier::android::init_with_env(env, context)
            })
            .into_outcome();
        matches!(outcome, Outcome::Ok(())) as jboolean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(envelope: &str) -> Value {
        serde_json::from_str(envelope).expect("the envelope is JSON")
    }

    fn call(pubky: &str) -> Value {
        let input = CString::new(pubky).unwrap();
        // SAFETY: `input` outlives the call and the result is freed once.
        unsafe {
            let raw = chicory_paykit_get_payment_list(input.as_ptr());
            assert!(!raw.is_null());
            let envelope = parse(CStr::from_ptr(raw).to_str().unwrap());
            chicory_paykit_free(raw);
            envelope
        }
    }

    #[test]
    fn ok_envelope_keeps_order_and_field_names() {
        let endpoints = [
            PaymentEndpoint {
                app_id: "zeta".into(),
                identifier: "btc-lightning-bolt12".into(),
                payload: "lno1\"quoted\"\n".into(),
            },
            PaymentEndpoint {
                app_id: "alpha".into(),
                identifier: "btc-bitcoin-p2tr".into(),
                payload: "bc1p".into(),
            },
        ];
        assert_eq!(
            parse(&ok_envelope(&endpoints)),
            json!({ "ok": [
                { "appId": "zeta", "identifier": "btc-lightning-bolt12", "payload": "lno1\"quoted\"\n" },
                { "appId": "alpha", "identifier": "btc-bitcoin-p2tr", "payload": "bc1p" },
            ] })
        );
    }

    #[test]
    fn empty_list_is_an_empty_array() {
        assert_eq!(ok_envelope(&[]), r#"{"ok":[]}"#);
    }

    #[test]
    fn error_envelope_carries_code_and_display_text() {
        assert_eq!(
            parse(&lookup_error_envelope(&Error::ResourceLimit)),
            json!({ "error": {
                "code": "LOOKUP_FAILED",
                "message": Error::ResourceLimit.to_string(),
            } })
        );
    }

    #[test]
    fn invalid_pubky_is_rejected_without_network() {
        for input in ["", "not a pubky", "pubky://example/pub/paykit"] {
            assert_eq!(
                call(input),
                json!({ "error": {
                    "code": "INVALID_PUBKY",
                    "message": Error::InvalidPubky.to_string(),
                } }),
                "{input:?}"
            );
        }
    }

    #[test]
    fn null_and_non_utf8_input_are_invalid_pubkys() {
        // SAFETY: null is allowed, and the byte string is NUL-terminated.
        let envelopes = unsafe {
            [
                chicory_paykit_get_payment_list(std::ptr::null()),
                chicory_paykit_get_payment_list(b"\xff\xfe\0".as_ptr().cast()),
            ]
        };
        for raw in envelopes {
            // SAFETY: `raw` came from the call above and is freed once.
            let envelope = unsafe {
                let envelope = parse(CStr::from_ptr(raw).to_str().unwrap());
                chicory_paykit_free(raw);
                envelope
            };
            assert_eq!(envelope["error"]["code"], "INVALID_PUBKY");
        }
    }
}
