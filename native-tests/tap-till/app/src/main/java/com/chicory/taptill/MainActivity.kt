package com.chicory.taptill

import android.app.Activity
import android.content.ComponentName
import android.graphics.Color
import android.graphics.Typeface
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The till's one screen: the request it presents, the first bytes of the message it is presented in, and what the
 * phones held to it have read. Paste any request, press Present, and hold a phone to this one with this screen on.
 */
class MainActivity : Activity() {
    private lateinit var request: EditText
    private lateinit var bytes: TextView
    private lateinit var readers: TextView
    private lateinit var radio: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A reader finds the till only while its screen is on.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3, pad, pad)
        }
        fun label(text: String) = TextView(this).apply {
            this.text = text
            setTextColor(Color.BLACK)
            setPadding(0, pad, 0, pad / 4)
            setTypeface(typeface, Typeface.BOLD)
        }
        // Bytes are set against a report by eye, so they are drawn dark.
        fun mono() = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            setTextColor(Color.BLACK)
            setTextIsSelectable(true)
        }
        radio = TextView(this).apply { setTextColor(Color.BLACK) }
        request = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            typeface = Typeface.MONOSPACE
            textSize = 12f
            gravity = Gravity.TOP
            minLines = 4
            setText(Till.load(this@MainActivity))
        }
        val present = Button(this).apply {
            text = getString(R.string.present)
            setOnClickListener { present() }
        }
        bytes = mono()
        readers = mono()
        column.addView(radio, MATCH_PARENT, WRAP_CONTENT)
        column.addView(label(getString(R.string.request)), MATCH_PARENT, WRAP_CONTENT)
        column.addView(request, MATCH_PARENT, WRAP_CONTENT)
        column.addView(present, WRAP_CONTENT, WRAP_CONTENT)
        column.addView(label(getString(R.string.bytes)), MATCH_PARENT, WRAP_CONTENT)
        column.addView(bytes, MATCH_PARENT, WRAP_CONTENT)
        column.addView(label(getString(R.string.readers)), MATCH_PARENT, WRAP_CONTENT)
        column.addView(readers, MATCH_PARENT, WRAP_CONTENT)
        setContentView(ScrollView(this).apply { addView(column) })
        draw()
    }

    private fun present() {
        // The request is presented exactly as typed, but for the space round it.
        val text = request.text.toString().trim()
        try {
            Till.present(this, text)
        } catch (error: IllegalArgumentException) {
            readers.text = error.message
            return
        }
        draw()
    }

    private fun draw() {
        val adapter = NfcAdapter.getDefaultAdapter(this)
        radio.text = getString(
            when {
                adapter == null -> R.string.no_nfc
                !adapter.isEnabled -> R.string.nfc_off
                !packageManager.hasSystemFeature("android.hardware.nfc.hce") -> R.string.no_hce
                else -> R.string.ready
            },
        )
        val file = Till.tag.file
        val message = file.copyOfRange(2, file.size)
        bytes.text = getString(
            R.string.message,
            message.size,
            message.take(24).joinToString(" ") { "%02X".format(it.toInt() and 0xFF) },
            (message.size + Type4Tag.MAX_READ - 1 + 2) / Type4Tag.MAX_READ,
        )
        readers.text = getString(R.string.counts, Till.taps, Till.complete, Till.last.ifEmpty { getString(R.string.none) })
    }

    override fun onResume() {
        super.onResume()
        Till.onChange = { draw() }
        // With this screen in front the till answers for the NDEF application, whatever else is installed.
        NfcAdapter.getDefaultAdapter(this)?.let { adapter ->
            try {
                CardEmulation.getInstance(adapter).setPreferredService(this, ComponentName(this, TillService::class.java))
            } catch (_: Exception) {
                // A phone without card emulation says so on the first line.
            }
        }
        draw()
    }

    override fun onPause() {
        Till.onChange = null
        NfcAdapter.getDefaultAdapter(this)?.let { adapter ->
            try {
                CardEmulation.getInstance(adapter).unsetPreferredService(this)
            } catch (_: Exception) {
                // Nothing was preferred.
            }
        }
        super.onPause()
    }
}
