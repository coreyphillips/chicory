package com.chicory

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
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
import java.io.IOException
import java.util.concurrent.Executors

private const val PICK_IMAGE = 0x43A7
private const val MAX_SIDE = 4096
private const val MAX_PIXELS = 4L * 1024 * 1024

/** Bound the bitmap before allocating it, including very long screenshots. */
private fun sampleSize(width: Int, height: Int): Int {
    require(width > 0 && height > 0)
    var sample = 1
    while (true) {
        val w = (width.toLong() + sample - 1) / sample
        val h = (height.toLong() + sample - 1) / sample
        if (w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_PIXELS) return sample
        sample *= 2
    }
}

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

    private fun loadBitmap(uri: Uri): Bitmap {
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // ImageDecoder applies EXIF rotation and mirroring as it samples.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetSampleSize(sampleSize(info.size.width, info.size.height))
            }
        }

        // On Android 7 and 8, inspect dimensions without loading pixels first.
        fun input() = resolver.openInputStream(uri) ?: throw IOException()
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        input().use { BitmapFactory.decodeStream(it, null, options) }
        options.inSampleSize = sampleSize(options.outWidth, options.outHeight)
        options.inJustDecodeBounds = false
        val orientation = try {
            input().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }
        } catch (_: IOException) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val bitmap = input().use { BitmapFactory.decodeStream(it, null, options) } ?: throw IOException()
        val transform = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> transform.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> transform.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> transform.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                transform.setScale(-1f, 1f)
                transform.postRotate(270f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> transform.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                transform.setScale(-1f, 1f)
                transform.postRotate(90f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> transform.setRotate(270f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, transform, true)
            .also { if (it !== bitmap) bitmap.recycle() }
    }

    private fun decode(uri: Uri, promise: Promise) {
        try {
            val bitmap = loadBitmap(uri)
            val image = InputImage.fromBitmap(bitmap, 0)
            val options = BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
            val scanner = BarcodeScanning.getClient(options)
            scanner.process(image)
                .addOnSuccessListener { codes ->
                    val values = Arguments.createArray()
                    for (code in codes) code.rawValue?.let(values::pushString)
                    promise.resolve(values)
                }
                .addOnFailureListener { promise.reject("IMAGE_UNREADABLE", "Could not read the QR image.") }
                .addOnCompleteListener {
                    scanner.close()
                    bitmap.recycle()
                }
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
