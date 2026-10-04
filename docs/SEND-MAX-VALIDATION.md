# Send max and wallet drain qualification

Physical device: Pixel 10 Pro XL, Android release builds, October 4, 2026. All installs use `com.chicory.redesign`. The mainnet application is unchanged.

## Dependencies

- Published beignet 0.27.0, verified against release commit `1c59fa65e43d706fef2f0d8de21cc76b7cd27a22`.
- Portable engine `613d4a02bb0c62701b078e4b876bd3b92194e9bb`, including the confirmed-drain status follow-up.
- Wallet-core `ef9739120dec539c8641a6ecf9779862c8ad08bd`.

## Live results

The ordinary release opened the saved side-app wallet. Its previous home channel was already closed. Settings correctly refused another cooperative drain, and no send was submitted against that wallet.

The `native-tests/SendMax.js` release entry then mounted the real `App` with separate secure-store services and SQLCipher database filenames. It retained the production wallet client, native TCP, real engine, real signatures and normal UI actions. Only fixture setup and public result observation were added. Every send used the normal review and hold controls. No recovery phrase or database key was exported.

1. A Beignet primary funded a new private, reserve-waived home channel through a 50,000 sat JIT receipt.
2. The max chip showed 49,500 sats. Its review showed recipient at least 49,500 sats, routing fee at most 500 sats and total debit 50,000 sats. Holding send delivered exactly 50,000,000 msat with zero fee and remainder. The wallet reached zero, and its exact payment record survived a cold restart.
3. A second 50,000 sat Lightning receipt and a confirmed 20,000 sat loose coin supplied the drain. Settings reviewed a 70,000 sat debit, estimated arrival 68,924 sats and estimated fees 1,076 sats.
4. A separate 1,000 sat coin arrived after review. Holding Send everything closed and swept only the reviewed funds. Restarting while pending kept one durable Activity row and both transaction IDs.
5. Both transactions confirmed. The actual arrival was 68,960 sats, fees were 1,040 sats, and the later 1,000 sats remained. Bitcoin RPC independently verified the two outputs to the reviewed Taproot address, at three confirmations each. A further cold restart retained the completed row and both references in its detail screen.

The close transaction is `413a638a2cb7e19a6fbc45414d18034bd657cc60dbf939bc0bf7772868a42f5b` (49,458 sats). The sweep is `701214786ddf97fef27528ff84a07ffefb203e6ed6c8b1568e868ae944675223` (19,502 sats). A closing fee may change during negotiation; the UI labels the quote as an estimate and records the final values.

The live run found a stale broadcast warning on the completed drain. Portable PR #27 clears it only after every required payout confirms and provides completed-state copy. A shallow reorg still restores a pending state and any current warning. The run also reproduced an intermittent Android startup visibility issue that hid Activity and the connection dot. `useSureEntry` now keeps its recovery timer armed when a callback reports cancellation. The sheet and dot entrances also carry explicit visible opacity through their animation frames, avoiding dependence on Android's implicit opacity restoration. Unit tests cover cancellation recovery and the mounted entrances' opacity targets. Temporary diagnostic builds showed responsive timers, correct pane positions and successful animation callbacks. The exact native race was not established; all diagnostic code was removed before the final release build.

Before those narrow follow-ups, release Gallery completed all 345 states with normal motion and all 345 with Reduce Motion, without errors. Published-engine portable regtest separately covered P2WPKH, P2TR and P2WSH max outputs, opener commitment cost, ordinary legacy reserves, later Lightning receipts, restart and two-leg drains.

The final fixture build verified the confirmed-drain fix and cancellation recovery. Its saved completed drain displays "Reviewed funds sent to the destination." with both transaction references and the same 1,000 sat balance. Cold launches with normal motion and Reduce Motion showed Activity and the connection dot.

The restored ordinary release additionally includes the explicit opacity protection. Four normal-motion cold launches and one reduced-motion cold launch all showed Activity and the connection dot. The saved ordinary wallet and its September 25 history remain present. The installed APK is non-debuggable `com.chicory.redesign`, uses `index.js`, has cleartext traffic disabled and contains no fixture or diagnostic source. Its SHA-256 is `0f4b6c9402c1a4ee4f01bbc687d40e2c977e977af98ac436109367feb0bc2412`. Temporary port forwards were removed, animation scale was restored to 1.0, and USB stay-awake was restored to 0. The new regtest companion and observer were stopped; the preexisting primary was preserved.

All 3,252 app tests across 111 suites, type checks and lint pass (zero errors, eight existing warnings); the final pin, worklet and entrance checks also pass. Portable has 181 passing tests and four green CI checks.

## Unpaid invoice follow-up in 0.6.2

Portable engine `b9e4435a4c37b53b2f9b49d2d72b6c0df8177c71` fixes a drain admission bug. An unpaid receive invoice already has a pending incoming payment record. That record alone no longer produces "Wait for the pending payment to finish". Pending outgoing or unidentified payments, explicit in-flight records, incoming HTLCs, unsettled commitments, splices, offline reservations and recovery holds keep their existing guards.

All 184 portable tests, types, build and four CI checks pass, with independent review. The live regression against published beignet 0.27.0 created an unpaid invoice, restarted the wallet, drained the channel and loose coins, then verified both confirmed payouts and exclusion of a later 1,000 sat receipt. A separate regtest check drained a 20,000 sat ordinary deposit before any confirmation: its 19,502 sat payout spent the still-unconfirmed deposit, and both confirmed in the next block. This does not relax pending-splice or unresolved-HTLC admission.

The app pins that merged engine, with version 0.6.2 and native build number 8 on both platforms. The 83 affected engine, send-max and Settings tests pass, together with type checks and lint (zero errors, eight existing warnings). The earlier full app and physical-device qualification above applies to the prior 0.6.1 release; this follow-up uses the live engine regression and targeted app checks.

## Isolated fixture entry

Keep an ordinary release APK before installing the fixture. Its normal `index.js` entry never imports the fixture or its observer. The fixture prefixes every generic Keychain service and every SQLite filename, including the runtime lease, probes, migration reads and deletion opens, with `send-max-fixture-v1.`. Credential enumeration only exposes that prefix. Alternate SQLite open APIs, directory overrides and path separators are rejected. Public module bindings must match the wrappers before any wallet or App module loads.

The fixture retains and checks its own saved wallet identity on restart. It refuses another network or a different primary rather than replacing the wallet. Do not reuse the prefix for another run while its channel state remains live. The ordinary namespace is preserved through install and restoration.

Provide a local JSON configuration containing `network: "regtest"`, a `primaryUri` ending in `@127.0.0.1:<port>`, and `electrum: { "host": "127.0.0.1", "port": 60001, "tls": false }`. Start a funded Beignet regtest primary and payer, then start the read-only observer:

```sh
node native-tests/send-max/observer.cjs /tmp/regtest-config.json /tmp/send-max-events.jsonl
```

Forward Electrum, the primary port and 31081 using `adb reverse`. Build from `android` using the same release signing configuration as the installed side app:

```sh
ENTRY_FILE=native-tests/SendMax.js ./gradlew :app:assembleRelease \
  -I ../native-tests/send-max/android.gradle \
  -PreactNativeArchitectures=arm64-v8a --no-daemon
```

The Gradle init script selects only `com.chicory.redesign` and permits the fixture's loopback HTTP observer. The observer cannot request payments or operate the wallet. Create receive requests on the phone, pay their public invoices from the regtest payer, and inspect review and hold screens normally. Reinstall the ordinary release with `adb install -r` after qualification, preserving data. Restore any temporary animation and stay-awake settings and remove the added port forwards.
