//! Print the envelope for one Pubky: `cargo run --example lookup -- <pubky>`.

use std::ffi::{CStr, CString};

// The library builds only as a static and a dynamic library, which an example
// cannot link, so its source is compiled in.
#[allow(dead_code)]
#[path = "../src/lib.rs"]
mod paykit_lookup;

fn main() {
    let pubky = std::env::args().nth(1).expect("usage: lookup <pubky>");
    let input = CString::new(pubky).expect("the pubky has no NUL byte");
    // SAFETY: `input` outlives the call and the result is freed once.
    unsafe {
        let raw = paykit_lookup::chicory_paykit_get_payment_list(input.as_ptr());
        assert!(!raw.is_null(), "no envelope was returned");
        println!("{}", CStr::from_ptr(raw).to_string_lossy());
        paykit_lookup::chicory_paykit_free(raw);
    }
}
