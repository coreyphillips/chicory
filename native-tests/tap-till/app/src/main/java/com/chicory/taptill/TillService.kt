package com.chicory.taptill

import android.content.Context
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/** What the till presents and what readers have done with it, shared by the service and the screen. */
object Till {
    private const val PREFERENCES = "till"
    private const val REQUEST = "request"

    /**
     * What the till presents until it is given a request: the invoice the wallet's own tests read, for 24,425 sats,
     * in capitals as a till writes one. Everything after its amount is zeros, so it names nobody to pay: a wallet
     * can take it into its review and can never pay it.
     */
    const val SAMPLE = "lightning:LNBC244250N1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQW53ADF"

    @Volatile var tag: Type4Tag = Type4Tag(SAMPLE)
        private set

    /** Reads that began: each time a reader chose the NDEF application. */
    @Volatile var taps = 0

    /** Taps in which the reader was given the last byte of the file. */
    @Volatile var complete = 0

    /** The last tap, for the screen: how many reads, how far, and whether to the end. */
    @Volatile var last: String = ""

    @Volatile var onChange: (() -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())

    fun load(context: Context): String {
        val saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(REQUEST, null)
        val request = saved ?: SAMPLE
        tag = Type4Tag(request)
        return request
    }

    /** Presents `request` from now on. Throws when it is too long for the tag. */
    fun present(context: Context, request: String) {
        tag = Type4Tag(request)
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(REQUEST, request).apply()
        taps = 0
        complete = 0
        last = ""
        changed()
    }

    fun changed() {
        main.post { onChange?.invoke() }
    }
}

/**
 * Answers a phone held to this one as the tag would. Android hands over each command once a reader has chosen the
 * NDEF application, which res/xml/apdu_service.xml registers.
 */
class TillService : HostApduService() {
    private var counted = false

    override fun onCreate() {
        super.onCreate()
        Till.load(this)
    }

    override fun processCommandApdu(command: ByteArray, extras: Bundle?): ByteArray {
        val tag = Till.tag
        val choosing = command.size > 3 &&
            (command[1].toInt() and 0xFF) == Type4Tag.INS_SELECT &&
            (command[2].toInt() and 0xFF) == Type4Tag.SELECT_BY_NAME
        val answer = tag.answer(command)
        if (choosing && answer.contentEquals(Type4Tag.OK)) {
            Till.taps += 1
            counted = false
        }
        if (tag.reachedEnd && !counted) {
            counted = true
            Till.complete += 1
        }
        Till.last = "${tag.reads} reads, ${tag.readTo} of ${tag.file.size} bytes, " +
            if (tag.reachedEnd) "read to the end" else "not yet read to the end"
        Till.changed()
        return answer
    }

    override fun onDeactivated(reason: Int) {
        val tag = Till.tag
        if (tag.reads > 0 && !tag.reachedEnd) {
            Till.last = "${tag.reads} reads, ${tag.readTo} of ${tag.file.size} bytes, left before the end"
        }
        Till.changed()
    }
}
