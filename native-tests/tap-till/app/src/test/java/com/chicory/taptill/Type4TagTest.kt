package com.chicory.taptill

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The till, read as a phone reads a Type 4 tag: choose the application, read the container, then the file. */
class Type4TagTest {
    /** A request the length the report gives: 457 characters, so a 465 byte message. */
    private val request = "lightning:" + "LNTBS79900N1P5HGY5X" + "Q".repeat(457 - 10 - 19)

    private fun bytes(vararg values: Int) = Type4Tag.bytes(*values)

    private fun hex(data: ByteArray) = data.joinToString(" ") { "%02X".format(it.toInt() and 0xFF) }

    private val chooseApplication = bytes(0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00)
    private val chooseContainer = bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x03)
    private val chooseFile = bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04)

    private fun read(offset: Int, length: Int) = bytes(0x00, 0xB0, offset shr 8, offset and 0xFF, length)

    /** The data of an answer that ended well. */
    private fun data(answer: ByteArray): ByteArray {
        assertEquals("90 00", hex(answer.copyOfRange(answer.size - 2, answer.size)))
        return answer.copyOfRange(0, answer.size - 2)
    }

    /** Reads the whole message as a reader does, in goes no larger than the container allows. */
    private fun readMessage(tag: Type4Tag): ByteArray {
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseContainer))
        val container = data(tag.answer(read(0, 15)))
        val most = ((container[3].toInt() and 0xFF) shl 8) or (container[4].toInt() and 0xFF)
        data(tag.answer(chooseFile))
        val size = data(tag.answer(read(0, 2)))
        val length = ((size[0].toInt() and 0xFF) shl 8) or (size[1].toInt() and 0xFF)
        var message = ByteArray(0)
        while (message.size < length) {
            message += data(tag.answer(read(2 + message.size, minOf(most, length - message.size))))
        }
        return message
    }

    @Test fun theMessageBeginsAsTheRegisterIsReportedToWriteIt() {
        val message = Type4Tag.ndefMessage(request)
        assertEquals(465, message.size)
        assertEquals(
            "C1 01 00 00 01 CA 55 00 6C 69 67 68 74 6E 69 6E 67 3A",
            hex(message.copyOfRange(0, 18)),
        )
    }

    @Test fun theRequestIsPresentedExactlyAsGiven() {
        for (given in listOf(request, "bitcoin:?lightning=LNBC1INVOICE", "BITCOIN:?LIGHTNING=LNBC1INVOICE")) {
            val message = readMessage(Type4Tag(given))
            // One record, first and last, long format, well-known type U, nothing abbreviated.
            assertEquals(0xC1, message[0].toInt() and 0xFF)
            assertEquals(1, message[1].toInt())
            val length = ((message[2].toInt() and 0xFF) shl 24) or ((message[3].toInt() and 0xFF) shl 16) or
                ((message[4].toInt() and 0xFF) shl 8) or (message[5].toInt() and 0xFF)
            assertEquals(message.size - 7, length)
            assertEquals(0x55, message[6].toInt())
            assertEquals(0, message[7].toInt())
            assertEquals(given, String(message, 8, message.size - 8, Charsets.UTF_8))
        }
    }

    @Test fun theContainerAllows255BytesAReadAndNoWriting() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseContainer))
        assertEquals(
            "00 0F 20 00 FF 00 FF 04 06 E1 04 10 00 00 FF",
            hex(data(tag.answer(read(0, 15)))),
        )
        // Writing is refused, to the container and to the file.
        data(tag.answer(chooseFile))
        assertEquals("69 82", hex(tag.answer(bytes(0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00))))
    }

    @Test fun aRequestIsReadInSeveralGoesAndCountedOnlyAtItsEnd() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        data(tag.answer(read(0, 2)))
        assertEquals(255, data(tag.answer(read(2, 255))).size)
        // A reader that leaves here has read the length and one go of two, and the tap is not complete.
        assertEquals(2, tag.reads)
        assertFalse(tag.reachedEnd)
        assertEquals(210, data(tag.answer(read(257, 210))).size)
        assertTrue(tag.reachedEnd)
        assertEquals(3, tag.reads)
        assertEquals(tag.file.size, tag.readTo)
    }

    @Test fun aWholeReadReachesTheEndAndANewTapStartsTheCountAgain() {
        val tag = Type4Tag(request)
        assertArrayEquals(Type4Tag.ndefMessage(request), readMessage(tag))
        assertTrue(tag.reachedEnd)
        // The length, then two goes of up to 255 for 465 bytes.
        assertEquals(3, tag.reads)
        data(tag.answer(chooseApplication))
        assertEquals(0, tag.reads)
        assertFalse(tag.reachedEnd)
    }

    @Test fun readingTheContainerIsNotReadingTheRequest() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseContainer))
        data(tag.answer(read(0, 15)))
        assertEquals(0, tag.reads)
        assertFalse(tag.reachedEnd)
    }

    @Test fun oneReadOfTheWholeFileIsRefused() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        // A length of zero asks for 256 bytes, one more than the container allows.
        assertEquals("67 00", hex(tag.answer(read(0, 0))))
        assertEquals("67 00", hex(tag.answer(bytes(0x00, 0xB0, 0x00, 0x00))))
        assertEquals(0, tag.reads)
    }

    @Test fun aReadPastTheEndIsRefusedAndOneAcrossItIsCutShort() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        assertEquals("6B 00", hex(tag.answer(read(tag.file.size, 1))))
        assertEquals(10, data(tag.answer(read(tag.file.size - 10, 255))).size)
    }

    @Test fun nothingIsReadBeforeAFileIsChosenAndOtherNamesAreNotFound() {
        val tag = Type4Tag(request)
        data(tag.answer(chooseApplication))
        assertEquals("69 82", hex(tag.answer(read(0, 2))))
        assertEquals("6A 82", hex(tag.answer(bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x05))))
        assertEquals(
            "6A 82",
            hex(tag.answer(bytes(0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x00, 0x03, 0x10, 0x10, 0x00))),
        )
        assertEquals("6D 00", hex(tag.answer(bytes(0x00, 0x20, 0x00, 0x00))))
        assertEquals("67 00", hex(tag.answer(bytes(0x00, 0xA4))))
    }

    @Test fun aRequestTooLongForTheTagIsRefusedWhenItIsSet() {
        try {
            Type4Tag("lightning:" + "Q".repeat(Type4Tag.MAX_FILE))
            throw AssertionError("A request longer than the file was taken.")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }
}
