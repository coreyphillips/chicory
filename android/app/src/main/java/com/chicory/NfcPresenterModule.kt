package com.chicory

import android.app.Activity
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ViewManager
import java.lang.ref.WeakReference

/**
 * Presents the request Receive shows as an NFC tag, for as long as Receive asks (docs/TAP-TO-PAY.md). The message
 * comes from JavaScript as bytes (src/services/ndef.ts) and is served by NfcPresenterService without being read.
 *
 * A request is presented only between `present` and `withdraw`, only while the activity is in front, and never
 * past the time it expires. The module withdraws by itself as the activity pauses and as the request runs out,
 * since JavaScript may be paused by then and a request must not outlive its screen.
 *
 * While it presents, the service is the one Android prefers for the NDEF application, so a phone with another
 * app that acts as a tag shows no chooser.
 */
class NfcPresenterModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    override fun getName() = "ChicoryNfcPresenter"

    private val main = Handler(Looper.getMainLooper())
    private val runOut = Runnable { withdrawNow() }

    // Both are touched on the UI thread only.
    private var claimed = false
    private var preferredOn: WeakReference<Activity>? = null

    init {
        context.addLifecycleEventListener(this)
        // A process that ended while it presented left its claim behind.
        UiThreadUtil.runOnUiThread {
            if (canPresent() && !Presented.any(System.currentTimeMillis())) NfcPresenterService.release(context)
        }
    }

    private fun adapter(): NfcAdapter? = try {
        NfcAdapter.getDefaultAdapter(context)
    } catch (_: Exception) {
        null
    }

    private fun canPresent(): Boolean = try {
        adapter() != null && context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
    } catch (_: Exception) {
        false
    }

    /** This phone cannot act as a tag, NFC is switched off, or it can. */
    @ReactMethod fun status(promise: Promise) {
        promise.resolve(
            when {
                !canPresent() -> "missing"
                adapter()?.isEnabled != true -> "off"
                else -> "ready"
            },
        )
    }

    /**
     * Answers a reader with `message`, a whole NDEF message as base64, until `expiresAt`, in place of whatever was
     * presented. Resolves "presented", or the code of why it is not. A refusal leaves nothing presented, not the
     * request before.
     */
    @ReactMethod fun present(message: String, expiresAt: Double, promise: Promise) {
        val bytes = try {
            Base64.decode(message, Base64.DEFAULT)
        } catch (_: Exception) {
            null
        }
        UiThreadUtil.runOnUiThread {
            val now = System.currentTimeMillis()
            val until = expiresAt.toLong()
            val activity = context.currentActivity
            val emulation = if (canPresent()) NfcPresenterService.emulation(context) else null
            val refusal = when {
                bytes == null || bytes.isEmpty() || bytes.size > PresentedTag.MAX_MESSAGE -> "TAP_TOO_LARGE"
                emulation == null || adapter()?.isEnabled != true -> "TAP_OFF"
                activity == null || activity.isFinishing ||
                    context.lifecycleState != LifecycleState.RESUMED -> "TAP_NOT_IN_FRONT"
                until <= now -> "TAP_EXPIRED"
                else -> null
            }
            if (refusal != null || bytes == null || emulation == null || activity == null) {
                refuse(refusal ?: "TAP_REFUSED", promise)
                return@runOnUiThread
            }
            try {
                main.removeCallbacks(runOut)
                Presented.put(bytes, until)
                claimed = true
                val registered = emulation.registerAidsForService(
                    NfcPresenterService.component(context),
                    CardEmulation.CATEGORY_OTHER,
                    listOf(PresentedTag.NDEF_APPLICATION_NAME),
                )
                if (!registered) {
                    refuse("TAP_REFUSED", promise)
                    return@runOnUiThread
                }
                val preferred = prefer(emulation, activity)
                main.postDelayed(runOut, until - now)
                Log.i(
                    NfcPresenterService.LOG,
                    "presenting ${bytes.size} bytes for ${(until - now) / 1000}s" +
                        if (preferred) "" else ", not as the preferred service",
                )
                promise.resolve("presented")
            } catch (_: Exception) {
                refuse("TAP_REFUSED", promise)
            }
        }
    }

    /** Called on the UI thread. Nothing is left presented, and JavaScript is told why. */
    private fun refuse(code: String, promise: Promise) {
        withdrawNow()
        Log.i(NfcPresenterService.LOG, "not presenting: $code")
        promise.resolve(code)
    }

    /** Presents nothing from now. */
    @ReactMethod fun withdraw(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            withdrawNow()
            promise.resolve(null)
        }
    }

    /**
     * Has Android prefer this service while `activity` is in front, and answers whether it does. Without it another
     * app that acts as a tag may be offered beside the wallet.
     */
    private fun prefer(emulation: CardEmulation, activity: Activity): Boolean {
        if (preferredOn?.get() === activity) return true
        try {
            if (emulation.setPreferredService(activity, NfcPresenterService.component(context))) {
                preferredOn = WeakReference(activity)
            }
        } catch (_: Exception) {
            // The phone's owner keeps another service first. The request is still presented.
        }
        return preferredOn?.get() === activity
    }

    /** Called on the UI thread. What is presented goes first, so nothing is read while the claim is given back. */
    private fun withdrawNow() {
        main.removeCallbacks(runOut)
        Presented.clear()
        val activity = preferredOn?.get()
        preferredOn = null
        if (activity != null) {
            try {
                NfcPresenterService.emulation(context)?.unsetPreferredService(activity)
            } catch (_: Exception) {
                // The activity has left the front, and Android has dropped the preference with it.
            }
        }
        if (claimed) {
            claimed = false
            NfcPresenterService.release(context)
            Log.i(NfcPresenterService.LOG, "withdrawn")
        }
    }

    override fun onHostResume() {}

    // Called from the activity's own onPause, while Android still counts it as in front.
    override fun onHostPause() {
        withdrawNow()
    }

    override fun onHostDestroy() {
        UiThreadUtil.runOnUiThread { withdrawNow() }
    }

    override fun invalidate() {
        context.removeLifecycleEventListener(this)
        UiThreadUtil.runOnUiThread { withdrawNow() }
        super.invalidate()
    }
}

class NfcPresenterPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(NfcPresenterModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
