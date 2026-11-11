package com.chicory

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

private const val PICK_IMAGE = 0x43A7

class QrImageModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "ChicoryQrImage"

    private val decoder = Executors.newSingleThreadExecutor()
    // Accessed on the UI thread. The picker grants temporary access to one URI.
    private var pending: Promise? = null
    private val listener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != PICK_IMAGE) return
            val promise = pending ?: return
            pending = null
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) {
                promise.resolve(null)
                return
            }
            decoder.execute { decode(uri, promise) }
        }
    }

    init { context.addActivityEventListener(listener) }

    @ReactMethod fun pick(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity
            if (activity == null || activity.isFinishing || pending != null) {
                promise.reject("PICKER_UNAVAILABLE", "Could not open the image picker.")
                return@runOnUiThread
            }
            try {
                val intent = PickVisualMedia().createIntent(activity, PickVisualMediaRequest(PickVisualMedia.ImageOnly))
                pending = promise
                activity.startActivityForResult(intent, PICK_IMAGE)
            } catch (error: Exception) {
                pending = null
                promise.reject("PICKER_UNAVAILABLE", "Could not open the image picker.")
            }
        }
    }

    private fun decode(uri: Uri, promise: Promise) {
        try {
            // The bundled decoder runs locally. fromFilePath handles EXIF rotation.
            val image = InputImage.fromFilePath(context, uri)
            val options = BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
            val scanner = BarcodeScanning.getClient(options)
            scanner.process(image)
                .addOnSuccessListener { codes ->
                    val values = Arguments.createArray()
                    for (code in codes) code.rawValue?.let(values::pushString)
                    promise.resolve(values)
                }
                .addOnFailureListener { promise.reject("IMAGE_UNREADABLE", "Could not read the QR image.") }
                .addOnCompleteListener { scanner.close() }
        } catch (error: Exception) {
            promise.reject("IMAGE_UNREADABLE", "Could not read the QR image.")
        }
    }

    override fun invalidate() {
        context.removeActivityEventListener(listener)
        UiThreadUtil.runOnUiThread {
            decoder.shutdown()
            pending?.resolve(null)
            pending = null
        }
        super.invalidate()
    }
}

class QrImagePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(QrImageModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
