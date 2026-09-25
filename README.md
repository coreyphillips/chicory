# Chicory

> **Experimental redesign branch.** Not for merging into main. The design this branch builds is in [REDESIGN.md](REDESIGN.md).

A Lightning-first wallet for iOS and Android, running the Beignet engine on the phone itself, built on React Native 0.87.1. One balance, Send, Receive, Activity with details, and Settings. Payment requests and Bitcoin addresses share one send flow with an explicit amount and fee review. Receive produces a unified request QR after showing the receive fee.

App version 0.4.0 (Android `versionCode` 4). The version shown in Settings comes from `package.json`; `android/app/build.gradle` and the Xcode `MARKETING_VERSION` are kept in step with it.

## What the phone adds

- **Scan a payment request.** The camera reads a QR and fills in the send form. It opens inside Send, so a request or amount already typed survives a scan that is cancelled or replaced. A scanned code goes through the same amount and fee review as a pasted one; nothing is paid from the scanner. Frames are never recorded or sent anywhere.
- **`bitcoin:` and `lightning:` links.** Tapping a payment link in another app opens Send with the request filled in. A link can only prefill the form, never prepare or send a payment, and a link that arrives with no wallet open is dropped rather than held.
- **An optional biometric lock.** Face ID, fingerprint or the device passcode can be required before opening a wallet and before revealing the recovery phrase. This gates the app's screens; it does not change how wallet data is encrypted, which already uses a random key held by the platform secure store. A device with no biometric or passcode cannot turn it on, and enabling it authenticates immediately so nobody is left locked out by a setting they cannot undo.
- **Hide balances** from the screen and from the screen reader together, so masking is not defeated by VoiceOver announcing the amount.
- **Search and day-grouped history** in Activity, over a virtualized list, with a Requests filter that still finds a request after it has been paid.
- **A staleness gate.** Send and Receive are disabled when the wallet's last confirmed snapshot is more than 45 seconds old, matching the browser client. The gate keeps its own clock, so a sheet that is already open closes itself off when the balance ages out, and a review or receive quote that has expired offers a fresh one for the same request.
- **Haptics** on payment outcomes, receipt arrival and copy, and motion that respects Reduce Motion.
- **Quiet refreshes.** The wallet polls its engine every 12 seconds and the receive sheet every 2 seconds, and neither shows a spinner or moves anything on screen: the figures stay put until new ones replace them, a single missed read is not reported, and only pull-to-refresh animates. The copy across the app is cut to what a state actually calls for: one short line per arriving amount, naming the figure and what the wallet is doing with it, and no taglines, hints or footnotes.
- **Opening on the wallet page.** A returning wallet opens straight onto its page with the last figures this app saw, marked with when they were confirmed and held behind the same staleness gate as any old balance, while the engine starts and the live figures replace them. A wallet with nothing cached yet shows a quiet opening page. The connection screen with its retry, network and recovery-phrase controls appears only when the connection has actually failed.
- **Erase and start over.** Settings, in device mode, can erase every device wallet from the phone: the encrypted databases of every network, the keys that opened them, the saved selection and the cached figures. It sits behind a link, a second explicit button and the app lock when one is on. Afterwards the app is back at its first screen, where a new wallet can be created or an existing one restored from its recovery phrase, which is typed once, sent once to the engine and never shown back.
- **Switching networks in Settings**, directly, with the server details left behind the editor. A wallet created on another network reuses the original recovery phrase; the flow now says which wallet's phrase it shares and does not ask you to write down a phrase you already have.

The app lock, when enabled, is asked for on launch and after a spell in the background. While locked no vault is opened and no engine is started, so nothing runs for someone who has not authenticated. A lock that cannot be read fails open rather than stranding you out of your own wallet.

Amounts are entered in satoshis, with separators added for reading and stripped before the value is parsed. Balances can be displayed in sats or BTC by tapping the balance; entry stays in satoshis so no decimal parsing enters the money path.

## The wallet runs on this phone

The app runs the actual Beignet engine in Hermes using the portable fork in `../../beignet-engine`. Keys, signing, channels, invoices, and activity live locally, and there is nowhere else a wallet could run, so the app no longer asks: launching opens the vault with the saved defaults, creates the wallet if the vault is empty, and shows the wallet page, with the recovery phrase waiting behind a banner there until it is saved. A returning phone reopens the same wallet. **Restore from recovery phrase** and **Network settings** are links under the opening state for the two cases that need a form, and the picker's **Create wallet** creates with the same defaults. A network whose profile has no primary node opens the create form instead, since a wallet cannot be made without one.

- Native TCP/TLS connects directly to Electrum and clearnet Lightning peers. TLS certificates are verified.
- This build bundles a Tor client (`react-native-nitro-tor`, an embedded Tor 0.4.9.11 daemon). It stays stopped until a connection actually needs it: an `.onion` Electrum server or primary node starts it and dials through its loopback SOCKS5 proxy, while a clearnet endpoint never touches Tor at all. The daemon only dials out; this app publishes no onion service. Once started it runs for the life of the app process: it is a single daemon whose proxy is the same on every network, so stopping it when a wallet closed only bought a second cold bootstrap on the way back in, on top of aborting the process from native code when a worker thread was still holding a lock the shutdown destroyed. A cold start takes tens of seconds before the first onion connection completes. An onion server connects without TLS, because the address is already the server's key.
- The byte transport relay in `../../beignet-relay` remains available as an alternative to the built-in Tor client, and is still what a browser needs. The relay carries Electrum and encrypted BOLT8 traffic; it never receives the seed or signs payments. Configure its fixed Electrum and peer targets to match the wallet. Native clients require `RELAY_ALLOW_NO_ORIGIN=1`; the relay token remains mandatory.
- Enter the Electrum host/port/TLS settings and, when used, the WSS relay address and token once. Saved connection settings live in Keychain/Keystore. Connection fields collapse after setup. Regtest on the iOS simulator can connect directly to host loopback; Android uses the emulator's host address or adb port forwarding.
- Keep the app open for payments and channel updates. This build does not claim an always-running mobile background node or an independent watchtower. **Lock device wallet** stops the engine and closes storage without deleting the wallet.

The app uses `../../shared` for payment reviews and the same UI as the browser client. The local adapter sends direct in-process requests, with `connection.url === 'embedded:'`. It is the only client this app constructs: controlling a wallet on a Beignet host and browsing an isolated sample wallet are both browser features, and the host credential an older build of this app could save is cleared on the next launch.

SSL/TLS encrypts the connection to an Electrum server such as `bitkit.to:9999`. It does not provide a route to an onion Lightning peer. A phone can connect directly to a reachable clearnet Lightning peer using Lightning's own encrypted transport, without this relay. Turning the relay off selects native transport, which dials clearnet endpoints directly and onion endpoints through the bundled Tor client.

## Networks and default servers

Settings → Change network or Bitcoin server switches between mainnet, testnet, and regtest. Each network has a saved Electrum host, port, TLS setting and default liquidity node. Mainnet starts with `ssl://bitkit.to:9999`, native transport and the supplied onion liquidity node, which the bundled Tor client reaches without further setup. Regtest starts with `tcp://192.168.50.211:60401`, TLS off, and no primary node: there is no regtest node worth guessing at, and an address that is merely plausible costs a Tor bootstrap on every open for a peer that is not there. Testnet requires both. An upgrade fills in the regtest server only where none was ever saved; a server that was actually typed is never replaced. Relay configuration is saved separately for each network and must forward to that network’s configured server and node.

Device wallets use separate SQLCipher databases, volume files, and encryption keys for each network. Switching waits for the old engine to stop, then opens the selected network’s existing wallet. The storage lease is released whether or not the engine stopped cleanly, and the engine gives up its one-per-process claim on every failure path, because an engine that took either of those down with it used to make every later open, and every later switch, fail until the app was killed. The close is bounded, so a wedged engine cannot hold the wallet open indefinitely. The page appears as soon as the new engine exists, on that network’s own last known figures, while the chain catches up behind it. A switch that fails leaves the phone on the network it was already on and says why. The first visit to a network offers wallet creation and the normal recovery-phrase backup flow. Existing wallet networks are never retagged. The original unnamespaced device vault is inspected once and remains mapped to its actual original chain, including an existing testnet or regtest vault.

Creating a wallet on another device network now reuses the original local wallet's recovery phrase while keeping that network's channels, balance and history separate. Older network wallets that already have different phrases keep them unchanged; their seeds and channel databases are never replaced or merged. On migration, the oldest existing local wallet supplies the phrase for future network wallets. A checked Keychain entry stores only its namespace and wallet identity; the phrase is read from its encrypted vault during creation, outside UI state. If that source is missing or corrupt, creation stops instead of generating a replacement phrase. Existing wallets still open independently.

Mainnet funds and history stay in their original wallet when a test network is selected.

## Device persistence

The app remembers which network and wallet were last open and reopens them after a fresh launch. A session saved by an older build that connected to a wallet host is discarded on first launch, along with that build’s saved host credentials; the phone’s own wallet is offered instead. **Lock device wallet** keeps it locked and offers **Open device wallet** on the next launch. Older installations that predate session selection are recognized from existing secure-storage entries and offered the same reopen action. Reopening never creates a replacement for a missing saved wallet.

A failed Electrum or primary-node connection does not hide the saved wallet. When live balances are unavailable, its identity and local recovery access remain available. An interrupted setup with no wallet yet remains resumable; an interrupted backup prompts the user to save the phrase after reopening.

Preserve the installed app's data when updating: use the same application ID and signing key and install the update over the existing app. The 0.4.0 rename from Beignet to Chicory changes that id from `com.beignetrn` to `com.chicory`, so this one build installs alongside an older one rather than over it: a wallet left in a `com.beignetrn` install stays there, reachable only by that build, and a wallet whose recovery phrase was saved can be restored into Chicory, though a phrase alone does not carry Lightning channel state. Drain or close a channel before moving.

`src/embedded/storage.ts` requires an OP-SQLite build with SQLCipher. Both the engine's SQLite channel database and its file volume (including seed and metadata) are encrypted using a random 256-bit key protected by Keychain/Keystore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. RNG calls the native secure generator directly and fails closed if unavailable; the library's JavaScript fallback is not used.

The SQLite adapter executes synchronously through JSI with WAL, `synchronous=FULL`, fullfsync and checkpoint_fullfsync. A transaction returns only after COMMIT completes, preserving the engine's write-before-wire contract. BLOB results retain the Buffer representation required by channel recovery. A separate SQLite exclusive lease prevents another runtime from opening the wallet while it is active; the lease contains no wallet data. Storage shutdown follows engine shutdown. iOS excludes the wallet Library and Documents directories from system backups, and Android disables application backup, to avoid silently restoring stale channel state.

Recovery phrases are revealed deliberately and hidden when the app backgrounds. New-wallet entry requires a backup acknowledgement. The seed remains encrypted in the local vault; phrase UI state is not separately saved. A mnemonic alone does not restore current Lightning channel state. Keep the original device and its current encrypted database safe. Physical database export and a complete mobile disaster-recovery/import flow are not provided by this UI yet.

## Wallet setup

Create a wallet from the picker. Mainnet defaults to the requested node:

```
025501f56b72e7b999443b836ae1bff4c6fff514943d3f6677302a9189949bd99c@ulyeemszaigzrvpjcjcby4ehibrvsuqi5sq4dmmew2urk2nse5f7spid.onion:9102
```

This peer is trusted for instant funding. Change it in Settings. Existing channels remain; when using a fixed-target relay, update the relay's peer target too. Regtest and testnet require matching data servers and liquidity nodes.

Selecting a stopped wallet starts it. Pull-to-refresh reconnects and refreshes engine state; periodic snapshot reads are read-only. Unknown payment outcomes never trigger automatic retries or a second payment route. Amountless invoices require an entered amount; BOLT12 payment offers are recognized but refused until bounded fee authorization is supported by the underlying engine API.

A payment that is larger than what can be sent right now, but within the wallet's total, now explains what is arriving and roughly when instead of reporting a flat shortage.

A Bitcoin request from another Beignet wallet can carry a direct-funding envelope. When this wallet holds a confirmed coin outside its channel that covers the amount plus a 1,000 sat fee ceiling, the review names the method as direct funding and the send hands that coin to the recipient's channel in one transaction. A refusal before anything leaves is reported as a failed send that spent nothing, and reviewing the same request again pays the address by an ordinary transaction. Confirmed deposits at or above 25,000 sats are moved into the channel automatically; the wallet page says what it is doing with them, including a refusal and its reason, and Settings has a Diagnostics card that reads the engine's figures (setup, the last channelize decision, the last direct-funding offer answered, chain tip, peers, channels, coins) with a copy button.

Sending to a Bitcoin address splices the channel, which spends the channel's own funding output. While that output is unconfirmed the wallet says so and declines the send, offering Lightning instead: the engine keeps its durable rebroadcast obligation for a zero-conf splice only until the peer says it is locked, which is before any chain evidence, so a payment started in that window can be lost with neither an arrival nor a failure. Changing the liquidity node reports three distinct outcomes: saved and reconnected, saved but not yet reconnected, or refused with the draft kept for correcting.

## Not implemented

Screenshot blocking is not claimed: neither platform offers it through React Native core, and a partial version would be worse than none. The recovery phrase is still cleared whenever the app stops being active, is never copied to the clipboard, and can be put behind the biometric lock. There is also no fiat display, no LNURL or Lightning address, no BOLT12 payment, and no background or push-woken receiving. Restoring from a recovery phrase exists (Settings), but it does not yet offer peer-storage channel recovery (#4).

## Develop and build

The engine and the wallet core are ordinary git dependencies, so a fresh clone
needs nothing beside it:

```sh
npm install
(cd ios && pod install)
npm run typecheck
npm run lint
npm test -- --runInBand
npm start
```

`npm install` fetches [`beignet-portable-engine`](https://github.com/coreyphillips/beignet-portable-engine)
and [`beignet-wallet-core`](https://github.com/coreyphillips/beignet-wallet-core)
from GitHub; the engine builds its portable bundle on `prepare`, so the first
install is slower than the rest.

To work on the engine or the wallet core at the same time as the app, check them
out beside it as `../../beignet-engine` and `../../shared` and run
`npm run deps:local`, which installs both by path without changing
`package.json`, so the published dependencies stay the ones a clone gets. Metro
watches those two directories when they exist, so an edit there reloads here.
`npm install` puts the GitHub copies back.

`react-native-camera-kit` (QR scanning) and `react-native-haptic-feedback` are native modules, so a build made before they were added will not have them. Both are loaded optionally at runtime: without them the app still runs, the scanner explains that this build has no camera module and offers the clipboard instead, and haptics fall back to a short Android vibration or to silence. Rebuild the native apps, including `pod install`, after pulling this change.

In another terminal:

```sh
npm run ios -- --simulator 'iPhone 17 Pro'
# or
npm run android
```

The native registration name and the displayed name are both Chicory; the application id is `com.chicory` on Android and the bundle identifier is `com.chicory` on iOS. Metro watches the sibling engine and wallet core directories when a development checkout has them. Strict UTF-8 decoding and complete URL parsing are installed before the Hermes engine loads. OP-SQLite is configured in package.json with SQLCipher enabled; rebuild native apps after changing native dependencies.

Signed iOS simulator release build on this machine:

```sh
xcodebuild -workspace ios/chicory.xcworkspace -scheme chicory \
  -configuration Release \
  -destination 'platform=iOS Simulator,id=0B1580C5-105F-4DE9-8FEE-6998A78A74A1' \
  -derivedDataPath /tmp/beignet-rn-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

Keep simulator signing enabled: Keychain needs the application entitlement. Device/distribution builds need your Apple signing configuration. Android requires SDK / Build Tools 37 and NDK 27.1.12297006:

```sh
cd android
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home \
ANDROID_HOME=/Users/coreyphillips/Library/Android/sdk \
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. A debug APK expects Metro; use a signed release configuration for distribution.

For a standalone **test APK** with the JavaScript engine bundled, run `:app:assembleRelease` with the same environment and architecture arguments. The artifact is `android/app/build/outputs/apk/release/app-release.apk`. This project's current release configuration uses its existing Android test signing key and application ID `com.chicory`. Install an update over the existing app using the same signing key; do not uninstall or clear app data to replace the APK. A production distribution needs your own signing configuration.

## Verification

Jest covers payment fee approval, duplicate send prevention, quote expiry, uncertain outcomes, recovery acknowledgement, native randomness failure, SQLite commit ordering/rollback/reopen, recovery BLOB handling, pending wallet-selection serialization, and retaining a newly created wallet when startup fails. It now also covers satoshi entry (separators shown, digits reported), Activity search and the Requests filter, day grouping, balance masking including the screen-reader label, the staleness gate, the biometric lock (including the device that cannot satisfy the prompt), the three settings outcomes, and `bitcoin:`/`lightning:` link handling with every other scheme refused. It also covers that a background poll sets no visible state, that a direct-funding review shows its method and fee ceiling and a refusal says nothing was sent, and that the wallet page renders the engine's channelize line. These unit tests do not replace native integration checks.

The app's connection lifecycle lives in `src/services/useWalletSession.ts` rather than in `App.tsx`. Its generation counter and in-flight latches are unchanged: every asynchronous action captures the session generation and re-checks it before each state write, which is what the restore and lifecycle tests assert.

`native-tests/Smoke.tsx` is a separate developer entry for a dedicated simulator bundle id. It exercises native RNG, actual SQLCipher, independent mainnet/testnet/regtest storage reopening, committed state reopening, the native exclusive database lease, real Hermes Beignet startup, native TCP Electrum/BOLT8, a signed regtest invoice, and full engine close/reopen with seed and history restoration. It never sends funds and refuses a non-regtest wallet. This native platform check creates an invoice directly; the CLN test peer does not implement Beignet JIT quotes. The workspace funded Beignet integration covers the public receive/fee flow. Its fixed local services are Electrum `127.0.0.1:60001` and CLN `127.0.0.1:19846`. Production entry remains `index.js`. See the workspace `VALIDATION.md` for recorded native/build outcomes and remaining limitations.

Recorded native result (September 5, 2026): all checks passed in the signed iOS 26.2 iPhone 17 Pro simulator Release app using actual Hermes, native networking, SQLCipher and Keychain. The inspected screenshot is `../native-verification.png`. No mainnet operations or native test payments were performed.

Recorded build result (September 7, 2026), after the Beignet 0.15.0 engine resync and this app version: `pod install` integrated `ReactNativeCameraKit` and `RNReactNativeHapticFeedback`; the signed iPhone 17 Pro simulator Release build succeeded, installed and launched to the onboarding screen (`../onboarding-0.2.0.png`). `xcrun simctl openurl` confirmed the simulator routes both `bitcoin:` and `lightning:` to the app, while an unregistered scheme was refused, so the check is meaningful rather than vacuous. The Android arm64 release APK built in 2m28s (44,104,462 bytes, SHA-256 `89f6172db9b2c78e31550ae3ec70534295a498b3239ebea73ba866700cbe15f0`, `versionCode` 2, `versionName` 0.2.0); its manifest declares CAMERA and USE_BIOMETRIC and both URL schemes, and its Hermes bundle contains the new screens, the `0.15.0-portable` engine and the shared arriving-funds explanation. Neither build was installed on a physical device, and no camera, biometric prompt or payment was exercised on a device in this pass.

Recorded build result after adding the embedded Tor client (September 7, 2026): `pod install` integrated `ReactNativeNitroTor` 0.6.1; the signed iPhone 17 Pro simulator Release build succeeded, installed and launched to the onboarding screen and kept running. The Android arm64 release APK built in 1m18s (55,849,958 bytes, SHA-256 `3ad735c93a4ef93bd87695613c727c72e7f16c56e102703379b2ab9c08a94307`), about 11.7 MB larger, which is the added `libcxx-react-native-nitro-tor.so`. Launching does not start Tor, since nothing starts the daemon until an onion endpoint is dialled: no real bootstrap or onion circuit was exercised in this pass.

Recorded build result after the Beignet 0.16.0 engine resync and the switch of the mainnet default to native transport (September 9, 2026): the Android arm64 release APK built in 2m48s (55,921,182 bytes, SHA-256 `75d80eda2ed36b3d2bfbcf2d402a51f597454923e760b1b24b6e47c1a40c91c0`) and its Hermes bundle reports the `0.16.0-portable` engine; the signed iPhone 17 Pro simulator Release build succeeded, installed, launched to the onboarding screen and kept running. Neither build was installed on a physical device.

Recorded result for app version 0.3.0 (September 9, 2026), after the Beignet 0.17.0 engine resync: the 127 Jest tests, TypeScript and lint pass, and the release JavaScript bundle compiles. The signed iPhone 17 Pro simulator Release build succeeded (`CFBundleShortVersionString` 0.3.0, `CFBundleVersion` 3, application binary 27,773,504 bytes), installed, launched to the onboarding screen (`../launch-0.3.0.png`) and kept running; its bundle identifier was then still the template's `org.reactjs.native.example.beignetrn`. The Android arm64 release APK built in 4m26s (55,926,138 bytes, SHA-256 `fa2f242b3bc3f88bdcea0471aaf3c45c15d1ce88f9cfe2eb7c2d0eb8354def7f`, `versionCode` 3, `versionName` 0.3.0) and its Hermes bundle reports the `0.17.0-portable` engine and carries the primary-node wording. Neither build was installed on a physical device. This version keeps the scanner inside Send, clears a paid or abandoned request before the next Send, keeps a hidden balance hidden in payment details, shows the backup reminder above a working Activity list, applies the app lock the moment it is turned on, reports a primary-node change from a fresh read of the wallet, and says "primary node" everywhere the phone used to say "liquidity node". A second pass the same day added the cached wallet page on launch, the erase action and restoring from a recovery phrase, taking the suite to 137 tests.

With the 0.19.5 engine the phone keeps one home channel however money arrives: a Bitcoin deposit is spliced in once it confirms, a Lightning payment that needs room has the primary splice the channel bigger, and another Beignet wallet paying by direct funding splices it too, paired or not; a stranger's splice locks after three confirmations, and the wallet says so while it does.

Recorded result after the Beignet 0.19.5 engine resync (September 12, 2026): the 147 Jest tests, TypeScript and lint pass, the release JavaScript bundle compiles with the `0.19.5-portable` engine, and the Android arm64 release APK was rebuilt with it at `android/app/build/outputs/apk/release/app-release.apk`; no device was attached at build time, so installing it on the phone is still to do (details in the workspace validation document).

Recorded result after the Beignet 0.21.2 engine resync (September 14, 2026): the 154 Jest tests across 24 suites and TypeScript pass, lint reports no errors (one existing `no-void` warning), the release JavaScript bundle compiles with the `0.21.2-portable` engine, and the Android arm64 release APK was rebuilt with it at `android/app/build/outputs/apk/release/app-release.apk` (56,023,506 bytes, SHA-256 `17bbedcb46928ad060944cd5df7c9ee84a1ec772b464b78e169d60ea5fc4ac19`); no device was attached at build time, so installing it on the phone is still to do. Build the arm64 artifact with `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; `assembleRelease` on its own produces a 162 MB universal APK for all four ABIs. What changes for the phone: an incoming direct funding whose coin the wallet cannot check, because Electrum is down or a call timed out, is now retried for twenty seconds and then left unanswered for the payer to re-send, instead of a failed lookup being read as absence and declining a real coin; and paying a direct-funding request no longer spends its offer window on dials. The 0.21.0 refresh behaviour carries over: a deposit or confirmation that happens while the app is in the background, or while a refresh is already running, shows up without a manual refresh once the wallet reconnects. The live regtest suites cover this path end to end on 0.21.2, but the device case that failed before has not been rerun (details in the workspace validation document).

Recorded result after the Beignet 0.20.0 engine resync (September 13, 2026): the 147 Jest tests, TypeScript and lint pass, the release JavaScript bundle compiles with the `0.20.0-portable` engine, and the Android arm64 release APK was rebuilt with it at `android/app/build/outputs/apk/release/app-release.apk` (55,999,558 bytes, SHA-256 `7604f84d86b956d1e31977b19302d5c355537720e3a86442085e56259311689c`); no device was attached at build time, so installing it on the phone is still to do. What changes for the phone: a payer that sends a JIT payment with exactly the advertised expiry and loses a block while the primary funds the channel is now asked to retry instead of being quietly admitted under the invoice's promise, and a deposit that confirms while the home channel is already splicing waits for the next pass instead of leaving a submission that fails later (details in the workspace validation document).

Recorded result for the cold-start pass (September 13, 2026): launch to a live, sendable balance went from 71 seconds to 24 seconds on the Pixel 10 Pro XL against the Umbrel's onion primary. Tor now warms at wallet open, the balance is read the moment the primary connects, a first connection that fails is retried within seconds, and the engine no longer opens two sockets to the primary at start (beignet #805), which was what left the first session dead until its first ping. The Diagnostics card now ends with a timestamped event log (connections, errors, redials, balance transitions), which is what found it. 154 Jest tests, TypeScript and lint pass; the APK (56,005,850 bytes, SHA-256 `ecc1ee5f69f7cc37c86b0a624a252343d6eafb6435c842a788b63e2c760115c6`) is installed on the phone (details in the workspace validation document).

Recorded result for the lightning-first parity pass (September 10, 2026): the 139 Jest tests, TypeScript and lint pass; the runtime's live regtest covers a deposit spliced into the home channel, a deposit that opens a channel, and a second phone paying this wallet's request by direct funding in one transaction; the signed iPhone 17 Pro simulator Release build succeeded from a clean derived-data folder, installed, launched to the connection screen (`../launch-0.3.0-parity.png`) and kept running, and the Android arm64 release APK (55,988,918 bytes) carries the new engine, the primary redial, the direct-funding review and the Diagnostics card and none of the removed copy. Neither build was installed on a physical device, and the mainnet wallet's stuck state was not read in this pass; the Diagnostics card exists so it can be (details in the workspace validation document).

Android reopening validation also passed on a disposable Android 37 emulator: a real encrypted regtest wallet survived an in-place replacement with the normal standalone APK and a full force-stop/cold launch. Explicit lock remained locked across restart. The offline wallet's name and network remained visible; the screenshot is `../android-reopen-verification.png`. The RN tests (now 91), typecheck and lint pass, including source migration, unchanged older wallets, missing-source failures and closing during seed lookup. See the workspace validation document for the exact scope.

`native-tests/ColdStartSeed.tsx` is a separate emulator-only developer entry for that bounded test. It creates one unfunded regtest wallet with unavailable Electrum, closes storage and emits only public verification details. It refuses established sessions and existing regtest wallets. Build it only with an explicit `ENTRY_FILE` override on a disposable emulator, then rebuild with the normal `index.js` entry before distributing any APK. It is excluded from the delivered app bundle.

## State gallery

Jest runs worklets on the JS thread through Reanimated's mock, so a worklet that reads a value the UI thread never received passes every suite and crashes only on a device. `native-tests/Gallery.tsx` is a developer entry that draws every visual state on the real UI thread instead: each glyph in every mode, tone, variant and event, then Home, Activity, every payment's detail, Settings, the shell phases, and Send and Receive through each step and outcome. Only the scanner is left out, since it would ask for the camera. It runs over fake data and a fake wallet that answers at once, holds each state for 1.2 seconds once reached, and loops. It never opens a vault, starts the engine or touches the secure store or clipboard; `native-tests/gallery/sealed.ts` replaces both before anything is drawn.

Each state is logged as it comes up, as `GALLERY <index> <name>`, and the same index shows in the bottom-left corner, so the last line before a crash names the state that caused it. A full pass logs `GALLERY COMPLETE`. A step that cannot find the control it presses logs `GALLERY MISS`, and a state that throws logs `GALLERY ERROR`. Build it as a release bundle, since that is where the UI thread runs the compiled worklets:

```sh
# iOS simulator
xcodebuild -workspace ios/chicory.xcworkspace -scheme chicory \
  -configuration Release \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/chicory-gallery \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- \
  ENTRY_FILE=native-tests/Gallery.tsx
xcrun simctl install booted /tmp/chicory-gallery/Build/Products/Release-iphonesimulator/chicory.app
xcrun simctl launch booted com.chicory
xcrun simctl spawn booted log stream --predicate 'eventMessage CONTAINS "GALLERY"'

# Android
cd android
ENTRY_FILE=native-tests/Gallery.tsx \
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home \
ANDROID_HOME=/Users/coreyphillips/Library/Android/sdk \
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
adb install -r app/build/outputs/apk/release/app-release.apk
adb logcat -c
adb shell monkey -p com.chicory -c android.intent.category.LAUNCHER 1
adb logcat -s ReactNativeJS:V | grep GALLERY
```

The gallery installs as Chicory itself, over whatever build is there, and its APK is written where the normal release APK goes. Prefer a simulator or emulator. On a phone that holds a wallet, the wallet's data is left as it was, since the gallery never reads it, but the phone runs the gallery until the normal build is installed again: rebuild without `ENTRY_FILE` and install that before opening the wallet or distributing any APK. Run it once more with Reduce Motion on, since several glyphs take other paths under it. `__tests__/Gallery.test.tsx` runs one full pass under Jest with fake timers, which proves every state draws and every step finds its control, but not what only the UI thread would show.

## License

MIT. See [LICENSE](LICENSE). The Beignet engine it runs is MIT as well, Copyright (c) 2023 Synonym.

## Offline receiving

Receiving offline is an opt-in on the Receive screen ("Receive offline", off by default), shown when the engine advertises it. The ordinary request is paid over the home channel or provisioned by the primary just in time. With the box on, a fixed amount of at least 354 sats is required and the primary prepares a durable reservation: the wallet can be closed after sharing the request, reopening discovers settled receipts and updates the balance and Activity, and unpaid requests remain payable until expiry.

An offline receive is only for a channel that already exists with the primary and has room for the amount; it never has the primary open one. The primary must run Beignet 0.21.8 or newer with settlement enabled. The app reports unsupported preparation without silently issuing an online-only invoice.

See [FFOR validation](FFOR-VALIDATION.md) for simulator and funded regtest evidence, commands, and deployment limits.
