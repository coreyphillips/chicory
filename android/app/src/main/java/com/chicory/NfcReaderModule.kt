package com.chicory

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Build
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.uimanager.ViewManager
import java.lang.ref.WeakReference

/** Larger than any payment request, and small enough to hand to JavaScript whole. */
private const val MAX_MESSAGE_BYTES = 8 * 1024

/**
 * How long a tag just read must be gone before Android offers it again. The
 * scanner closes as it takes a request, and a phone still held to the tag
 * would otherwise have it offered a second time, as a link.
 */
private const val SAME_TAG_QUIET_MS = 1500

/**
 * Reads the NDEF message of a tag held to the phone while the payment scanner
 * is open (docs/TAP-TO-PAY.md), and hands its records to JavaScript untouched.
 * What a record says is decided there, in src/services/ndef.ts.
 *
 * Android reads the tag before this hears of it: its NFC service runs the tag's
 * own procedure, loops the chunked reads and reads the message to its end, so
 * nothing here speaks to a tag. The reader never asks Android to skip that
 * read, since a terminal counts a tap only once its message has been read
 * whole.
 *
 * While it listens the radio is the app's: Android offers a tag to no other
 * app, and the phone's own card payments are off. So it listens only between
 * `read` and `cancel`, and only while the activity is in front, which Android
 * sees to itself.
 */
class NfcReaderModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    override fun getName() = "ChicoryNfc"

    // Both are touched on the UI thread only.
    private var pending: Promise? = null
    private var listening: WeakReference<Activity>? = null

    private val onTag = NfcAdapter.ReaderCallback { tag -> discovered(tag) }

    init { context.addLifecycleEventListener(this) }

    private fun adapter(): NfcAdapter? = try {
        NfcAdapter.getDefaultAdapter(context)
    } catch (_: Exception) {
        null
    }

    /** No NFC in this phone, NFC switched off, or ready to read. */
    @ReactMethod fun status(promise: Promise) {
        val adapter = adapter()
        promise.resolve(
            when {
                adapter == null -> "missing"
                !adapter.isEnabled -> "off"
                else -> "ready"
            },
        )
    }

    /**
     * The records of the next tag held to the phone. The radio stays the app's
     * after it answers, until `cancel`, so a tag that was refused is not
     * offered to another app while the scanner is still open. `prompt` is for
     * the iPhone's sheet, and Android draws none.
     */
    @ReactMethod fun read(@Suppress("UNUSED_PARAMETER") prompt: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            // One read at a time. A newer one takes over from an older one.
            pending?.reject("TAP_CANCELLED", "Another read began.")
            pending = null
            val adapter = adapter()
            val activity = context.currentActivity
            if (adapter == null || !adapter.isEnabled || activity == null || activity.isFinishing) {
                promise.reject("TAP_FAILED", "NFC is unavailable.")
                return@runOnUiThread
            }
            try {
                if (listening?.get() !== activity) {
                    stopListening()
                    adapter.enableReaderMode(
                        activity,
                        onTag,
                        NfcAdapter.FLAG_READER_NFC_A or
                            NfcAdapter.FLAG_READER_NFC_B or
                            NfcAdapter.FLAG_READER_NFC_F or
                            NfcAdapter.FLAG_READER_NFC_V or
                            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
                        null,
                    )
                    listening = WeakReference(activity)
                }
                pending = promise
            } catch (_: Exception) {
                stopListening()
                promise.reject("TAP_FAILED", "NFC is unavailable.")
            }
        }
    }

    /** Ends a read and gives the radio back. */
    @ReactMethod fun cancel(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            stop()
            promise.resolve(null)
        }
    }

    /** Called on a binder thread, with the tag's message already read by Android. */
    private fun discovered(tag: Tag) {
        val adapter = adapter()
        if (adapter != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                adapter.ignore(tag, SAME_TAG_QUIET_MS, null, null)
            } catch (_: Exception) {
                // The debounce is a courtesy. JavaScript drops a repeat as well.
            }
        }
        var records: WritableArray? = null
        var failure = "TAP_NO_NDEF"
        try {
            val message = Ndef.get(tag)?.cachedNdefMessage
            if (message != null) {
                if (message.byteArrayLength > MAX_MESSAGE_BYTES) {
                    failure = "TAP_TOO_LARGE"
                } else {
                    val list = Arguments.createArray()
                    for (record in message.records) {
                        val entry = Arguments.createMap()
                        entry.putInt("tnf", record.tnf.toInt())
                        entry.putString("type", Base64.encodeToString(record.type, Base64.NO_WRAP))
                        entry.putString("payload", Base64.encodeToString(record.payload, Base64.NO_WRAP))
                        list.pushMap(entry)
                    }
                    records = list
                }
            }
        } catch (_: Exception) {
            failure = "TAP_FAILED"
        }
        UiThreadUtil.runOnUiThread {
            // A tag that arrives between two reads is let go: the scanner was
            // busy with the one before it.
            val promise = pending ?: return@runOnUiThread
            pending = null
            if (records != null) promise.resolve(records)
            else promise.reject(failure, "The tag gave no payment request.")
        }
    }

    private fun stopListening() {
        val activity = listening?.get()
        listening = null
        if (activity == null) return
        try {
            adapter()?.disableReaderMode(activity)
        } catch (_: Exception) {
            // The activity has gone, and its reader mode with it.
        }
    }

    private fun stop() {
        pending?.reject("TAP_CANCELLED", "The read was called off.")
        pending = null
        stopListening()
    }

    override fun onHostResume() {}

    override fun onHostPause() {}

    override fun onHostDestroy() {
        UiThreadUtil.runOnUiThread { stop() }
    }

    override fun invalidate() {
        context.removeLifecycleEventListener(this)
        UiThreadUtil.runOnUiThread { stop() }
        super.invalidate()
    }
}

class NfcReaderPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(NfcReaderModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
