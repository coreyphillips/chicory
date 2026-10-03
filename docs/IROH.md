# Iroh primary phone link

Chicory accepts the private Iroh URI or QR from an Iroh-enabled Beignet Umbrel wallet. In Settings, change the primary node, paste its URI or choose **Scan primary node QR**, and save. The URI contains both the Lightning public key and Iroh endpoint identity. BOLT 8 remains responsible for Lightning authentication and encryption.

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
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

Install and launch that separate bundle identifier on a booted simulator. Keep signing enabled for Keychain entitlements. Success prints `IROH_QUALIFICATION` with completed payments and peer diagnostics. Stop the app and send SIGINT to the helper afterward to close its node and remove its temporary primary wallet. Never use the regular app identifier for this fixture.
