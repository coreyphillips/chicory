package com.chicory

import android.content.ComponentName
import android.content.Context
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Answers a phone held to this one as an NFC tag holding the request Receive shows (docs/TAP-TO-PAY.md).
 *
 * Android hands a reader's commands here once it has chosen an application this service is registered for. The
 * manifest registers it for a private placeholder only, which no reader asks for. The module claims the NDEF
 * application while a request is presented and gives it back as the request goes, so with no request on screen
 * the wallet claims nothing a reader looks for.
 *
 * Whatever the registration says, a reader is answered from what is presented now, and with nothing presented it
 * is told there is no such application. A claim left behind by a process that ended while it presented is given
 * back the first time a reader finds it.
 */
class NfcPresenterService : HostApduService() {
    override fun processCommandApdu(command: ByteArray, extras: Bundle?): ByteArray {
        val now = System.currentTimeMillis()
        if (!Presented.any(now)) {
            // After the answer, so the reader is not kept waiting on it. A request presented in between keeps
            // its claim: the module presents on this same thread, so it is looked for again before letting go.
            Handler(Looper.getMainLooper()).post {
                if (!Presented.any(System.currentTimeMillis())) release(applicationContext)
            }
        }
        return Presented.answer(command, now)
    }

    override fun onDeactivated(reason: Int) {
        Presented.readerLeft()?.let { Log.i(LOG, "a reader left after $it") }
    }

    companion object {
        /** What the presenter says in the phone's log: codes, counts and sizes, never a request. */
        const val LOG = "ChicoryNfc"

        fun component(context: Context) = ComponentName(context, NfcPresenterService::class.java)

        fun emulation(context: Context): CardEmulation? = try {
            NfcAdapter.getDefaultAdapter(context)?.let { CardEmulation.getInstance(it) }
        } catch (_: Exception) {
            null
        }

        /** Gives the NDEF application back, so the service answers for its placeholder alone. */
        fun release(context: Context) {
            try {
                emulation(context)?.removeAidsForService(component(context), CardEmulation.CATEGORY_OTHER)
            } catch (_: Exception) {
                // No NFC, or its service has gone. There is then no claim to give back.
            }
        }
    }
}
