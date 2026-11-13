package com.chicory

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The tag Receive presents (docs/TAP-TO-PAY.md), read as a phone reads a Type 4 tag: choose the application, read
 * the capability container, then the file, in goes no larger than the container allows.
 */
class PresentedTagTest {
    private fun bytes(vararg values: Int) = PresentedTag.bytes(*values)

    private fun hex(data: ByteArray) = data.joinToString(" ") { "%02X".format(it.toInt() and 0xFF) }

    private val chooseApplication = bytes(0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00)
    private val chooseContainer = bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x03)
    private val chooseFile = bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04)

    private fun read(offset: Int, length: Int) = bytes(0x00, 0xB0, offset shr 8, offset and 0xFF, length)

    private fun status(answer: ByteArray) = hex(answer.copyOfRange(answer.size - 2, answer.size))

    /** The data of an answer that ended well. */
    private fun data(answer: ByteArray): ByteArray {
        assertEquals("90 00", status(answer))
        return answer.copyOfRange(0, answer.size - 2)
    }

    /** A message of `size` bytes that says where each byte is, so a byte out of place shows. */
    private fun message(size: Int) = ByteArray(size) { (it * 31 + 7).toByte() }

    /** Reads the whole message as a reader does, asking `answer` for each command. */
    private fun readMessage(answer: (ByteArray) -> ByteArray): ByteArray {
        data(answer(chooseApplication))
        data(answer(chooseContainer))
        val container = data(answer(read(0, 15)))
        val most = ((container[3].toInt() and 0xFF) shl 8) or (container[4].toInt() and 0xFF)
        data(answer(chooseFile))
        val size = data(answer(read(0, 2)))
        val length = ((size[0].toInt() and 0xFF) shl 8) or (size[1].toInt() and 0xFF)
        var read = ByteArray(0)
        while (read.size < length) {
            read += data(answer(read(2 + read.size, minOf(most, length - read.size))))
        }
        return read
    }

    @Before fun nothingPresented() = Presented.clear()

    @Test fun aMessageIsReadBackWholeHoweverLongItIs() {
        for (size in listOf(1, 50, 253, 254, 255, 256, 465, 1100, PresentedTag.MAX_MESSAGE)) {
            val given = message(size)
            val tag = PresentedTag(given)
            assertArrayEquals("a message of $size bytes", given, readMessage(tag::answer))
        }
    }

    @Test fun theContainerSaysWhatAReaderMayDo() {
        val tag = PresentedTag(message(300))
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseContainer))
        // Its length, mapping 2.0, 255 a read and a write, the file E104 of up to 8194 bytes, read by all, written
        // by none.
        assertEquals("00 0F 20 00 FF 00 FF 04 06 E1 04 20 02 00 FF", hex(data(tag.answer(read(0, 15)))))
    }

    @Test fun theFileBeginsWithItsLength() {
        val tag = PresentedTag(message(465))
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        assertEquals("01 D1", hex(data(tag.answer(read(0, 2)))))
        assertEquals(467, tag.file.size)
    }

    @Test fun aReadIsNoLargerThanTheContainerAllows() {
        val tag = PresentedTag(message(1000))
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        assertEquals(255, data(tag.answer(read(0, 255))).size)
        // Zero asks for 256, and so does no length at all.
        assertEquals("67 00", status(tag.answer(read(0, 0))))
        assertEquals("67 00", status(tag.answer(bytes(0x00, 0xB0, 0x00, 0x00))))
    }

    @Test fun aReadAtTheEndGivesWhatIsLeftAndPastItNothing() {
        val tag = PresentedTag(message(100))
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        assertEquals(2, data(tag.answer(read(100, 255))).size)
        assertEquals("6B 00", status(tag.answer(read(102, 1))))
    }

    @Test fun nothingIsReadBeforeAFileIsChosen() {
        val tag = PresentedTag(message(100))
        assertEquals("69 82", status(tag.answer(read(0, 2))))
        data(tag.answer(chooseApplication))
        assertEquals("69 82", status(tag.answer(read(0, 2))))
        // Choosing the application again lets go of the file chosen before.
        data(tag.answer(chooseFile))
        data(tag.answer(chooseApplication))
        assertEquals("69 82", status(tag.answer(read(0, 2))))
    }

    @Test fun itAnswersToTheNdefApplicationAndItsTwoFilesAlone() {
        val tag = PresentedTag(message(100))
        // The placeholder the manifest registers, a payment card's application, and no name at all.
        for (name in listOf(
            bytes(0xF0, 0x43, 0x48, 0x49, 0x43, 0x4F, 0x52, 0x59, 0x01),
            bytes(0xA0, 0x00, 0x00, 0x00, 0x03, 0x10, 0x10),
            ByteArray(0),
        )) {
            val choose = bytes(0x00, 0xA4, 0x04, 0x00, name.size) + name
            assertEquals("6A 82", status(tag.answer(choose)))
        }
        data(tag.answer(chooseApplication))
        assertEquals("6A 82", status(tag.answer(bytes(0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x05))))
        // A file that was not found is not left chosen.
        assertEquals("69 82", status(tag.answer(read(0, 2))))
    }

    @Test fun itIsNeverWrittenTo() {
        val tag = PresentedTag(message(100))
        data(tag.answer(chooseApplication))
        data(tag.answer(chooseFile))
        assertEquals("69 82", status(tag.answer(bytes(0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00))))
        assertArrayEquals(message(100), readMessage(tag::answer))
    }

    @Test fun aCommandItDoesNotKnowOrCannotParseIsRefused() {
        val tag = PresentedTag(message(100))
        assertEquals("6D 00", status(tag.answer(bytes(0x00, 0xCA, 0x00, 0x00, 0x00))))
        assertEquals("67 00", status(tag.answer(bytes(0x00, 0xA4))))
        assertEquals("67 00", status(tag.answer(bytes(0x00, 0xA4, 0x04, 0x00))))
        // A name shorter than its length says.
        assertEquals("67 00", status(tag.answer(bytes(0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76))))
        assertEquals("67 00", status(tag.answer(ByteArray(0))))
    }

    @Test fun nothingAndTooMuchAreNotPresented() {
        assertThrows(IllegalArgumentException::class.java) { PresentedTag(ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { PresentedTag(message(PresentedTag.MAX_MESSAGE + 1)) }
    }

    @Test fun withNothingPresentedAReaderFindsNoApplication() {
        assertFalse(Presented.any(1_000))
        for (command in listOf(chooseApplication, chooseContainer, chooseFile, read(0, 2))) {
            assertEquals("6A 82", hex(Presented.answer(command, 1_000)))
        }
    }

    @Test fun aRequestIsReadWhileItIsPresentedAndNotAfterItIsWithdrawn() {
        val given = message(600)
        Presented.put(given, 5_000)
        assertTrue(Presented.any(1_000))
        assertArrayEquals(given, readMessage { Presented.answer(it, 1_000) })
        Presented.clear()
        assertFalse(Presented.any(1_000))
        assertEquals("6A 82", hex(Presented.answer(chooseApplication, 1_000)))
        // A reader that had chosen the file before is given no more of it.
        assertEquals("6A 82", hex(Presented.answer(read(2, 255), 1_000)))
    }

    @Test fun aRequestIsNotReadOnceItHasRunOut() {
        val given = message(600)
        Presented.put(given, 5_000)
        assertArrayEquals(given, readMessage { Presented.answer(it, 4_999) })
        // At the moment it expires, part way through a read or before one.
        assertEquals("6A 82", hex(Presented.answer(read(2, 255), 5_000)))
        assertEquals("6A 82", hex(Presented.answer(chooseApplication, 5_000)))
        // And it does not come back if the clock does.
        assertFalse(Presented.any(1_000))
        assertEquals("6A 82", hex(Presented.answer(chooseApplication, 1_000)))
    }

    @Test fun aNewRequestReplacesTheOldOneAndIsNeverMixedWithIt() {
        val old = message(600)
        val new = ByteArray(700) { (it * 13 + 1).toByte() }
        Presented.put(old, 5_000)
        data(Presented.answer(chooseApplication, 1_000))
        data(Presented.answer(chooseFile, 1_000))
        assertArrayEquals(old.copyOfRange(0, 253), data(Presented.answer(read(2, 253), 1_000)))
        Presented.put(new, 9_000)
        // The reader part way through the old one is refused, and given nothing of either.
        assertEquals("69 82", hex(Presented.answer(read(255, 255), 1_000)))
        // Read afresh, it is the new one, whole.
        assertArrayEquals(new, readMessage { Presented.answer(it, 1_000) })
    }

    @Test fun whatAReaderDidIsCountedAndNothingOfTheRequestIsSaid() {
        // A reader that chose the application and went: nothing to say.
        Presented.put(message(600), 5_000)
        data(Presented.answer(chooseApplication, 1_000))
        data(Presented.answer(chooseContainer, 1_000))
        data(Presented.answer(read(0, 15), 1_000))
        assertEquals(null, Presented.readerLeft())
        // One that read the length and one go of the file, and was pulled away.
        data(Presented.answer(chooseApplication, 1_000))
        data(Presented.answer(chooseFile, 1_000))
        data(Presented.answer(read(0, 2), 1_000))
        data(Presented.answer(read(2, 255), 1_000))
        assertEquals("2 reads, 257 of 602 bytes, not to the end", Presented.readerLeft())
        // One that read it whole.
        readMessage { Presented.answer(it, 1_000) }
        assertEquals("4 reads, 602 of 602 bytes, to the end", Presented.readerLeft())
        // And with nothing presented there is nothing to count.
        Presented.clear()
        assertEquals(null, Presented.readerLeft())
    }

    @Test fun aReaderThatLeavesStartsAgainFromTheApplication() {
        Presented.put(message(100), 5_000)
        data(Presented.answer(chooseApplication, 1_000))
        data(Presented.answer(chooseFile, 1_000))
        Presented.readerLeft()
        assertEquals("69 82", hex(Presented.answer(read(0, 2), 1_000)))
        assertArrayEquals(message(100), readMessage { Presented.answer(it, 1_000) })
    }
}
