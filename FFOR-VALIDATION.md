# Concurrent offline receive qualification

Beignet baseline: published 0.25.0, release `db15cf581bf3f59a26280bdd955f1f08f2dbc182`. The application pins portable-engine and wallet-core together in package.json and package-lock.json.

Receive offline is an explicit fixed-amount choice. A funded home can serve it while ordinary sends and receives use remaining engine capacity. A failed or interrupted request preserves its mode and request identity in a per-wallet secure-store record. Clearing that local retry record leaves the engine reservation intact. Device erasure removes the retry records with the wallet. Concurrent ACTIVE or DRAINING books do not disable the whole wallet. Unknown version 2 slots remain reserved after expiry or early closure; no automatic force close or compensation is added.

## Reproduce native qualification

Use isolated simulators or emulators and disposable regtest funds. `native-tests/OfflineReceive.tsx` packages the real wallet client, native TCP, Hermes and encrypted SQLCipher storage. Its command driver only accepts explicit offline quotes. The test entry must never be distributed as the production app.

For iOS, build that entry in Release with bundle id `com.chicory.concurrenttest`. Supply `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-` and `CODE_SIGN_ENTITLEMENTS` pointing to `native-tests/ios-qualification.entitlements`. Xcode embeds the simulator entitlements used by Keychain; signing an already-linked executable manually is insufficient. Install on an isolated iOS simulator.

For Android, set `ENTRY_FILE=native-tests/OfflineReceive.tsx` and run `./gradlew assembleOfflineReceiveTest -PofflineReceiveQualification -PreactNativeArchitectures=arm64-v8a`. This explicit qualification variant has application id `com.chicory.offlinereceivetest` and permits the loopback HTTP control connection. The production Release network policy stays unchanged.

When the dependencies are linked from local checkouts, set `BEIGNET_QUALIFICATION_FOLDERS` to their absolute paths, separated by the platform path delimiter. Normal installations use the pinned packages. Android tracks those installed package contents and the lockfile as bundle inputs.

Run the portable engine's `npm run test:regtest:ffor:native` with `FFOR_MOBILE_PLATFORM`, `FFOR_MOBILE_DEVICE`, and `FFOR_MOBILE_APP` naming that isolated installation. Supply `BEIGNET_WALLET_CORE_DIR` and `BEIGNET_RELAY_DIR` for the regtest driver's dependencies, and `BEIGNET_EVIDENCE_FILE` to save process identities and balances. The Android driver reverses its loopback control, primary and Electrum ports through adb.

The iOS 26.2 iPhone 17 Pro simulator passed the full sequence in a Release package using Hermes, Keychain, SQLCipher and native TCP. App processes 10264, 10677 and 10813 were separate launches. Both cold starts reported 121,000 sats total and 116,000 available with exactly one completed Activity entry after a 20,000-sat payment while stopped. Partial redemption left the second voucher payable. Early closure retained 17,000 sats and one unknown slot in DRAINING; ordinary payments still completed, ending at 147,000 total and 142,000 available.

Android 17 (API 37) on the isolated arm64 emulator passed the same full sequence, including `am force-stop` before external payment and two cold starts. Processes 9857, 9957, 10032 were distinct launches. Balances, Activity cardinality, partial redemption and the retained 17,000-sat reservation matched iOS. The package uses React Native 0.87.1, Gradle 9.4.1, NDK 27.1.12297006 and encrypted SQLCipher storage. iOS used Xcode 26.2 (17C52). Both packages were application version 0.6.1, build 7.

Exact pins, package and Hermes bundle hashes, process identities and checkpoint balances are recorded in [native-tests/concurrent-receive-results.json](native-tests/concurrent-receive-results.json). The runtime implementation pin is portable-engine `a0275a007dbcc280e81619911090de875eccfc24`; the wallet-core pin is `dcbb538f530e275b5b768512c683737de5f455e8`. Subsequent portable qualification commits change drivers and documentation only.

All 107 Jest suites passed across the broad run and focused reruns. One existing Send announcement timing test failed under native build load and passed in isolation. Public types and lint passed (four warnings). The normal application entry is also packaged separately on both platforms. These are simulator and emulator results; physical devices and app-store distribution are outside this run.

## Historical baseline evidence

The following results cover an earlier release. Its dedicated-channel and default-offline assumptions are superseded by the explicit concurrent receive behavior above.

# Automatic offline receive validation

Release baseline: Beignet 0.21.8, which includes the automatic-receive provider protocol. The published npm package was installed separately and passed the funded portable regression on September 18, 2026.

The ordinary fixed-amount Receive flow now prepares and saves a reservation before returning an invoice. Startup and background reconciliation discover settled receipts without invalidating unpaid requests. No FFOR screen, manual recovery button, or user-managed reservation is required.

## Verified behavior

- Funded portable regtest: normal Receive, restart while unpaid, payment with the receiver stopped, automatic credit of 20,000 sats, one completed Activity entry, and persistence through another cold reopen.
- A second invoice allocates a separate provider-funded channel while previously received funds remain usable, then automatically recovers another offline payment.
- Isolated iOS 26.2 simulator: actual Hermes, Keychain, SQLCipher and native TCP. The app process was terminated after invoice creation. A separate payer completed the payment while it was stopped. Two cold launches verified automatic recovery and no duplicate receipt.
- Production web worker: encrypted durable storage, worker shutdown before payment, automatic recovery on reopening, and a second restart without duplicate Activity. This exercises the production worker bundle in a browser-like realm, not browser UI compatibility.
- Protocol regression: 220 upstream 0.21.8 FFOR and receipt-service checks pass. Dedicated coordinator tests cover unpaid retention, expiry grace, interrupted creation, epoch changes, and shutdown. Shared client tests verify use of the new receive route and refusal to silently downgrade when the provider does not support it.

`npm run test:regtest:ffor` runs the funded portable regression. `scripts/regtest-ffor-native.cjs` drives the separate Chicory `native-tests/OfflineReceive.tsx` entry with `FFOR_SIMULATOR_ID` pointing to an isolated simulator and bundle id `com.chicory.ffor-test`. These use disposable local regtest wallets and never a mainnet wallet.

## Deployment requirements and limits

The primary must run Beignet 0.21.8 or newer with `fforSettle.enabled` and, when new receive channels are needed, an explicit `fforReceiveFunding` budget. Stock 0.21.7 and older providers do not implement the new receipt queries or allocation requests. An unsupported provider fails preparation before an invoice is shared.

The receiver uses an empty inbound channel or obtains a separately funded channel. It never freezes a channel holding spendable local funds. Provider funding limits are cumulative across restarts, including failed allocations. They do not automatically reset; repeated receiving can need additional channels until an empty suitable channel can be reused.

Invoices need an amount supported by the voucher book. Amountless and below-trim payments are not supported by this automatic path. Discovery depends on the settlement peer returning and does not replace independent witnesses or automatic enforcement against an unavailable or dishonest peer. No automatic force close is introduced.

See the Beignet `docs/AUTOMATIC-OFFLINE-RECEIVE.md` document for provider configuration, peer messages, and safety boundaries.
