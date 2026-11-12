# Tap till

A stand-in for a payment terminal, for trying tap to pay without one (see [Tap to pay](../../docs/TAP-TO-PAY.md)). It turns an Android phone into the tag a Square Register (2nd generation) is reported to present: an NFC Forum Type 4 tag whose NDEF file holds one URI record with a payment request.

It is a separate app (`com.chicory.taptill`), built with the wallet's Gradle wrapper and never packaged with the wallet. It has no network permission and holds no keys. It presents whatever text it is given and counts what the phones held to it read.

## What it presents

- The NDEF application `D2760000850101`, a capability container (`E103`) that allows 255 bytes a read, and a read-only NDEF file (`E104`).
- One URI record with identifier code `0x00`, holding the request exactly as typed, capitals included.
- The record is always written in the long format (header `C1`, four byte length), which is what a real invoice needs. A 457 character request gives the 465 byte message the report describes, beginning `C1 01 00 00 01 CA 55 00 6C 69 67 68 74 6E 69 6E 67 3A`.
- A read that asks for more than 255 bytes at once is refused, so a reader has to loop.

`Type4Tag.kt` is the tag and has no Android in it. `Type4TagTest.kt` reads it as a phone does and checks those bytes.

## Build and install

From the repository root, with the same environment as the wallet's Android build:

```sh
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew -p ../native-tests/tap-till :app:testDebugUnitTest :app:assembleDebug --no-daemon
adb install -r ../native-tests/tap-till/app/build/outputs/apk/debug/app-debug.apk
```

The till needs a phone with NFC and host card emulation. An emulator has neither, so there it only shows its bytes.

## Use

1. Open Tap till on the phone that plays the terminal, and keep its screen on. A reader finds it only then.
2. Paste a request and press Present. Until then it presents a sample invoice for 24,425 sats that a wallet can review and nobody can be paid with.
3. Hold the paying phone to the back of the till.

The screen shows the first bytes of the message, how many taps began, how many were read to the end, and what the last reader did. The Register is said to count a tap only once its file has been read to the end, so "read to the end" is the line to watch.

Requests worth presenting:

| Request                                           | What the wallet should do                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lightning:LNBC...` from a real wallet, capitals  | open Send on the invoice, with the capitals warning                                                                                                                 |
| `bitcoin:?lightning=lnbc...`                      | open Send on the invoice                                                                                                                                            |
| `BITCOIN:?LIGHTNING=LNBC...`                      | open Send on the invoice                                                                                                                                            |
| `lightning:LNURL1...`                             | refuse it: the open scanner's mark shakes and nothing opens; from any other screen Send opens with it marked as one that cannot be paid, as it does for such a link |
| `https://example.com`                             | open nothing in the wallet                                                                                                                                          |
| an invoice for another network, or an expired one | open Send, which says why it cannot be paid                                                                                                                         |

A signet or regtest invoice of 400 to 500 characters, with route hints or a long description, is the closest to what a Register presents.
