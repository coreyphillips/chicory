package com.chicory

/**
 * A request presented as an NFC Forum Type 4 tag, so a phone held to this one
 * reads it (docs/TAP-TO-PAY.md): the NDEF application, a capability container
 * that allows 255 bytes a read, and a read-only NDEF file holding one message.
 *
 * The message is written in JavaScript (src/services/ndef.ts) and is served
 * here as bytes. Nothing in this file reads it, and nothing in it touches
 * Android, so the unit tests read the tag as a phone would.
 *
 * It answers one command at a time, and remembers which file a reader chose.
 * A new request is a new tag, so a reader part way through an old one is
 * refused its next read rather than handed the rest of another request.
 */
internal class PresentedTag(message: ByteArray) {
    /** The NDEF file: a two byte length, then the message. */
    val file: ByteArray = ndefFile(message)

    /** READ BINARY commands answered against the NDEF file since the application was last chosen. */
    var reads = 0
        private set

    /** One past the last byte of the NDEF file a reader has been given. */
    var readTo = 0
        private set

    private var selected: ByteArray? = null

    /** A reader has left, or chosen the application afresh. */
    fun reset() {
        reads = 0
        readTo = 0
        selected = null
    }

    /** The answer to one command: data, if any, then the two status bytes. */
    fun answer(command: ByteArray): ByteArray {
        if (command.size < 4) return WRONG_LENGTH
        val ins = command[1].toInt() and 0xFF
        val p1 = command[2].toInt() and 0xFF
        val p2 = command[3].toInt() and 0xFF
        return when (ins) {
            INS_SELECT -> select(command, p1)
            INS_READ_BINARY -> read(command, (p1 shl 8) or p2)
            // The tag is read-only, as its capability container says.
            INS_UPDATE_BINARY -> NOT_ALLOWED
            else -> UNKNOWN_INSTRUCTION
        }
    }

    private fun select(command: ByteArray, p1: Int): ByteArray {
        if (command.size < 5) return WRONG_LENGTH
        val length = command[4].toInt() and 0xFF
        if (command.size < 5 + length) return WRONG_LENGTH
        val name = command.copyOfRange(5, 5 + length)
        if (p1 == SELECT_BY_NAME) {
            reset()
            return if (name.contentEquals(NDEF_APPLICATION)) OK else NOT_FOUND
        }
        if (p1 != SELECT_BY_FILE_ID) return NOT_FOUND
        selected = when {
            name.contentEquals(CC_FILE_ID) -> CAPABILITY_CONTAINER
            name.contentEquals(NDEF_FILE_ID) -> file
            else -> null
        }
        return if (selected == null) NOT_FOUND else OK
    }

    private fun read(command: ByteArray, offset: Int): ByteArray {
        val from = selected ?: return NOT_ALLOWED
        // A missing length, or zero, asks for 256 bytes, which is one more than the container allows.
        val asked = if (command.size > 4) command[4].toInt() and 0xFF else 0
        if (asked == 0 || asked > MAX_READ) return WRONG_LENGTH
        if (offset >= from.size) return WRONG_OFFSET
        val end = minOf(from.size, offset + asked)
        if (from === file) {
            reads += 1
            readTo = maxOf(readTo, end)
        }
        return from.copyOfRange(offset, end) + OK
    }

    companion object {
        /** The NDEF application every Type 4 tag answers to, and as Android registers it. */
        const val NDEF_APPLICATION_NAME = "D2760000850101"
        val NDEF_APPLICATION = bytes(0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01)
        val CC_FILE_ID = bytes(0xE1, 0x03)
        val NDEF_FILE_ID = bytes(0xE1, 0x04)

        /** The most a reader may ask for at once, as a payment terminal's tag allows. */
        const val MAX_READ = 0xFF

        /** The largest message presented, which is the largest the wallet's own reader takes. */
        const val MAX_MESSAGE = 8 * 1024

        /** How large the NDEF file may be, as the capability container states it. */
        const val MAX_FILE = MAX_MESSAGE + 2

        /**
         * Fifteen bytes: its own length, mapping version 2.0, the most a reader may read (255) and write (255) at
         * once, then the NDEF file's control block: its id, its size, read access granted and write access never.
         */
        val CAPABILITY_CONTAINER = bytes(
            0x00, 0x0F,
            0x20,
            0x00, MAX_READ,
            0x00, 0xFF,
            0x04, 0x06,
            0xE1, 0x04,
            MAX_FILE shr 8, MAX_FILE and 0xFF,
            0x00,
            0xFF,
        )

        const val INS_SELECT = 0xA4
        const val INS_READ_BINARY = 0xB0
        const val INS_UPDATE_BINARY = 0xD6
        const val SELECT_BY_NAME = 0x04
        const val SELECT_BY_FILE_ID = 0x00

        val OK = bytes(0x90, 0x00)
        val NOT_FOUND = bytes(0x6A, 0x82)
        val NOT_ALLOWED = bytes(0x69, 0x82)
        val WRONG_LENGTH = bytes(0x67, 0x00)
        val WRONG_OFFSET = bytes(0x6B, 0x00)
        val UNKNOWN_INSTRUCTION = bytes(0x6D, 0x00)

        fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

        fun ndefFile(message: ByteArray): ByteArray {
            require(message.isNotEmpty() && message.size <= MAX_MESSAGE) { "Nothing a reader would take." }
            return bytes((message.size ushr 8) and 0xFF, message.size and 0xFF) + message
        }
    }
}

/**
 * What the phone presents now, if anything. The module puts a request here and takes it away, and the service
 * answers a reader from it. It lives as long as the process, so a process Android made only to answer a reader
 * finds nothing here and presents nothing.
 */
internal object Presented {
    private var tag: PresentedTag? = null
    private var until = 0L

    /** Presents `message` until `expiresAt`, in place of whatever was presented. */
    @Synchronized fun put(message: ByteArray, expiresAt: Long) {
        tag = PresentedTag(message)
        until = expiresAt
    }

    @Synchronized fun clear() {
        tag = null
        until = 0L
    }

    /** Whether a reader would be given a request at `now`. A request that has run out is let go here. */
    @Synchronized fun any(now: Long): Boolean {
        if (tag != null && now >= until) clear()
        return tag != null
    }

    /** The answer to a reader's command at `now`: the tag's, or that nothing is here. */
    @Synchronized fun answer(command: ByteArray, now: Long): ByteArray =
        if (any(now)) tag!!.answer(command) else PresentedTag.NOT_FOUND

    /**
     * A reader has left. Answers how far it read, for the log, when it read any of the request: a count and two
     * sizes, and nothing of what the request says.
     */
    @Synchronized fun readerLeft(): String? {
        val left = tag ?: return null
        val summary = if (left.reads == 0) null else {
            val whole = if (left.readTo >= left.file.size) "to the end" else "not to the end"
            "${left.reads} reads, ${left.readTo} of ${left.file.size} bytes, $whole"
        }
        left.reset()
        return summary
    }
}
