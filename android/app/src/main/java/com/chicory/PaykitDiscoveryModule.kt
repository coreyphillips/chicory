package com.chicory

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import kotlinx.coroutines.*
import org.json.JSONObject

/** Public Paykit Payment List lookups, answered by the paykit_lookup Rust library. Nothing is stored. */
class PaykitDiscoveryModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    // Each lookup blocks its thread until the network answers, so keep them off the JS and UI threads.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    override fun getName() = "PaykitDiscovery"

    private external fun nativeGetPaymentList(pubky: String): String?
    private external fun nativeInit(context: android.content.Context): Boolean

    @ReactMethod fun getPaymentList(pubky: String, promise: Promise) {
        scope.launch {
            // Throwable, because a missing library is an UnsatisfiedLinkError, not an Exception.
            val envelope = try {
                // Loaded here, not at class load, so a build without the library fails this call and not the app start.
                System.loadLibrary("paykit_lookup")
                // The library checks certificates with Android's own verifier, which it reaches through the app's context.
                if (!nativeInit(reactApplicationContext.applicationContext)) error("The certificate verifier could not start")
                JSONObject(nativeGetPaymentList(pubky) ?: error("The lookup returned nothing"))
            } catch (e: Throwable) {
                promise.reject("LOOKUP_FAILED", e.message ?: "The lookup failed", e)
                return@launch
            }
            val failure = envelope.optJSONObject("error")
            val list = envelope.optJSONArray("ok")
            when {
                failure != null -> promise.reject(
                    if (failure.optString("code") == "INVALID_PUBKY") "INVALID_PUBKY" else "LOOKUP_FAILED",
                    failure.optString("message", "The lookup failed"),
                )
                list != null -> promise.resolve(list.toString())
                else -> promise.reject("LOOKUP_FAILED", "The lookup answer could not be read")
            }
        }
    }

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }
}

class PaykitDiscoveryPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PaykitDiscoveryModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
