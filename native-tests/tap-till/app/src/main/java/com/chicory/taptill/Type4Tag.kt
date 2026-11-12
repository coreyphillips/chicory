package com.chicory.taptill

/**
 * An NFC Forum Type 4 tag holding one payment request, as a Square Register
 * (2nd generation) is reported to present one (docs/TAP-TO-PAY.md): the NDEF
 * application, a capability container that allows 255 bytes a read, and a
 * read-only NDEF file with one URI record.
 *
 * It answers one command at a time and keeps count of what the reader did,
 * since the Register is said to count a tap only once the file has been read
 * to its end. Nothing here touches Android, so the unit tests run it as a
 * reader would.
 */
class Type4Tag(request: String) {
    /** The NDEF file: a two byte length, then the message. */
    val file: ByteArray = ndefFile(request)

    /** READ BINARY commands answered against the NDEF file since the last select of the application. */
    var reads = 0
        private set

    /** One past the last byte of the NDEF file a reader has been given. */
    var readTo = 0
        private set

    /** Whether a reader has been given the last byte of the NDEF file. */
    val reachedEnd: Boolean
        get() = readTo >= file.size

    private var selected: ByteArray? = null
    private var onNdefFile = false

    /** A reader has left, or chosen the application afresh. */
    fun reset() {
        reads = 0
        readTo = 0
        selected = null
        onNdefFile = false
    }

    /** The answer to one command APDU: data, if any, then the two status bytes. */
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
            if (!name.contentEquals(NDEF_APPLICATION)) return NOT_FOUND
            reset()
            return OK
        }
        if (p1 != SELECT_BY_FILE_ID) return NOT_FOUND
        selected = when {
            name.contentEquals(CC_FILE_ID) -> CAPABILITY_CONTAINER
            name.contentEquals(NDEF_FILE_ID) -> file
            else -> return NOT_FOUND
        }
        onNdefFile = name.contentEquals(NDEF_FILE_ID)
        return OK
    }

    private fun read(command: ByteArray, offset: Int): ByteArray {
        val from = selected ?: return NOT_ALLOWED
        // A missing length, or zero, asks for 256 bytes, which is one more than the container allows.
        val asked = if (command.size > 4) command[4].toInt() and 0xFF else 0
        if (asked == 0 || asked > MAX_READ) return WRONG_LENGTH
        if (offset >= from.size) return WRONG_OFFSET
        val end = minOf(from.size, offset + asked)
        if (onNdefFile) {
            reads += 1
            readTo = maxOf(readTo, end)
        }
        return from.copyOfRange(offset, end) + OK
    }

    companion object {
        /** The NDEF application every Type 4 tag answers to. */
        val NDEF_APPLICATION = bytes(0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01)
        val CC_FILE_ID = bytes(0xE1, 0x03)
        val NDEF_FILE_ID = bytes(0xE1, 0x04)

        /** The most a reader may ask for at once, so a request is read in several goes. */
        const val MAX_READ = 0xFF

        /** How large the NDEF file may be, as the capability container states it. */
        const val MAX_FILE = 0x1000

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

        /**
         * One URI record holding `request` exactly as given, capitals and all: the first and last record of its
         * message, well-known type `U`, and no abbreviation (identifier 0x00), since `lightning:` and `bitcoin:`
         * have none. It is always written in the long format, with a four byte length, which is what a real
         * invoice needs and where readers are said to go wrong.
         */
        fun ndefMessage(request: String): ByteArray {
            val text = request.toByteArray(Charsets.UTF_8)
            val length = text.size + 1
            val header = bytes(
                0xC1,
                0x01,
                (length ushr 24) and 0xFF, (length ushr 16) and 0xFF, (length ushr 8) and 0xFF, length and 0xFF,
                0x55,
                0x00,
            )
            return header + text
        }

        fun ndefFile(request: String): ByteArray {
            val message = ndefMessage(request)
            require(message.size + 2 <= MAX_FILE) { "The request is too long for the tag." }
            return bytes((message.size ushr 8) and 0xFF, message.size and 0xFF) + message
        }
    }
}
