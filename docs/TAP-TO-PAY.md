# Tap to pay

Chicory reads a payment request from an NFC tag and carries it into the same review and hold as a link. A tap only ever fills in Send. It never pays by itself, and it never qualifies for Auto-pay (REDESIGN.md rule 5).

The case it is built for is a payment terminal that presents its Lightning request to a tap: Square Register (2nd generation), and open tills such as Numo.

## What a terminal presents

Square documents the feature and not the protocol. Its help article says a buyer holds a phone with a Lightning wallet near the NFC reader on the customer display of a Square Register (2nd generation), and that Square Terminal, Square Stand and mobile devices do not take bitcoin by tap.

The exchange below was reported on 2026-11-12 from a reading of Square's terminal source. Nobody has yet observed it at a Register with Chicory, so every line is what to expect, not what has been confirmed.

- The terminal acts as an NFC Forum Type 4 tag over ISO-DEP. The NDEF application is `D2760000850101`, the capability container is file `E103`, and the NDEF file is `E104`, read-only.
- The file holds one NDEF URI record: well-known type `U`, identifier code `0x00` (no abbreviation), then the request as text.
- The request is `lightning:<BOLT11>` with the invoice in capitals. It is the same string the terminal's QR carries.
- A real invoice makes the record longer than 255 bytes, so it is written in the long record format: header `C1` and a four byte length. A 465 byte message begins `C1 01 00 00 01 CA 55 00 6C 69 67 68 74 6E 69 6E 67 3A`.
- The capability container allows 255 bytes a read, so a reader has to loop over the file.
- The terminal counts a tap only once the wallet has read to the end of the file.

Square is reported to be moving from `lightning:<BOLT11>` to the BIP 321 form `bitcoin:?lightning=<BOLT11>`, which Numo presents already. Chicory takes both, with any part of either in capitals:

| On the tag                                       | Read as                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `lightning:LNBC...`                              | the invoice                                 |
| `bitcoin:?lightning=LNBC...`                     | the invoice                                 |
| `BITCOIN:?LIGHTNING=LNBC...`                     | the invoice                                 |
| `bitcoin:<address>?amount=<btc>&lightning=<...>` | a unified request, as a scanned one is read |

An invoice in capitals carries the same warning by tap as by its QR, so its hold is 1000ms.

Not paid: LNURL, a Lightning address and a BOLT12 offer. A tag that carries one is treated as a QR code or a link that carries one is. An LNURL or a Lightning address is refused by the open scanner on its mark, and from any other screen opens Send with it marked as one that cannot be paid. An offer is a request the wallet reads, so from either lane it opens Send, and the review says this version cannot pay it and asks for an invoice.

## How the phone reads it

The app never speaks to the tag itself. Android's NFC service and iOS's Core NFC each run the Type 4 procedure: they select the application, loop the 255 byte reads, parse the long record and read the file to its end before the app hears of a tag. The app is given records, and decides only whether one of them is a request it can pay.

### Android: a tag the system hands over

With the phone unlocked, Android reads a tag held to it and offers the tag's first record to the apps that filter for it. Chicory filters for the `lightning` and `bitcoin` schemes (`NDEF_DISCOVERED` on the main activity), and React Native hands such an intent to `Linking` as it hands a link. So a tap opens Send with the request filled in, from a cold start or with the app open, and is a link in every other way: it is dropped while a payment is in flight or with no wallet open, and a request that is held or already paid lands on its ring or mark (rule 6).

- Android lower-cases the scheme before it matches, so `LIGHTNING:` on a tag is taken too.
- If another wallet claims the same scheme, Android shows its chooser.
- Android offers only a tag's first record, so that is the one reviewed here.
- A phone that drifts out of a terminal's field and back reads its tag again, and Android hands over each read. A link for the request the Send in front is composing or reviewing changes nothing, so a review, and a hold under way, stay as they are. Once a payment has an outcome, or the request has been refused, the same tap is a new ask and opens a fresh Send.
- Android takes back the process of an app left behind others, and keeps its activity on record. A tap after that builds the activity again with the intent it was first made for and hands over the new one before JavaScript is up, where React Native reads only the first. So `MainActivity` keeps the newest intent as its own (`onNewIntent`), and an activity built again from saved state or from the recents list forgets the request it was first made for (`onPostCreate`). Without the first, such a tap opened the app on Home, or on the request before it. Without the second, opening the app again could open Send on a request already dealt with. Both hold for a link as for a tap.
- On Android 7 to 11, Back at Home closes the activity and leaves the app running. The next tap or link then starts a new activity that the running app is not told of, so it is dropped, and a second tap is taken. From Android 12 Back leaves the activity in place. This is read from the code and has not been seen on such a phone.
- From Android 16 the system tells the owner the first time a tag opens an app, and lets them switch that off for the app (Settings > Apps > Special app access > Launch via NFC).
- From Android 17 an app that targets it is sent NFC intents only on a component guarded by `DISPATCH_NFC_MESSAGE`. Chicory targets API 36. `__tests__/NativeTap.test.ts` fails if the target is raised without a guarded alias.

To try this lane without a tag or a radio, on an emulator or a phone:

```sh
adb shell am start -a android.nfc.action.NDEF_DISCOVERED -d "lightning:LNBC..." com.chicory
```

Write the scheme in lower case there. Android's NFC service lower-cases a tag's scheme before it looks for an app, and `adb` does not, so `BITCOIN:` typed by hand finds no app while the same tag would. The rest of the request can be in capitals: `bitcoin:?LIGHTNING=LNBC...` is what the service makes of a tag that says `BITCOIN:?LIGHTNING=LNBC...`.

### Android: a tag held to the open scanner

With the payment scanner open, the app takes the tag itself (`NfcAdapter` reader mode). This is the lane for a phone with a second wallet installed, since no chooser comes up, for a tag whose request is not its first record, and for a camera that is switched off.

- The scanner listens for as long as it is open and in front, whether or not the camera can be used. It says so with the `contactless` mark above its controls: cream while it listens, steam with NFC switched off, when the mark opens the NFC settings, and absent on a phone with no NFC.
- Android has read the tag's message to its end before the app hears of the tag. The app takes that message and never asks Android to skip the read (`FLAG_READER_SKIP_NDEF_CHECK` is never set).
- Every record is looked at, not only the first. One request is taken. The same request in two spellings is one request, and so is an invoice written alone and again in a link that carries it beside an address. Two that differ in whom or how much they pay are refused, since nothing says which was meant: two addresses beside one invoice are two requests. They are told apart by what the wallet reads in each, never by their text (`src/scenes/send/sameRequest.ts`).
- A tag with a message and nothing to pay in it is refused on the mark, the same tag at most once in 1.5 seconds. A tag with no message at all, such as a bank card kept in the phone's case, is passed over in silence.
- A request taken this way reaches Send as a `tap`: a prefill to review and hold, as a pasted one is. Only the camera can reach Auto-pay.
- While the scanner listens the radio is the app's alone: Android offers a tag to no other app, and the phone's own card payments are off. The radio is given back as the scanner closes or the app leaves the front.
- As the scanner closes on a request, the phone may still be on the terminal. The reader asks Android to pass over that tag until it has been away for 1.5 seconds, and the link lane drops a link equal to a request taken by tap in the last 5 seconds, so one tap opens one Send.
- NFC switched off from the quick settings shade while the scanner is open is noticed the next time the app comes to the front, not at once.

| What                                                    | Where                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| What a tag's records say                                | `src/services/ndef.ts`                                     |
| The seam over the native reader, and its stand-in       | `src/services/tapReader.ts`, `test-support/tap.ts`         |
| The Android reader                                      | `android/app/src/main/java/com/chicory/NfcReaderModule.kt` |
| Listening, the mark, and the one-request rule           | `src/components/Scanner.tsx`                               |
| The guard against the same tap arriving again as a link | `src/services/links.ts`                                    |

### iPhone: a tag read from the scanner's control

iOS opens an app for a tag only through a universal link, never for `lightning:` or `bitcoin:`, so on an iPhone a tap starts inside the app. The payment scanner has a `contactless` control beside the paste.

- Pressing it raises Core NFC's sheet (`NFCNDEFReaderSession`) for one tag, with one line of the scan's own on it. Core NFC reads the tag's message to its end and hands over its records, and the first tag ends the session.
- The sheet is the system's, raised at the app's asking, so it is raised inside `duringSystemPrompt` and the scan stays in view behind it. The camera rests while the sheet is up. What the sheet read is held until the app is in front again.
- The sheet comes down after 20 seconds without a tag. iOS would hold it for 60, and the app lock counts 30 seconds behind a prompt as time away.
- A sheet closed by hand, or left to run out, is no refusal. A tag that cannot be paid is refused on the control, by the rules the Android scanner keeps: every record is looked at, one request is taken, two different ones are refused.
- The control is absent where tags cannot be read: the simulator and an iPad. A build signed without the entitlement shows it until its first press, when iOS refuses the read and the control goes.

Signing: the app carries `com.apple.developer.nfc.readersession.formats` holding `TAG` (`ios/chicory/chicory.entitlements`), and `NFCReaderUsageDescription` in its `Info.plist`. NFC Tag Reading has to be turned on once for the `com.chicory` App ID, in the developer portal or through Xcode's Signing & Capabilities. A free personal team cannot be given it, so such a build leaves the entitlement out with `CODE_SIGN_ENTITLEMENTS=` on the `xcodebuild` line, and has every other part of the app.

| What                                          | Where                                                        |
| --------------------------------------------- | ------------------------------------------------------------ |
| The iPhone reader                             | `ios/chicory/NfcReaderModule.swift`, `NfcReaderModule.m`     |
| Its entitlement and the words iOS asks for    | `ios/chicory/chicory.entitlements`, `ios/chicory/Info.plist` |
| The control, the sheet's line and the landing | `src/components/Scanner.tsx`, `src/design/copy/scan.ts`      |

## Trying it without a terminal

`native-tests/tap-till` is a stand-in for a terminal: a separate Android app that turns a phone into the tag described above, with the same application, the same 255 byte read cap, a read-only file and one long-format URI record holding whatever request it is given, capitals included. It shows the first bytes it presents, to set against `C1 01 00 00 ...`, and it counts the taps that began and the ones read to the end of the file, which is what a Register is said to wait for.

It is built with the wallet's Gradle wrapper and is never part of the wallet's build. It needs a real phone with NFC, as the paying phone does. See [its README](../native-tests/tap-till/README.md) for the build line and the requests worth presenting.

A writable tag (an NTAG216 sticker holds a real invoice) written with a `lightning:` or `bitcoin:` URI record does for the refusals: an LNURL, a web link, two different requests, an expired invoice, one for another network.

## Trust

A tag is unauthenticated, as a QR sticker is, and unlike a sticker it cannot be seen. Something hidden near a till could present a request of its own. The defence is the one a link has: the review shows the amount, and the hold commits it. That is why a tap never pays by itself.

A read sends nothing from the wallet, and no request is logged.

## Checked so far

Recorded November 12, 2026. No radio took part in any of it, since an emulator and a simulator have none.

- **Android, the system lane.** On an Android 17 emulator with the release build, `am start -a android.nfc.action.NDEF_DISCOVERED` opened Send on the invoice, its amount locked, for `lightning:LNBC...` from a cold start, and for `bitcoin:?lightning=lnbc...`, `bitcoin:?LIGHTNING=LNBC...` and `lightning:LNBC...` with the app behind the launcher and in front. The same request sent again while Send was open left one Send. `lightning:LNURL1...` opened Send with the request marked as one that cannot be paid. With the app opened from the launcher, sent behind others and its process taken back (`am kill`), the invoice opened Send on itself, where before the fix it opened Home. Taken back again with that Send open, `bitcoin:<address>?amount=0.0001` opened Send on the address and its 10,000 sats, where before it opened the invoice again. Taken back once more and opened from the launcher, and force stopped and opened from the recents list, the app opened on Home. The drop while a payment is in flight is held by Jest alone: the emulator's wallet has nothing to send.
- **Android, the scanner.** On that emulator, which has no NFC, the payment scanner opened with no tap mark. Listening itself is held by Jest against a stand-in reader.
- **iPhone.** The Release build signed with the tag reading entitlement built for the iOS 27 simulator, installed and opened to Home. A simulator cannot read tags, so the control is absent there, and the sheet has not been seen.
- **The test till.** Its unit tests pass, and on the emulator it shows its message, beginning `C1 01 00 00 00 8C 55 00` for its sample request.
- **The mark.** The gallery draws it listening, with NFC off, refusing a tag and saying why.

## Not yet confirmed

Nobody has yet held Chicory to a tag of any kind. Before a Register, with the test till on an Android phone:

1. Tap it with an iPhone, from the scanner's control. This settles whether Core NFC reads a tag a phone emulates, whether the till shows the read reaching the end, and how the camera and the sheet behave together.
2. Tap it with a second Android phone, from Home and with the scanner open. Note how many taps the till counts for one hold, and that closing the scanner with the phones still together opens no second Send.
3. Present a real invoice of 400 to 500 characters in capitals, and the BIP 321 form.

Nobody has yet tapped Chicory on a Register either. At the first visit, with the Register taking bitcoin:

1. Pay by tap from an Android phone and from an iPhone. Record the phones, their OS versions and what happened.
2. Compare the invoice in the review with the one in the Register's QR, and note whether the Register shows the payment.
3. If a tap does nothing, read the tag with NXP TagInfo (Android) or NFC Tools (iPhone), and record whether a tag appears at all, its technologies, its capability container and each NDEF record's type and payload.

| Date | Register software | Phone | Result |
| ---- | ----------------- | ----- | ------ |
|      |                   |       |        |

## Sources

- [Square help: Accept and manage bitcoin payments](https://squareup.com/help/us/en/article/8622-accept-and-manage-bitcoin-payments)
- [Square release notes, Vol 5, June 4, 2026](https://squareup.com/us/en/release-notes/release-notes-june-4th)
- [BIP 321: URI scheme for Bitcoin payment instructions](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki)
- [Android: NFC basics and tag dispatch](https://developer.android.com/develop/connectivity/nfc/nfc)
- [awesome-bitcoin-nfc](https://github.com/guggero/awesome-bitcoin-nfc)
