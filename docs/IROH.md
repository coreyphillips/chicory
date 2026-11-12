# Iroh primary phone link

Chicory accepts the private Iroh URI or QR from an Iroh-enabled Beignet Umbrel wallet. In Settings, open **Primary node**, choose **Change primary node**, paste its URI or choose **Scan primary node QR**, and save. The URI contains both the Lightning public key and Iroh endpoint identity. BOLT 8 remains responsible for Lightning authentication and encryption.

The optional Tor fallback must be a v3 onion address for the same Lightning key. With an onion fallback configured, Tor warms alongside the engine at launch. Iroh is attempted first; the engine starts the fallback after 1.5 seconds when needed. With no onion primary or fallback configured, the Lightning connection does not start Tor. Electrum retains its own transport configuration. This option is experimental. Direct paths expose the phone's IP to the primary; Iroh relay services also see connecting IPs. Prefer pairing with a node you control.

Diagnostics include `primaryTransport` (`iroh-direct`, `iroh-relay`, `iroh-unknown`, or `tor`) and `primaryRttMs`. The native endpoint identity is derived from the existing wallet seed and survives restart. On iOS, after at least 30 seconds in the background, the adapter closes potentially suspended streams and rebinds that identity on foreground resume; the engine restores the durable peer and channel. Each connection has one ordered bidirectional stream, bounded reads, chunked writes and native cancellation. Mobile endpoints are outbound clients, advertise no inbound ALPNs, and disable public endpoint discovery. Pair using the relay hint in the Umbrel URI. Iroh requires the Native networking option; a stored Iroh primary gives an actionable error before Relay settings are saved.

## Native dependencies

Both platforms pin the maintained Iroh FFI binding to 1.1.0. Android uses `computer.iroh:iroh-android`; iOS uses the `IrohLib` Swift package. Rebuild the native app after installing the updated JavaScript packages. The Swift package requires **iOS 17.5 or newer**, so this change raises the app's previous iOS 15.1 minimum. Android's minimum remains unchanged. The portable bundle injects these adapters and does not load the Node binding.

## Validation on 2026-10-03

- Android `:app:compileDebugKotlin` and `:app:assembleDebug` pass. The APK contains Iroh native libraries for arm64-v8a, armeabi-v7a, x86 and x86_64. The first packaging attempt ran out of disk space; the retry passed after removing this task's temporary iOS build artifacts.
- The final iOS simulator Debug build with pinned dependencies passes. A separately identified `com.chicory.irohqualification` app connected through the real Swift bridge to a disposable Beignet 0.26.0 regtest primary.
- A zero-conf channel became usable over Iroh. Primary-to-phone and phone-to-primary payments both completed before and after a full portable engine restart. The endpoint identity remained stable, the channel reestablished, and diagnostics reported a direct path with 1 to 2 ms RTT.
- The fixture waits for the received balance commitment before sending back. Reading the sender's completed payment alone can precede the receiver's usable outbound balance.
- Dependency audit matches the existing app baseline: 56 high findings rooted in `brace-expansion`, `braces`, and `image-size`, with no new package advisories. This integration does not change those unrelated dependency versions.
- The final JavaScript run against merged dependency pins passes all 3,220 tests in 108 suites, including SQLite durability. TypeScript passes; lint has no errors and seven non-blocking warnings.
- JavaScript adapter tests cover identity, ordered writes, diagnostics, dial timeout cancellation, prolonged iOS resume, brief switches, Android resume, and close/timeout while cleanup is pending. Settings tests cover Iroh QR and fallback. Client tests cover Tor warmup for a stored onion fallback and recovery guidance for Relay networking.

The review follow-up repeats both payment directions and a full engine restart with discovery disabled, the merged portable/core revisions and the published beignet 0.26.0 package. Native bind results verify a nonempty stable endpoint identity independently of the unpublished phone URI. The existing simulator binary ran the updated bundle in the separate qualification app with fresh test-only storage service names; observed direct-path RTT was 3 to 8 ms. Android release Kotlin compilation also passes with bridge work on a serialized background dispatcher.

This is local simulator evidence. Physical iOS and Android devices, Wi-Fi to cellular handover, UDP-blocked relay-only operation, relay outages, onion fallback through real Tor, battery use and a deployed Umbrel image still need qualification with this experimental test release.

## Reproducing the isolated simulator check

Use only the disposable regtest fixture, with the local `bitcoin` and `electrum` development containers. The helper verifies the chain is regtest before funding or mining. It binds its control server only on loopback.

```sh
BEIGNET_SOURCE_DIR=/path/to/built/beignet node native-tests/iroh-primary.cjs
ENTRY_FILE=native-tests/Iroh.tsx FORCE_BUNDLING=1 xcodebuild \
  -workspace ios/chicory.xcworkspace -scheme chicory -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/chicory-iroh-qualification \
  PRODUCT_BUNDLE_IDENTIFIER=com.chicory.irohqualification \
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG IROH_QUALIFICATION' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

`ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` is needed on an Apple silicon Mac: the generic simulator destination also links an x86_64 slice, and the paykit lookup library is built for arm64 alone.

Install and launch that separate bundle identifier on a booted simulator. Keep signing enabled for Keychain entitlements. Success prints `IROH_QUALIFICATION` with completed payments and peer diagnostics. Stop the app and send SIGINT to the helper afterward to close its node and remove its temporary primary wallet. Never use the regular app identifier for this fixture.

The same fixture runs on an Android emulator. The build type carries its own application identifier and, through `native-tests/android-qualification-res`, a network security config that allows plain HTTP to loopback, which the helper's control server needs:

```sh
cd android && ENTRY_FILE=native-tests/Iroh.tsx ./gradlew :app:assembleOfflineReceiveTest \
  -PofflineReceiveQualification -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/offlineReceiveTest/app-offlineReceiveTest.apk
adb reverse tcp:31079 tcp:31079 && adb reverse tcp:60001 tcp:60001
adb shell monkey -p com.chicory.offlinereceivetest -c android.intent.category.LAUNCHER 1
```

## A relay-only primary, checked on 2026-11-12

A Beignet Umbrel wallet can keep its Iroh link on the relay (**Relay only** in its "Connect to this node" card, Beignet 0.39.0 and later). The link has the same form, so nothing changes in Chicory: the phone dials the relay the link names, and the connection stays there because the node offers no other address. Whoever holds the link cannot learn the node's IP address from it, which is what lets a node owner hand the link to someone else.

It does not change what the notice in Settings says about the phone. The relay still sees the phone's IP address, and this check did not look at what the node learns about the phone.

Both native bindings were run against such a wallet: Chicory 0.7.18's fixture, an app image built with Beignet 0.39.0 in a bridged container, n0's public relay, regtest. A direct path would have won had one been offered, so every path sample had to read `relay`, on the phone and on the node.

| | Android emulator | iOS simulator |
| --- | --- | --- |
| Path samples after connecting, each side | 55 of 55 relay | 57 of 57 relay |
| Payments both ways: at first, after a phone engine restart, after a primary restart | completed | completed |
| Round trip the node measured | 45 to 48 ms | 44 to 49 ms |
| Link back after the primary started again | 12.7 s | 12.6 s |
| Channel usable again, with no action on the phone | 16.8 s | 16.3 s |
| Path samples after that restart, each side | 37 of 37 relay | 38 of 38 relay |

A relay-only node watches for about twelve seconds after each start before it accepts connections on the link, which is the wait in the fourth row. The phone's reconnect schedule covers it.

Read from the code, not run here:

- With an onion fallback set, a dial made during that wait can land on Tor, since the fallback starts after 1.5 seconds, and that session then stays on Tor until it drops.
- The link names the relay the node was homed on when the link was made, and the phone looks nothing up. A node that moves to another home relay cannot be reached until its link is scanned again. This is the same with Relay only off.

This is emulator and simulator evidence on the same Mac as the node's container. Physical devices and cellular networks are still to do.

To repeat it, start a funded regtest liquidity provider wallet in the beignet-umbrel app with the Iroh link and Relay only on, in a bridged container on the same chain as the `electrum` development container. Then run the helper in place of `iroh-primary.cjs` and launch the fixture as above. Success prints `IROH_RELAY_ONLY_QUALIFICATION`.

```sh
PRIMARY_MANAGER_URL=http://127.0.0.1:3950 PRIMARY_WALLET_ID=<wallet id> \
  node native-tests/iroh-relay-only-primary.cjs
```

The primary is not started on the host on purpose: on a home network the router usually maps a port for the Iroh endpoint, and a relay-only node then switches its link off instead of offering that address.
