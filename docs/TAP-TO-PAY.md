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

Not paid: LNURL, a Lightning address and a BOLT12 offer. A tag that carries one is refused as a scanned code is.

## How the phone reads it

The app never speaks to the tag itself. Android's NFC service and iOS's Core NFC each run the Type 4 procedure: they select the application, loop the 255 byte reads, parse the long record and read the file to its end before the app hears of a tag. The app is given records, and decides only whether one of them is a request it can pay.

### Android: a tag the system hands over

With the phone unlocked, Android reads a tag held to it and offers the tag's first record to the apps that filter for it. Chicory filters for the `lightning` and `bitcoin` schemes (`NDEF_DISCOVERED` on the main activity), and React Native hands such an intent to `Linking` as it hands a link. So a tap opens Send with the request filled in, from a cold start or with the app open, and is a link in every other way: it is dropped while a payment is in flight or with no wallet open, and a request that is held or already paid lands on its ring or mark (rule 6).

- Android lower-cases the scheme before it matches, so `LIGHTNING:` on a tag is taken too.
- If another wallet claims the same scheme, Android shows its chooser.
- Android offers only a tag's first record, so that is the one reviewed here.
- From Android 16 the system tells the owner the first time a tag opens an app, and lets them switch that off for the app (Settings > Apps > Special app access > Launch via NFC).
- From Android 17 an app that targets it is sent NFC intents only on a component guarded by `DISPATCH_NFC_MESSAGE`. Chicory targets API 36. `__tests__/NativeTap.test.ts` fails if the target is raised without a guarded alias.

To try this lane without a tag or a radio, on an emulator or a phone:

```sh
adb shell am start -a android.nfc.action.NDEF_DISCOVERED -d "lightning:LNBC..." com.chicory
```

## Trust

A tag is unauthenticated, as a QR sticker is, and unlike a sticker it cannot be seen. Something hidden near a till could present a request of its own. The defence is the one a link has: the review shows the amount, and the hold commits it. That is why a tap never pays by itself.

A read sends nothing from the wallet, and no request is logged.

## Not yet confirmed

Nobody has yet tapped Chicory on a Register. At the first visit, with the Register taking bitcoin:

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
