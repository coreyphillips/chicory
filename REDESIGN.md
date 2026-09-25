# Chicory redesign

This branch (`redesign`) is an experimental redesign of the Chicory app. It is not meant to be merged into main. This document is the source of truth for everything the redesign builds: product rules, architecture, tokens, glyphs, the state-to-visual map, choreography, reduced motion and accessibility.

## 1. Product rules

1. **Text lives in Settings.** Outside Settings, visible text is limited to data:

   - amounts and their unit ("sats", "BTC")
   - dates and times
   - recovery words and their numbers
   - request strings, addresses, txids and hashes
   - wallet names and user notes

   Everything else is carried by a glyph, ring, color, motion or haptic. No "Loading...", no hint paragraphs, no text toasts.

2. **Settings-class surfaces may keep short text.** These are Settings itself, restore phrase entry, recovery phrase reveal and backup, first-run network setup, create wallet, and the diagnostics view. They are drawn in the Settings visual language, and their safety lines stay.
3. **Whisper.** Long-pressing a status glyph, ring or disabled control for 400ms shows its accessibility string in a small cocoa pill:

   - Text: cream, 13pt.
   - Entry: scale .92 to 1 with a 160ms fade.
   - Hides after 2400ms.
   - Fires a `tick`.

   This is the only text a user can summon outside Settings.

4. **Safety contract.** Applies to: uncertain or held send, reused receive address, expired request or quote, backup pending, stale balance, and test vs mainnet. Every such state must be:
   - persistent until resolved;
   - encoded three ways: color, a distinct glyph or ring shape, and motion, with a haptic when it starts;
   - enforced by behavior, so the risky action is removed or blocked;
   - announced to screen readers assertively;
   - logged with its full engine message to the diagnostic log.
5. **Hold to send.** A payment is committed with a 700ms hold (1000ms when engine warnings exist). Screen readers use a single `activate` action.
6. **Held requests.** A request whose earlier payment is still pending or uncertain cannot be paid again. It lands on the held ring instead of a review.
7. **Haptics are not motion.** Reduce Motion does not switch haptics off. Settings > Haptics does. It is a Keychain preference `com.beignet.wallet.haptics`, on by default.
8. **Money data does not change.** Storage formats, Keychain keys, the engine pins, `useWalletSession`, `useReceiveStatus` and `useAppLock` are untouched. A build from main and a build from this branch open the same wallet on one device.
9. **Prose rules.** No em-dash characters in code, comments, docs, commits or branch names. No attribution trailers in commits.

## 2. Architecture

### 2.1 Stack

- react-native-reanimated 4.7.0, react-native-worklets 0.13.0 and react-native-gesture-handler 3.3.0, all pinned exactly.
- react-native-svg (already present) draws every glyph and shape.
- No Skia, no Lottie, no keyboard controller.
- `react-native-worklets/plugin` is the last Babel plugin.
- `GestureHandlerRootView` wraps the app.
- `InteractionManager` is removed in RN 0.87. Use `afterTransition(fn)` from `src/motion/idle.ts` instead.

### 2.2 Stage model

- **`src/stage/phase.ts`: `derivePhase(input): Phase`.** A pure selector over the session and app lock. It keeps the precedence of the old if/else ladder:

  | Phase     | When                                                               |
  | --------- | ------------------------------------------------------------------ |
  | `locked`  | the app lock is closed                                             |
  | `transit` | `why` is `erasing`, `closing` or `switching`                       |
  | `opening` | initializing                                                       |
  | `saved`   | no client, a device wallet exists, and device setup is not visible |
  | `welcome` | no client                                                          |
  | `picker`  | a client, but no wallet id                                         |
  | `loading` | a wallet id, no snapshot, no error                                 |
  | `offline` | a wallet id, no snapshot, and an error                             |
  | `wallet`  | a snapshot                                                         |

- **`src/stage/scene.ts`: `stageReducer(state, action)`.**
  - Scenes: `home`, `activity`, `detail`, `send`, `receive`, `settings`.
  - Overlays: `scan` and `create`.
  - The state also carries a back `stack`, a `busy` lock and a `step`.
  - `busy` blocks `back`, `home`, `open`, `link` and `overlay`. `reset` and `tab`, which come from session callbacks, always win.
  - A send scene's prefill lives inside the scene, so leaving it discards the prefill.
- **Android back.** `useBackHandler` runs this chain, and the first rung that answers takes the press:

  1. the transition lock, which swallows the press while a pane moves;
  2. a locked app, which answers nothing;
  3. the innermost scene responder, registered with `useSceneBack(handler, active)` (Send's review back to compose, a lifted QR, an open search); the one that became active last is asked first;
  4. busy, which swallows the press with a warning haptic;
  5. an open overlay, then the scene stack;
  6. the phase responder, registered with `usePhaseBack(handler)` (Welcome's device setup, a network editor);
  7. otherwise the system has the press, and the app is left.

  A handler returns true when it took the press and false to pass it on.

### 2.3 Canvas

- **Two panes.**
  - The top pane is full-height and sits at the back. It holds the status row, the hero, the vessel and the action row, plus the top-slot scenes (send, receive).
  - The bottom sheet is full-height and moves only by `translateY` from one `seam` shared value.
- **Seam stops.** `home` = `max(insetTop + 380, 0.5H)`, `compact` = `insetTop + 72` (activity, detail), `gone` = `H + 24` (send, receive).
- **Edge to edge.** The canvas runs under the system bars, so the top pane's gradient reaches the top edge. The insets apply inside it: the status row pads the top inset, the slots start below the status row, Settings pads both bars, and only a side cutout narrows the canvas itself. The shell phases and the new wallet sheet keep a safe area.
- **Panes animate transforms and opacity only**, never flex, height or width.
- **Keyed children with `entering`/`exiting`** give "mount incoming first, unmount outgoing after the fade".
- **Tap lock.** A transition lock blocks taps while a pane moves. It lifts when the panes look settled, `PANE_SETTLE_MS` (340ms) after the move starts, timed by a clock of its own on the UI thread: the pane spring's rest callback only arrives near 630ms. A safety timeout ends it regardless.
- **Settings** slides in from the right over the canvas. The canvas scales to .94 and dims to .5.
- **Scan** is an overlay. It is a disc that scales up from the scan button, with its content counter-scaled so it stays still. On Android the camera is a SurfaceView, which ignores clipping, alpha and transforms. So the camera mounts only after the reveal finishes, full-bleed, under a cover that then fades out.
  - The canvas draws it above everything while `overlay.name` is `scan`. The panes stay drawn beneath it, out of use, and the canvas under it scales to .96 and dims to .5 on the pane spring (`SCANNING`), springing back as it closes; under Reduce Motion it only dims.
  - A code read from home dispatches `scanned`, and the reducer opens Send prefilled with it. A scan started inside Send has the target `send`: the code goes to the receiver the open Send registered with `useScanReceiver(receiver, active)`, the one that became active last, and the overlay closes over that same Send.
  - Cancelling dispatches `back`, which closes the overlay.
- **No `LayoutAnimation`.** Use Reanimated `LinearTransition` on the specific containers that resize.

### 2.4 Contracts that tests depend on

- Keep these export names and prop contracts: `SendScreen`, `ReceiveScreen`, `DetailScreen`, `HomeScreen`, `ActivityScreen`, `SettingsScreen`, `CreateWalletScreen`, `WalletPicker`, `NetworkSettings`, `Scanner`, `AmountField`, `activityStatus`.
- Keep every existing `accessibilityLabel` string wherever its control survives.
- Every visible string that is removed moves verbatim into the `accessibilityLabel`, `accessibilityValue` or `accessibilityHint` of the glyph that replaces it.
- Controls in panes that are not active expose no `onPress`, and are hidden from accessibility.
- State changes are synchronous. Animation never gates meaning.

## 3. Tokens

### 3.1 Palette

Contrast values are WCAG against roast / espresso / mocha.

| Token      | Hex     | Role                                                 | Contrast           |
| ---------- | ------- | ---------------------------------------------------- | ------------------ |
| roast      | #110E0C | app background, top pane                             |                    |
| espresso   | #1A1512 | bottom sheet                                         |                    |
| mocha      | #241D19 | pressed keys, chips, raised                          |                    |
| cocoa      | #2F2621 | Whisper pill, overlays                               |                    |
| husk       | #3D332C | ring tracks, hairlines (decorative only)             |                    |
| bark       | #4A3E36 | strong decorative stroke                             |                    |
| cream      | #F3ECDF | primary numbers                                      | 16.4 / 15.4 / 14.1 |
| steam      | #B9AD9E | secondary numbers, units, stale balance              | 8.7 / 8.2 / 7.5    |
| dust       | #8C8174 | day headers, word numbers, expired                   | 5.0 / 4.75 / 4.35  |
| ink        | #1C1511 | glyphs on light fills                                |                    |
| bloom      | #8FA5E4 | brand, pending, focus                                | 7.9 / 7.5 / 6.9    |
| bloomHi    | #A9BAEE | petal tips, highlights                               |                    |
| bloomDeep  | #6F88CF | petal mid, pressed                                   |                    |
| bloomNight | #4F66AD | petal base, glow                                     |                    |
| stamen     | #3E4F8F | bloom center                                         |                    |
| sage       | #9FD4A6 | done, received, connected                            | 11.4               |
| honey      | #F2C46B | attention: uncertain, backup, fee wait, reconnecting | 11.8               |
| radish     | #FF8373 | failed, refused, over limit                          | 8.0                |
| slate      | #9AA0AE | replaces bloom on test networks                      | 7.3                |

- **Soft fills:** bloomSoft #282933, sageSoft #2B3228, honeySoft #3A2F1D, radishSoft #3C231F, creamSoft #3A3632.
- **Washes:** bloomWash #202026, sageWash #22261E, honeyWash #2C2417, radishWash #2E1C18.
- **Arriving glass:** bloom at 35% alpha.
- **Scrim:** rgba(17,14,12,0.88).

**Rules**

- Every meaningful number is at least 7:1.
- Dust never carries a number that matters.
- QR codes are always ink on cream.

**Semantic mapping**

| Meaning      | Color                     |
| ------------ | ------------------------- |
| Done         | sage                      |
| In flight    | bloom                     |
| Attention    | honey                     |
| Failed       | radish                    |
| Expired      | dust glyph on a husk ring |
| Test network | slate in place of bloom   |

**Legacy aliases in `theme.ts`.** These keep old screens compiling while they are migrated:

| Old name   | New token |
| ---------- | --------- |
| primary    | bloom     |
| mint       | sage      |
| warning    | honey     |
| danger     | radish    |
| background | roast     |
| surface    | espresso  |
| raised     | mocha     |
| overlay    | cocoa     |
| line       | husk      |
| text       | cream     |
| muted      | steam     |
| faint      | dust      |

### 3.2 Gradients (top pane)

| Layer         | Definition                                                                            | Motion                                                                         |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| G0            | linear 180 degrees, #17131B to #110E0C                                                | static                                                                         |
| G1 bloom glow | radial at cx .5, cy .4, r .6: #4F66AD alpha .28, then #2A2A45 alpha .12 at .6, then 0 | translate plus or minus 6% / 4% on an 18s sine; rotate 0 to 8 degrees over 26s |
| G2 crema      | radial at cx .8, cy .9, r .5: #6B4A33 alpha .18 to 0                                  | the opposite phase of G1, 22s                                                  |
| G3 state tint | one tint at a time, crossfaded over 600ms (below)                                     |                                                                                |

G3 tints:

- **Honey** (backup pending or uncertain): alpha .10 at the mark.
- **Sage flash** (money arrived): alpha .22, 300ms in and 900ms out.
- **Radish** (failure): alpha .14 for 1200ms.
- **Night** (offline receive): #3B4A7A at alpha .10.

**Stale:** G1 and G2 fade to .25. **Test network:** G1 is slate.

### 3.3 Type

- System faces. Every number uses `fontVariant: ['tabular-nums']`.

| Style        | Size / line height         | Weight and details                                                                                                              |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| hero         | 64/72, letter spacing -1.5 | 300. Steps down to 56, 48, 40 to fit its container's measured width, crossfading 160ms on a step. Never `adjustsFontSizeToFit`. |
| heroUnit     | 15/20                      | 500, steam                                                                                                                      |
| amount       | 48/56                      | 300                                                                                                                             |
| amountDetail | 40/48                      | 300                                                                                                                             |
| line         | 20/26                      | 400                                                                                                                             |
| row          | 16/22                      | 600 for received, 400 for sent                                                                                                  |
| meta         | 12/16                      | steam                                                                                                                           |
| micro        | 11/14, letter spacing 1.2  | 600, dust                                                                                                                       |
| mono         | 12/18                      | shown in groups of 4                                                                                                            |
| word         | 17/22                      | 500                                                                                                                             |
| keypad       | 30/36                      | 300                                                                                                                             |

- Settings keeps text styles: title 28/34 at 600, body 15/22, label 13/18 at 600.
- `maxFontSizeMultiplier`: hero and amount 1.2, rows 1.4, Settings unlimited.

### 3.4 Space and radius

- The spacing scale is unchanged: 4, 8, 12, 16, 20, 24, 32, 44. The page edge is 24.
- Radius: sm 10, md 14, lg 20, qr 24, pane 28, round 999.
- The minimum touch target is 48.

### 3.5 Motion

**Springs** (damping / stiffness / mass):

| Spring | Values         | Used for                                    |
| ------ | -------------- | ------------------------------------------- |
| snap   | 26 / 420 / 0.9 | press, release, keys, chips, ratchet steps  |
| pane   | 30 / 260 / 1   | sheet, shared elements, reveals             |
| reveal | 18 / 180 / 1   | pop-ins, petal unfolds, bursts, check scale |
| soft   | 22 / 120 / 1   | liquid levels, re-saturation                |
| boing  | 10 / 300 / 0.6 | bloom center pops only                      |

**Curves:**

- standard `bezier(.4,0,.2,1)`
- enter `bezier(.05,.7,.1,1)`
- exit `bezier(.3,0,.8,.15)`
- linear for orbits, countdowns and sheen
- sine in-out for breathe and pulse

**Durations (ms):**

| Name      | ms   | Name       | ms                       |
| --------- | ---- | ---------- | ------------------------ |
| tick      | 90   | orbit      | 1400 per revolution      |
| exit      | 140  | pulse      | 1800                     |
| enter     | 220  | halo       | 1600                     |
| move      | 320  | sheen      | 2400                     |
| draw      | 420  | shimmer    | 2600                     |
| celebrate | 900  | dashRotate | 8000                     |
| breathe   | 4200 | hold       | 700 (1000 with warnings) |

**Shake:** translateX keyframes 0, -8, 8, -5, 5, -2, 0 at 55ms per step (330ms total).

**Overlap rule:**

- Exits start at t0 and run 140ms on the exit curve, scaling to .98.
- Pane springs start at t0.
- Entering content starts at +80ms and runs 220ms on the enter curve, rising 8 to 16pt.
- Siblings stagger 25 to 40ms.
- Total perceived time stays under 350ms.

### 3.6 Haptics

Semantic names are defined in `src/design/haptics.ts` on top of `services/haptics.ts`:

| Name      | Maps to                                           | Used for                                   |
| --------- | ------------------------------------------------- | ------------------------------------------ |
| tick      | selection                                         | keys, chips, toggles, row taps             |
| tap       | impactLight                                       | primary press-in                           |
| thud      | impactMedium                                      | hold complete, scan detected               |
| rigid     | rigid                                             | refused key                                |
| soft      | soft                                              | petal steps, liquid settle, pull threshold |
| success   | notificationSuccess                               | success                                    |
| warning   | notificationWarning                               | warning                                    |
| error     | notificationError                                 | error                                      |
| incoming  | success, then light at +120ms and light at +240ms | money arrived only                         |
| held      | warning, then warning at +300ms                   | held payment                               |
| hold ramp | tick at 25%, 50%, 75%, thud at 100%               | hold to send                               |

## 4. Glyphs

- **Grid.** 24 viewBox, 2pt padding, round caps and joins.
- **Stroke width by render size:** 16 is 2.0, 20 is 1.8, 24 is 1.7, 32 is 1.5, 48 and up is 1.3.
- **No fills**, except 1-unit dots and the bloom.
- **Color** comes only from semantic tokens.
- **Existing glyphs.**
  - Kept: check, close, copy, scan, search, lock, key, shield, eye, eyeOff, refresh, bolt, clock, share, plus.
  - Renamed: arrowUp is now `send`, arrowDown is `receive`, link is `chain`.
  - Settings only: alert, info, back, chevron, chevronDown, wallet.
- **New paths:**

| Glyph       | Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cog         | `M10.04 5.18L10.23 2.87L13.77 2.87L13.96 5.18A7.1 7.1 0 0 1 15.44 5.79L17.2 4.29L19.71 6.8L18.21 8.56A7.1 7.1 0 0 1 18.82 10.04L21.13 10.23L21.13 13.77L18.82 13.96A7.1 7.1 0 0 1 18.21 15.44L19.71 17.2L17.2 19.71L15.44 18.21A7.1 7.1 0 0 1 13.96 18.82L13.77 21.13L10.23 21.13L10.04 18.82A7.1 7.1 0 0 1 8.56 18.21L6.8 19.71L4.29 17.2L5.79 15.44A7.1 7.1 0 0 1 5.18 13.96L2.87 13.77L2.87 10.23L5.18 10.04A7.1 7.1 0 0 1 5.79 8.56L4.29 6.8L6.8 4.29L8.56 5.79A7.1 7.1 0 0 1 10.04 5.18ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z` |
| question    | `M9.2 9a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.4 1.2-1.4 2.2v.6M12 17.5v.01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| pause       | `M9 7v10M15 7v10`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| cross       | `m7.5 7.5 9 9M16.5 7.5l-9 9`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| bang        | `M12 5.5v8.5M12 18.5v.01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| moon        | `M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| unplug      | left `M3 12h3M6 9.5h2.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H6z`, right `M21 12h-3M18 9.5h-2.5a1.5 1.5 0 0 0-1.5 1.5v2a1.5 1.5 0 0 0 1.5 1.5H18z`, spark `M12 5.5v2M12 16.5v2`                                                                                                                                                                                                                                                                                                                                                        |
| infinity    | `M8 9.3c-3.6 0-3.6 5.4 0 5.4 2.6 0 5.4-5.4 8-5.4 3.6 0 3.6 5.4 0 5.4-2.6 0-5.4-5.4-8-5.4z`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| clipboard   | `M9 3.5h6v3H9zM9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| backspace   | `M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12 9.5l5 5M17 9.5l-5 5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| qr          | `M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| sprout      | `M12 21v-8M12 13C12 9 9 7 5 7c0 4 3 6 7 6zM12 11c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6z`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| restore     | `M4 12a8 8 0 1 0 2.3-5.6M4 4.5v4h4M10 10.5h5M10 13.5h3.5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| swap        | `M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| shieldAlert | `M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM12 8.5v4.5M12 16.2v.01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| twin        | `M9.5 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM14.5 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| linkPlus    | chain plus `M18 15v5M15.5 17.5h5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| gauge       | `M4.5 17a8 8 0 1 1 15 0M12 13l3.5-3.5M12 13v.01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| rewind      | `M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| inflow      | `M12 3v10M8 9l4 4 4-4M5 14v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| fund        | `M7 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 8.5h8M17 5.5l3 3-3 3M4 16h16M4 20h16`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| cameraOff   | `M4 4l16 16M9 5h6l1.5 2H19a1 1 0 0 1 1 1v8.5M16.5 19H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2M10.2 10.3a3 3 0 0 0 4.2 4.2`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| faceScan    | `M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 15.5c1.4 1.2 3.6 1.2 5 0`                                                                                                                                                                                                                                                                                                                                                                                    |
| fingerprint | `M8 5.5a7.5 7.5 0 0 1 11.5 6.5v1M4.5 10a7.5 7.5 0 0 1 1.3-3M4.5 14.5v-2M8.5 19a11 11 0 0 1-1-4.5V12a4.5 4.5 0 0 1 9 0v1.5M12 12v2.5a9 9 0 0 0 1.8 5.5M16.3 17.5a14 14 0 0 1-.3-3`                                                                                                                                                                                                                                                                                                                                                              |
| passcode    | `M7 9h.01M12 9h.01M17 9h.01M7 14h.01M12 14h.01M17 14h.01` (stroke 2.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| pencil      | `M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| flask       | `M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 14h9`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| hash        | `M10 4 8 20M16 4l-2 16M5 9h15M4 15h15`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| pin         | `M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21zM12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| boltRetry   | refresh plus `M12.6 8.5 10 12.5h3l-.6 3 2.6-4h-3z`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| orbit       | `M12 4a8 8 0 1 1-8 8M12 4v.01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| unlock      | `M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.8-1.1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Animated glyphs**

| Glyph          | Animation                                                                            |
| -------------- | ------------------------------------------------------------------------------------ |
| check          | draws in 420ms on the enter curve                                                    |
| cross          | two strokes of 140ms each, the second starting 60ms after the first                  |
| bang           | the line draws in 200ms, then the dot pops with the reveal spring                    |
| copy to check  | copy scales to .6 and fades out in 120ms; the check draws in 260ms starting at +60ms |
| send           | launches +28, -28 and fades over 240ms                                               |
| refresh        | turns 360 degrees in 500ms; while working, loops at 900ms per turn                   |
| bolt           | draws in 240ms, then flashes                                                         |
| chain          | the halves slide 3pt together over 200ms                                             |
| clock          | the minute hand turns once every 6s while waiting                                    |
| moon           | rocks plus or minus 8 degrees on a 4200ms cycle                                      |
| unplug         | the halves drift apart plus or minus 1.5pt and back over 1800ms                      |
| pause          | the bars scale in with the reveal spring, 60ms apart, then hold still                |
| question       | nods once over 600ms                                                                 |
| shieldAlert    | the stroke blinks every 1600ms                                                       |
| gauge          | the needle sweeps from -30 to 0 degrees over 3s                                      |
| sprout         | grows from its base with the reveal spring, 400ms                                    |
| eye            | blinks over 180ms                                                                    |
| lock to unlock | the shackle lifts over 260ms                                                         |

## 5. Signature components

### Bloom (`src/glyphs/Bloom.tsx`)

- **Geometry.** A 100 viewBox centered at 50,50 with 12 petals at 30i degrees.
  - Angle jitter: +2 degrees on odd i; -1.5 degrees when i%3 is 0.
  - Petal lengths, in order: 1, .96, .99, .94, 1, .97, .95, 1, .98, .95, .99, .96.
- **Petal path** (pointing up): `M-1.6,-8 C-4.2,-18 -9.8,-31 -10.4,-41.5 L-8.3,-44.8 L-6.25,-42.6 L-4.2,-45.6 L-2.1,-43.3 L0,-46 L2.1,-43.3 L4.2,-45.6 L6.25,-42.6 L8.3,-44.8 L10.4,-41.5 C9.8,-31 4.2,-18 1.6,-8 Z`.
  - Below 40pt, use the three-tooth tip: `L-6.9,-45 L-3.5,-42.6 L0,-45.8 L3.5,-42.6 L6.9,-45 L10.4,-41.5`.
- **Fill.** A userSpace gradient from y -8 to -46: bloomNight, bloomDeep at .45, bloomHi.
- **Vein.** `M0,-12 L0,-38`, bloomNight at .35 alpha, width .8. Full detail only.
- **Center.** Circle r7.5 in stamen, with 8 anthers (r1.1) at radius 9.5 and 5 pollen dots (r.9) at radius 5. At mark size the center is a plain circle, r8.
- **Tones.**
  - live: gradient fill
  - test: slate outline, stroke 1.6
  - dormant: husk and bark
  - honey: the halo ring only
- **Petal state q, from 0 to 1.** Each petal's q is a reveal spring that fires when progress crosses i/12.
  - scaleX: .18 + .82q
  - scaleY: (.25 + .75q) × length
  - rotate: theta - 14(1-q)
  - opacity: .25 + .75q
- **Modes.**
  - **Breathe:** the wrapper scales to 1.035 and rotates 1.5 degrees over 4200ms, sine.
  - **Chase:** petal opacity is .35 + .65 × max(0, 1 - ((head - i) mod 12) / 4), with head running 0 to 12 over 1320ms, linear.
  - **Ratchet:** +30 degrees every 600ms (snap spring).
  - **Burst:** q goes to 1.12; a clone scales to 1.6 and fades over 700ms; the center pops 1.3 (boing).
  - **Wilt:** petals rotate +10 degrees and shrink to .92 length, crossfade to dust, and the wrapper shakes.
  - **Fold:** q runs in reverse, 40ms apart.
  - **Fall:** petals drop 48pt, rotate plus or minus 25 degrees and fade, 60ms apart.
- **Performance.** Petals are `Animated.View`s wrapping static SVG. Loops animate transform and opacity only.

### Odometer (`src/glyphs/Odometer.tsx`)

- **Cells.**
  - Each cell is a clipped column holding "0..9,0".
  - Cells are keyed by place value from the right.
  - Separator cells are .30em wide.
  - BTC always shows 8 decimals, with trailing zeros in dust.
- **Rolling.** A shared value v (in sats) animates over clamp(280 + 140 × log10(|delta| + 1), 280, 1100)ms on the standard curve. For place k:
  - u = 10^k
  - whole = floor(v / u)
  - rem = v - whole × u
  - pos = whole % 10 + rem when k is 0. Otherwise pos = whole % 10 + smoothstep(clamp((rem - .9u) / (.1u), 0, 1)).
  - translateY = -pos × lineHeight.
- **Unit swap.** The outgoing cells lift and fade (140ms, 12ms apart). The incoming cells rise with the snap spring.
- **Mask.** Each digit jumps 4 times at 40ms, then crossfades to a 6-dot mask (scale in with snap, 20ms apart).
- **Stale.** The color moves to steam, and each cell dips in opacity to .65 in turn, 60ms apart, repeating every 2600ms.
- **Accessibility.** The whole odometer is one element; the cells are hidden from assistive tech.

### Vessel

- **Shape.** A pill under the hero. It is a 2pt cream hairline at .25 alpha when everything is spendable, and swells to 8pt when money is in flight.
- **Segments.**
  - Available: solid bloom.
  - Arriving: bloom glass at .35 alpha, with a sheen that sweeps across every 2400ms.
- **Styles, chosen from `snapshot.wallet.lfbw`:**

  | Source                                      | Look                                          |
  | ------------------------------------------- | --------------------------------------------- |
  | wait/below-floor (under 25,000 sats)        | dust "seeds" that bob 1pt                     |
  | splice-in, open, open-v2                    | glass plus a `sprout`                         |
  | wait/fee-too-high                           | honey glass, no sheen, plus a honey `gauge`   |
  | failed                                      | radish glass plus `refresh` with a retry ring |
  | wait/splicing, channel-pending, unconfirmed | slow sheen plus `clock`                       |
  | lastSplice conflicted                       | reversed honey sheen plus `rewind`            |
  | lastSplice reverted                         | sage wash plus `rewind`                       |
  | unpairedFunding                             | `inflow`                                      |

- **Channelize.** When funds move into the channel, the solid segment grows with the soft spring and a cream ripple runs along the seam.
- **Tap.** The vessel expands to 28pt and shows both numbers for 3s.

### PulseDot

- **Shape.** A 7pt dot at the mark's bottom right.
- **States.**
  - sage: pings on each successful poll (scale to 2.6, fade, 900ms)
  - honey: pulses 1 to 1.3 every 1800ms while reconnecting
  - hollow radish: refresh failed

### StatusRing (40 / 96 / 120pt)

- **Layers:** track, progress arc, orbit, halo, glyph slot.
- **Transitions:**

  | To        | What happens                                                                              |
  | --------- | ----------------------------------------------------------------------------------------- |
  | completed | progress fills to 1 over 360ms; the check draws starting at +120ms; the ring pops to 1.08 |
  | failed    | turns radish, shakes, draws a cross                                                       |
  | uncertain | steady honey with the halo looping, plus `pause`                                          |
  | expired   | the stroke becomes dashed (3 5) and fades to .55                                          |

### CopyChip

- **Look.** A mocha pill holding the value in mono, shortened in the middle and grouped in fours, with a `copy` glyph.
- **Tap.** A tick, then `copy` morphs into a sage check while a cream wash sweeps across (180ms in, 700ms hold, 600ms out). Screen readers hear "{Label} copied".
- **Long press.** Expands to show the full value.

### HoldButton

- **Look.** An 88pt circle with a 4pt ring and a `send` glyph.
- **Press in.** Scales to .94. The fill runs over 700ms on `bezier(.35,0,.25,1)`, with ramp haptics.
- **Complete.** A thud, a cream flash, a pop to 1.06, then the arrow launches and 12 petal sparks burst.
- **Released early.** The fill drains with the snap spring.
- **With warnings.** The fill is honey and takes 1000ms.
- **Accessibility.** An `activate` action sends immediately.

### ExpiryRing

- **Shape.** An outer ring at r+8, stroke 2.5, in bloom. It depletes linearly over `expiresAt - now` using a single `withTiming`.
- **Late states.** At 10s or less it turns honey; at 3s or less it pulses.
- **Expired.** The stroke collapses to 0, and the arrow rotates -135 degrees while `refresh` draws in.
- **Request frames.** The same ring runs around the QR frame's perimeter, and turns honey in the request's last tenth or last minute, whichever is longer.

### QrBloom

- **Modules.** Built with `require('qrcode').create(uri, {errorCorrectionLevel: 'M'}).modules`, split into 5 bands by distance from the center, plus the finder squares.
- **Reveal.** The card scales .92 to 1. Starting at t80, band k enters at 40k ms. The finder squares pop last.
- **Dissolve.**
  - Expired: outer bands go first.
  - Paid: inner bands go first, imploding to .2 over 420ms.
- **Enlarge.** A shared transition to full width.

### Received celebration

| Time (ms) | What happens                              |
| --------- | ----------------------------------------- |
| 0         | incoming haptic; the QR implodes (420ms)  |
| 120       | the sage ring draws (480ms)               |
| 200       | the amount counts up (700ms)              |
| 600       | the check draws (420ms)                   |
| 700       | the petal burst (800ms) and the sage tint |

On-chain but not yet confirmed: the sequence stops at a sage orbit.

### Keypad

- **Layout.** 1 to 9, blank, 0, backspace.
- **Press.** A mocha disc springs in behind the key (snap) with a tick.
- **Digits.** A new digit rises 12pt as it enters. A removed digit drops 8pt as it leaves.
- **Clear.** Long-pressing backspace for 450ms clears the amount, with a rigid haptic.
- **Limits.**
  - Over what can be spent now, but within the total: honey.
  - Over the total, or over the offline cap: radish, and it shakes once.
  - More than 16 digits: the key is refused.

### Scan reveal

- **Disc.** Its diameter is 2 × the distance from the button to the farthest corner, and it scales up from the button size with the pane spring.
- **Reticle.** Four 28pt corners fly in, 40ms apart.
- **Valid code.** The corners snap to .85 and turn sage.
- **Invalid code.** A radish flash and a shake, and scanning continues.
- **Denied or no camera.** `cameraOff`, `clipboard`, and on denial a `cog` that opens OS settings.

### Whisper

A cocoa pill anchored above its source (see rule 3).

## 6. State to visual map

### Shell phases

| Phase               | What it shows                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lock check          | roast; the bud fades in after 250ms                                                                                                                                                                                                                                                                                |
| locked              | A closed bud (120pt, q .08) breathing, with the biometric glyph (faceScan, fingerprint, eye or passcode) below it. The whole screen is the button. Prompting: the glyph draws in a loop. Refused: the bud shakes and the glyph flashes radish (error haptic). Unlocked: the petals unfold, then Home builds (R-1). |
| transit closing     | the mark flies to center at 96pt and the petals fold                                                                                                                                                                                                                                                               |
| transit switching   | the bloom ratchets and recolors to the target network's color                                                                                                                                                                                                                                                      |
| transit erasing     | the petals fall; a husk bud breathes                                                                                                                                                                                                                                                                               |
| opening             | the chase loader at 96pt                                                                                                                                                                                                                                                                                           |
| saved (open failed) | A dormant bloom and the wallet name, a radish pip when there is an error, a 64pt `refresh` (Open device wallet), and a `cog` for network settings.                                                                                                                                                                 |
| welcome             | The bloom unfolds, then breathes. Controls: a 72pt `sprout` (Create a wallet, bloom fill), a 56pt `restore` outline, a 44pt `cog`. On error the bloom half-wilts and `refresh` (Try again) replaces `sprout`.                                                                                                      |
| picker              | Wallet rows: mark, name, and `flask` on test networks. Then a `sprout` row, and `restore`, `cog` and `lock` along the bottom.                                                                                                                                                                                      |
| loading             | The canvas with 5 husk dots breathing in the hero spot, skeleton rows in the sheet, and the actions disabled.                                                                                                                                                                                                      |
| offline             | A dormant mark with a hollow radish dot, `unplug`, a 64pt `refresh` (Retry connection), a 56pt `boltRetry` (Retry wallet setup, with a honey pip when there is a setupError), and a `cog`.                                                                                                                         |

### Wallet health

| State               | Visual                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fresh               | The PulseDot is sage and pings on each poll.                                                                                                                                                      |
| reconnecting        | The PulseDot is honey and pulses.                                                                                                                                                                 |
| stale (45s or more) | The hero goes steam with the shimmer wave; the glow drops to .25; the actions turn dust and scale to .94. Tapping one shakes it, fires a warning haptic, and starts a manual refresh.             |
| cached launch       | The stale look plus a ratcheting mark. The first live read re-saturates it and fires a sage ping.                                                                                                 |
| setup pending       | Petals open to q .6 and the center breathes.                                                                                                                                                      |
| setup ready         | Petals open fully.                                                                                                                                                                                |
| setup failed        | Petals droop, with a honey pip.                                                                                                                                                                   |
| refresh failed      | The PulseDot is hollow radish.                                                                                                                                                                    |
| manual refresh      | The mark ratchets. Pulling down on the top pane opens the petals as you pull: Home's own pan writes `pull`, and the mark folds, then opens a petal each twelfth of the way, whole at the trigger. |
| hidden              | 6-dot masks everywhere, toggled by long-pressing the hero.                                                                                                                                        |
| unit                | Tapping the hero rolls between sats and BTC.                                                                                                                                                      |
| test network        | Slate replaces bloom everywhere, with a `flask` micro-glyph.                                                                                                                                      |

### Activity row (64pt)

- **Layout.**
  - Left: a StatusRing (40pt) with the kind glyph.
  - Middle: the amount, with the note underneath.
  - Right: the time above the rail glyph.
- **Rail glyph.**
  - `bolt`: Lightning. The id starts `payment:`, or the method is lightning.
  - `chain`: on-chain.
  - `fund`: direct funding.
- **Title.** The engine's title only goes into the accessibility label.
- **Amount styles.**
  - received: sage, 600, "+"
  - sent: cream, 400, "-"
  - request: steam, with the infinity glyph when the amount is open
  - transfer: cream, no sign
  - failed or expired: dust, struck through
- **Rings.**

  | State              | Ring                                                                 |
  | ------------------ | -------------------------------------------------------------------- |
  | completed sent     | a steam ring with `send`                                             |
  | completed received | a sage ring with `receive`                                           |
  | pending            | a bloom orbit                                                        |
  | request waiting    | dashed, rotating once every 8s; `moon` when it is an offline request |
  | confirming         | a sage orbit plus the fill                                           |
  | partial            | a sage arc plus a honey dashed remainder                             |
  | uncertain          | steady honey, a halo, `pause`                                        |
  | failed             | a radish `cross`                                                     |
  | expired            | dust dashes; the row drops to .55                                    |
  | unavailable        | a gap plus `question`                                                |
  | legacy             | a `chain` micro-glyph                                                |
  | reused address     | honey `twin`                                                         |
  | transfer           | `swap`                                                               |

- **Attention shelf.** Pinned first: the backup tile, then uncertain items, then partial ones.
- **Filters.** Glyph chips: send, receive, qr, orbit. Tapping the active chip again clears it. `search` expands into a field.
- **Empty.** A dormant bud outline that breathes.

### Send

| State                   | Visual                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compose                 | A request well with 44pt `clipboard` and `scan` buttons and a breathing dashed border.                                                                         |
| accepted                | The well collapses into a chip: rail glyph, shortened destination, and `lock` if the amount is fixed.                                                          |
| fixed amount            | The keypad drops away and a `lock` sits beside the amount.                                                                                                     |
| amount entry            | The keypad. Honey plus `clock` when over what can be spent but within the total; radish when over the total.                                                   |
| preparing               | The control orbits.                                                                                                                                            |
| review                  | The chip, the amount at 48pt, then the lines `rail + <= fee`, `~ expected`, `= total`. The HoldButton sits inside the ExpiryRing. Warnings show as honey pips. |
| expired                 | The ring retracts and `refresh` appears (warning haptic).                                                                                                      |
| sending                 | The arrow launches and an orbit starts.                                                                                                                        |
| completed               | A 120pt cream disc with an ink check. Returns home after 2200ms.                                                                                               |
| pending                 | An orbit.                                                                                                                                                      |
| uncertain               | A 120pt honey ring, steady, with a halo and `pause`. No resend. Assertive announcement. `held` haptic.                                                         |
| held request re-entered | Goes straight to the held ring.                                                                                                                                |
| failed                  | A radish `bang`, a shake, and the tint.                                                                                                                        |
| stale                   | The control is dust; a tap shakes it and refreshes.                                                                                                            |

### Receive

| State                | Visual                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| amount               | Shows infinity while empty. Preset chips (1,000 / 10,000 / 50,000), `pencil`, `moon` when offered.                                  |
| amount required      | A dust 0 with a caret, plus `sprout`.                                                                                               |
| offline on           | The moon fills, the night tint shows, and the cap is marked on the amount.                                                          |
| quote                | `- fee = net`. The create control is a tap, inside the expiry ring.                                                                 |
| request              | QrBloom with a frame ring, rails beneath (`bolt` + `chain`, or `bolt` only), a moon badge when offline, `share`, `copy` and `plus`. |
| near expiry          | The frame turns honey.                                                                                                              |
| expired              | The QR dissolves; share and copy are removed.                                                                                       |
| reused address       | The QR scatters, a honey `twin` appears, share and copy are removed, and `plus` becomes the primary control.                        |
| tracking unavailable | A `question` badge.                                                                                                                 |
| detected             | Celebration part 1.                                                                                                                 |
| partial              | A split ring showing received over requested, and `plus` with the remainder.                                                        |
| completed            | The full celebration.                                                                                                               |

### Backup and setup

- **Backup pending.** A honey halo on the mark and a shield tile in the shelf. It cannot be dismissed, and tapping it opens Settings > Recovery phrase.
- **Reveal (Settings).** A biometric prompt, then the words rise in order.
- **Confirming saved.** A 900ms hold that turns honey to sage. The halo then shrinks into the mark.
- **Restore entry.** Each word lights a petal. From word 13 a second ring lights. More than 24 words turns it radish and shakes. At 12 or 24 the center pops and the control enables.

### Engine errors

| Code                                    | Visual                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INSUFFICIENT_FUNDS, amount within total | honey, plus a vessel marker                                                                                                                                                               |
| INSUFFICIENT_FUNDS, amount over total   | radish and a shake                                                                                                                                                                        |
| parse and refused inputs                | the chip dissolves with a `cross`                                                                                                                                                         |
| PRIMARY_DOWN                            | honey `unplug`                                                                                                                                                                            |
| NO_ROUTE                                | `bolt` plus `cross`                                                                                                                                                                       |
| FUNDING_UNCONFIRMED                     | `chain` plus `clock`                                                                                                                                                                      |
| AMOUNT_REQUIRED                         | the infinity glyph shakes to 0                                                                                                                                                            |
| RECEIVE_UNAVAILABLE                     | the moon shakes off                                                                                                                                                                       |
| QUOTE_EXPIRED                           | `refresh`                                                                                                                                                                                 |
| AMBIGUOUS_RECEIVE_ADDRESS               | twin                                                                                                                                                                                      |
| INVALID_MNEMONIC                        | wilt                                                                                                                                                                                      |
| anything unmapped                       | a radish `bang`, a shake and an error haptic (user-initiated only). The full message goes to `recordDiagnostic` and is announced and readable through Whisper and Settings > Diagnostics. |

## 7. Choreography (ms from the tap)

**T1, Home to Send** (T2, Receive, mirrors it with the receive circle):

| Time       | What happens                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0          | tap haptic                                                                                                                                                  |
| 0 to 300   | the sheet slides off the bottom; rows fade out by 140                                                                                                       |
| 0 to 140   | scan and receive fade and shrink to .8; the vessel fades; the cog spins out                                                                                 |
| 0 to 320   | the hero shrinks to the mini strip (scale .34), rolling from the total to the available amount; the tapped circle moves to bottom center and grows 56 to 88 |
| 80         | the close control spins in                                                                                                                                  |
| 80 to 300  | the well rises 12pt                                                                                                                                         |
| 120 to 360 | keypad rows enter, 30ms apart                                                                                                                               |

Going back reverses it: content exits in 140ms, the springs reverse, and rows re-enter 25ms apart.

**T3, Scan.** The disc reveal. On detection the circle collapses into the send well.

**T4, Row to Detail:**

| Time       | What happens                                        |
| ---------- | --------------------------------------------------- |
| 0          | tick; the sheet moves to compact                    |
| 0 to 140   | the other rows fade out and drop 8pt                |
| 0 to 320   | ring and amount clones fly to the header (40 to 96) |
| 120 onward | lines stagger in, 40ms apart                        |

**T5, Home and Activity.** Driven by the gesture. Progress interpolates:

- hero scale: 1 to .34
- action row opacity: 1 to 0 over the first .4
- vessel opacity: 1 to 0 over the first .3
- filter bar: fades in over the last .6 to 1

Release on velocity over 800pt/s, or past 40% going up or 25% going down. Rubber band at .35 past the ends.

**T6, Settings.** The cog spins 120 degrees; the canvas scales to .94 and dims to .5; Settings slides in from the right. Swiping from the edge goes back.

**R-1, unlock:**

| Time        | What happens                       |
| ----------- | ---------------------------------- |
| 0           | success haptic; the bloom unfolds  |
| 500 to 880  | the bloom flies to the mark (28pt) |
| 600 to 1500 | the hero counts up                 |
| 650         | the sheet rises                    |
| 700         | the actions pop in, 50ms apart     |
| 750         | the rows stagger in, 30ms apart    |

**R-2, choosing a wallet.** The tapped control grows into the loader, which flies to the mark once a wallet id exists.

**R-3, skeleton to live.** The dots shrink as the digits roll in, the vessel draws, the actions brighten, the rows crossfade, and a sage ping plays.

**R-4, to offline.** The chase stops, the petals go dormant, and `unplug` pops in (warning haptic).

**R-5, offline to live.** The bloom re-saturates, bursts, and `unplug` splits apart (success haptic).

**R-6, live to closing, switching or erasing.** The sheet drops, the digits roll out, and the mark flies to center.

## 8. Reduced motion

- Movement through space becomes a crossfade of 160ms or less, and loops become static states.
- Countdown rings still deplete, and color thresholds still apply.
- Haptics are unchanged.
- Specific substitutions:
  - A static open bloom, with petals at .6 opacity plus `busy` while loading.
  - Values swap with a 120ms crossfade.
  - The arriving glass gets a static 45 degree hatch.
  - Reconnecting is a hollow honey ring.
  - A shake becomes a 400ms radish tint.
  - The hold fill still runs.

## 9. Accessibility

- **Controls.** Every glyph control sets a role, a label, and its disabled, busy or selected state. Decorative SVG is hidden.
- **Announcements.** A single `announce(text, {assertive})` helper.
  - The safety states announce assertively.
  - Identical messages within 2s are dropped.
- **Focus.** After each transition, focus moves to the new primary element.
- **Home focus order:** mark, hero, vessel, Send, Scan, Receive, cog, sheet.
- **Shape as well as color.** Every state has a distinct shape.
- **Strings.** All strings live in `src/design/copy/`, one file per area (shared, home, activity, detail, send, receive, scan, phases, settings), composed into one `copy` object by its `index.ts`. The legacy phrases that tests assert are kept verbatim, for example:
  - "Total balance {n} sats"
  - "{a} sats ready to send, {p} sats arriving"
  - "Balances are unavailable until the connection is restored."
  - "Save your recovery phrase."
  - "Point at the code."
  - "Payment request QR code"
  - "Chicory stays locked until this is confirmed."
- **Phrases that must never appear** in labels: "Pull to refresh", "Welcome back", "Sent, just like that.", "Share this request.", "Explore a preview", "Connect a host".

## 10. Component contracts

The parallel tracks build these. Each exists now as a still placeholder at its final path with its final props, so the app runs, tests can target it, and a track can replace the inside without touching a caller. A signature changes only by agreement, because other tracks already call it.

### 10.1 Canvas

- **`src/stage/layout.ts`** (pure).
  - `stops(H, insets)`: `full` = `insets.top`, `compact` = `insets.top + 72`, `home` = `max(insets.top + 380, 0.5H)`, `gone` = `H + 24`. The canvas draws edge to edge, under the status bar, so it passes the real safe-area insets and measures `H` from its root `onLayout`.
  - `SCENE_LAYOUT`: each scene's `{ seam, hero, bar }`. Home is `home`/1/1; activity and detail are `compact`/0/0; send and receive are `gone`/0/0. Settings has none.
  - `canvasScene(state)` and `canvasLayout(state)`: under Settings the canvas keeps the pose of the scene it covers, plus `covered`.
  - `STATUS_ROW` (56), `HERO_MINI` (.34), `MINI_STRIP` (44), `COVERED` (scale .94, opacity .5), `SCANNING` (scale .96, opacity .5) and `PANE_SETTLE_MS` (340). `canvasLayout` also takes the overlay and answers `scanning` while the scan overlay is open.
  - `MINI_STRIP` is the band under the status row that Send and Receive leave clear: the balance rests there as the mini strip while either is open. Under Activity and a payment's detail the sheet's compact stop leaves no band, so the strip rests in the middle of the status row instead, and the hero's landing springs between the two (`miniLanding` in `scenes/home/motion.ts`).
- **`src/stage/panes/Pane.tsx`**.
  - `Pane({ active, style })`: a layer of the canvas. When it is not active it gets `pointerEvents` `none`, `accessibilityElementsHidden` and `importantForAccessibility` `no-hide-descendants`. Panes nest.
  - `usePaneActive()`: whether the pane a component is drawn in is in use. It is true outside any pane.
  - `usePanes()`: the canvas's shared values: `seam` (the sheet's top edge in points), `hero` (0 is the mini strip, 1 the full balance), `bar` (the action row's opacity), `cover` (0 to 1 as Settings covers the canvas), `scan` (0 to 1 as the scan overlay opens over it), `pull` (how far a finger pulls the home pane down, in points, and 0 once it lets go; Home's pan writes it and the status row's mark opens with it), and `stops`.
- **Rules for anything drawn on the canvas.**

  - A control in a pane passes its handlers (`onPress`, `onLongPress`, `onChangeText`, `onAccessibilityAction`) only while `usePaneActive()` is true. `Button`, `IconButton` and `Chip` take no touches without an `onPress`.
  - Panes stay mounted and only move. Scene content in a slot is keyed by the scene's key and enters with `sceneIn` and leaves with `sceneOut`; Settings slides with `slideIn` and `slideOut`.
  - The stage actions are taps. A tap is refused while a pane moves, and otherwise starts the panes in its own tick. `setBusy`, the session's `tab` and `reset`, and payment links never wait on the lock. Android back is swallowed while a pane moves.
  - A gesture hands its speed to the move it ends in: `openActivity` and `home` take an optional `Fling` (`{ velocity }`, the sheet's speed in points a second), which `PaneMotion.follow(next, fling)` passes to the seam's spring, so a flung sheet carries on from the finger. A press event passed to either carries no speed.
  - `SceneSlot` takes `offset`, how far below the top of the safe area its parent starts, so a lower slot still clears the keyboard.
  - **Focus** (9). `useFocus(on)` in `src/motion/focus.ts` returns a ref a screen reader lands on whenever `on` turns true, once no transition is running; the phases and Settings use it, and `focusOn(node)` moves focus at once. On the canvas each region names its scene's primary element with `usePrimary()` from `stage/panes/Primary`: the `SceneSlot` header (Send, Receive, a payment's detail, Settings), Home's balance, and the open list's first filter. The canvas moves focus there as each scene settles, and again as an overlay over it closes; while an overlay is open it moves nothing.

- **Regions.** The canvas places the regions, activates the panes and runs the motion; what each region draws lives with its scene under `src/scenes`. Every region takes the same `RegionProps` from `stage/Canvas`, whole: `snapshot`, `client`, `session` (the `CanvasSession`), `view` (the `CanvasView`, with `hidden`, `setHidden`, `unit` and `setUnit`), `stale`, `backup` and `arrived` (a count that goes up with each read that brought money in; the canvas calls `useIncoming` once, so every region keys its flash, burst or roll on the same arrival and the incoming haptic plays once). It adds only what is its own, reads the stage actions from `useStage()`, and computes the rest itself, so a region that needs more of these never needs the canvas changed. In the top pane's order:
  - `scenes/home/Backdrop` (the ground, drawn first, behind everything and full bleed, under the status bar too; it draws the 3.2 gradients and the G3 tints from `snapshot`, `stale`, `backup`, `session` and `arrived`, and the tints the scenes ask for through the tint channel below);
  - `scenes/home/StatusRow` (`shown`; the mark and the connection at the left, with `RefreshFailed`, the refresh notice Home still writes), `scenes/home/HomePane` (`home`; `hero` scales the balance, `bar` fades only the action row);
  - `panes/CornerControl`, which the canvas draws itself after Home, at the top right inside the top inset, so a screen reader reaches it in the home order (9). The status row leaves it `CORNER_ROOM`;
  - `scenes/send/SendScene` (`sceneKey`, `prefill`) and `scenes/receive/ReceiveScene` (`sceneKey`), in the top slot, arriving through `panes/Arriving`;
  - `scenes/activity/SheetPane` (`shown`; the grip at home, the one Activity list);
  - `scenes/detail/DetailLayer` (`item`, `from`; the `DetailCard` in the slot at the compact stop);
  - `scenes/settings/SettingsLayer`, whose root carries the copy guard's marker, `testID="scene-settings"`. `SettingsScreen` takes `backupPending` and `onBackupSaved` for the recovery phrase flow.
- **Settings-class surfaces** (rule 2) carry the copy guard's marker at their root, `SETTINGS_SURFACE` from `scenes/settings/ui`: `SettingsSurface` roots Settings and the new wallet sheet (`CreateSheet`), and a phase's `SetupPanel` roots the setup it opens (network and device setup, the recovery phrase). None is ever drawn beside another, so a tree holds at most one marker, and the guard throws on a second rather than read past a surface that is not settings-class.
- **Backup.** A pending backup reaches the regions as data, `backup: { pending, loadPhrase, onSaved } | null`, never as a rendered node. `scenes/shared/BackupBanner` draws it as the old screens did until Home and Settings replace it.
- **Tint channel.** A scene asks the ground for a G3 tint (3.2) through `StageContext` rather than laying one over its slot, and Send and Receive lay no ground of their own, so the backdrop shows through them. `useHoldTint(tint)` holds `'night'` or `'honey'` while `tint` is set and the caller is mounted (Receive holds night while an offline receive is chosen; Send holds honey while an outcome is unknown or a request is held); honey is a safety state and wins over night. `useFlashTint()` returns `flash('sage' | 'radish')`, which plays once (the receipt flashes sage as a paid request's petals burst; Send flashes radish as a payment fails). `useTint()` is what the backdrop reads: `{ held, flash: { tint, key } | null }`. The channel is a store of its own on the stage (`StageStore.tint`), so a change draws only the ground again; outside a stage every hook does nothing. The backdrop takes a flash within 3s of the last of its kind for the same moment, since a scene and the next read of the wallet often report one arrival or one failure twice.
- **Responders.** `useSceneBack(handler, active)` and `usePhaseBack(handler)` from `StageContext` answer Android back (2.2). `useScanReceiver(receiver, active)` takes a code scanned for the Send already open (2.3). Its `active` is `useIsCurrentScene(sceneKey)`, true while the scene keyed `sceneKey` is the one the stage shows, overlays aside, and never `usePaneActive()`, which the scan overlay turns false.

### 10.2 Glyphs and layers

| Component                 | Props                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glyphs/Bloom`            | `size`, `mode?` `'still' \| 'breathe' \| 'chase' \| 'ratchet'`, `open?` (0 to 1), `tone?` `'live' \| 'test' \| 'dormant'`, `halo?`, `event?` `{ kind: 'burst' \| 'wilt' \| 'fold' \| 'fall' \| 'shake'; key }`, `detail?` `'full' \| 'mark'`, `opening?` (a shared value, 0 to 1), `lit?` (0 to 24), `accessibilityLabel?` | Decoration unless labelled, then one `image`. `detail` defaults to `mark` below 40pt. An `event` plays when its `key` changes. `opening` is a pull read on the UI thread: past 0 the petals fold and one more opens on the reveal spring each twelfth of the way (`pulledPetal`), and at 0 they return to `open`. `lit` counts the words of restore entry (`litRings`): the front ring's first twelve, then a ring behind, turned 15 degrees and 1.25 times as long, once the front is whole; unlit petals stand dormant, and past 24 every petal is radish. |
| `glyphs/Odometer`         | `sats`, `unit`, `masked?`, `stale?`, `variant` `'hero' \| 'amount' \| 'amountDetail' \| 'line' \| 'row'`, `color?`, `sign?` `'+' \| '-' \| null`, `room?`, `accessibilityLabel?`                                                                                                                                           | One accessible element; reads the amount in sats by default, "Amount hidden" when masked, and a masked amount draws its dots alone, without its sign. Also exports the pure worklet `digitPosition(v, k)` and `cellsFor(sats, unit)` (cells keyed `d{place}` by place value, BTC always 8 decimals with trailing zeros `dim`).                                                                                                                                                                                                                               |
| `glyphs/Vessel`           | `availableSats`, `pendingSats`, `lfbw?`, `unit`, `masked?`, `stale?`                                                                                                                                                                                                                                                       | Reads "{a} sats ready to send, {p} sats arriving". The look comes from the pure `vesselVisual(balance, lfbw)` in `scenes/home/visual.ts`: `{ weight, solid, fill, sheen, glyph, tone, retry }`.                                                                                                                                                                                                                                                                                                                                                              |
| `glyphs/PulseDot`         | `state` `'live' \| 'reconnecting' \| 'failed' \| 'hidden'`, `pingKey?`                                                                                                                                                                                                                                                     | Labelled with the health copy; `hidden` draws nothing. A new `pingKey` is a successful poll.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `glyphs/StatusRing`       | `size` `40 \| 96 \| 120`, `visual: RingVisual`, `test?`                                                                                                                                                                                                                                                                    | Decoration. `RingVisual` is `{ tone, pattern, progress?, split?, glyph, badge? }`, from the pure `ringVisual(activity)` in `scenes/activity/visual.ts`. Uncertain is honey `held` with `pause`, and never shares a tone or pattern with a completed ring. With `test` (a test network) a bloom tone draws in slate; the rows and the detail pass it from the wallet's network.                                                                                                                                                                               |
| `glyphs/CopyChip`         | `label`, `value`, `glyph?`                                                                                                                                                                                                                                                                                                 | Label "Copy {label}", the label lowercased. A tap copies and announces "{Label} copied"; a long press shows the whole value.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `glyphs/HoldButton`       | `accessibilityLabel`, `onCommit`, `warning?`, `disabled?`, `busy?`, `children?`, `accessibilityValue?`, `ref?`                                                                                                                                                                                                             | No `onPress`: a tap never commits. The hold is 700ms, 1000ms with `warning`. `accessibilityActions` is `[{ name: 'activate' }]`, so a test commits with `onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })`, which `activate(tree, label)` in `test-support/query` does (`holds(tree, label)` finds the holds). `accessibilityValue` is heard after the label (Send passes the quote's time left); `ref` is the circle, which Send moves a screen reader to.                                                                                |
| `glyphs/ExpiryRing`       | `size`, `expiresAt`, `createdAt?`, `shape?` `'circle' \| 'rect'`, `width?`, `height?`, `radius?`, `lateAt?`, `onExpired?`                                                                                                                                                                                                  | Decoration. Honey at 10s or less, or from `lateAt` when that is sooner (a request's frame passes its last tenth or minute); `onExpired` fires once. It draws no refresh: the owner's control turns to refresh at zero.                                                                                                                                                                                                                                                                                                                                       |
| `glyphs/QrBloom`          | `value`, `size`, `state` `'shown' \| 'expired' \| 'paid' \| 'scattered'`, `onPress?`, `onLongPress?`, `accessibilityLabel`                                                                                                                                                                                                 | Ink on cream. Only `shown` draws a scannable code or takes a press.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `glyphs/Whisper`          | `WhisperProvider`; `Whisper({ label, children })`                                                                                                                                                                                                                                                                          | The provider sits at the Stage root. A 400ms long press on a `Whisper` shows `label` in the pill for 2400ms with a `tick`; otherwise it only renders its children.                                                                                                                                                                                                                                                                                                                                                                                           |
| `stage/layers/ScanReveal` | `origin` (`{ x, y }` or null), `target` `'home' \| 'send'`, `onDetected`, `onCancel`                                                                                                                                                                                                                                       | For the scan overlay. The placeholder is the existing `Scanner`, full screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `stage/layers/DetailCard` | `item`, `from` (`Rect` or null), `children`                                                                                                                                                                                                                                                                                | The canvas places it at the compact stop and keys it by scene; `children` are laid out from its top. Without `from` it fades.                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 10.3 Keypad

The amount keypad (`src/scenes/keypad`) replaces the system keyboard for amounts in Send and Receive. The suites drive it only through `test-support/keypad.ts` (`enterAmount`, `amountValue`), so its labels are a contract, kept in `copy.keypad` (`src/design/copy/send.ts`):

- **Container.** One view labelled `copy.keypad.label`, "Amount keypad". Its presence is how `enterAmount` knows a keypad is drawn; without one it types into the `AmountField` instead.
- **Digit keys.** Each is a button labelled with its digit alone, `copy.keypad.digits[d]`, "0" to "9".
- **Backspace.** A button labelled `copy.keypad.backspace`, "Delete last digit", with the hint `copy.keypad.backspaceHint`. `enterAmount` presses it until the amount reads empty, at most 16 times.
- **The amount.** Stays labelled `copy.amount.field`, "Amount in sats", and carries its digits in `accessibilityValue.text` (for example "4,200 sats"). An amount showing only zeros counts as empty. The label is only ever spoken, never drawn.
- **`AmountField` extras.** `empty` stands in the amount while it has no digits, in place of the dust 0 (Receive's infinity, or its dust 0 with a blinking caret). `tone` (`'honey' | 'radish' | 'dust'`) holds it against a limit: honey with a `clock` over what can be spent now, radish with a `bang` and one shake past what it can ever be, dust under the least it can be. Each change of `shake` shakes it once more. Its keys take touches only while its pane is in use.
- **Presets** stay chips labelled with the amount alone, as `copy.amount.preset` formats it.

### 10.4 Motion helpers

Shared by every glyph and scene, in `src/motion` (tokens and presets aside):

- **`loops.ts`.** `useLoop(period, running)` is the one loop clock: it counts a cycle every `period` ms and eases to the nearest whole cycle when it stops, and it rests wherever nobody would see it move (the app in the background, its pane out of use, Reduce Motion). A loop that turns reads `fract(clock)`; one that goes out and back, a breath or a pulse, reads `wave(clock)`, so a whole breath is one period. `useAwake()` is whether a loop here would be seen.
- **`springMath.ts`.** `springStep`, `kickVelocity` and `kick`, for poses computed from a clock on the UI thread and for pops that start from rest.
- **`effects.ts`.** `useShake()` (a shake, or a 400ms radish tint under Reduce Motion), `popIn(from?)` and `dissolve()` for something that arrives or is let go of as a whole.
- **`focus.ts`.** `useFocus(on)` and `focusOn(node)` (10.1, Focus).
- `mixHex(from, to, t)` and `alpha(hex, a)` are colour helpers in `src/design/palette.ts`.

## 11. Track ownership

The parallel tracks each edit only the files they own, so they never touch the same file and merge without conflicts. A track that needs a shared file changed asks the integrator instead of editing it. Each track adds the states it redraws to its own guard file under `__tests__/guards`, drawn from `test-support/fixtures.ts`, and its words to its own file under `src/design/copy/`.

- Shared (integrator only, no track edits): `App.tsx`, `src/stage/{Canvas,Stage,StageContext,scene,phase,layout,useBackHandler,useScanReceiver}.ts(x)`, `src/stage/panes/**`, `src/motion/**`, `src/design/{palette,glyphs,glyphLengths,haptics,announce}.ts(x)`, `src/design/copy/{index,shared}.ts`, `src/theme.ts`, `src/components/ui.tsx`, `src/screens/{Wallet,Payments}.tsx` (re-export shims), `test-support/**`, `jest.setup.js`, `.eslintrc.js`, `__tests__/{LabelContract,CopyGuard,A11yCoverage,StorageContract,SceneReducer,Phase,BackNavigation,ScanOverlay}.test.*`, `__tests__/{CanvasMotion,Contracts,TestSupport}.test.tsx` (but see below)
- A Glyph motion: `src/glyphs/{Bloom,Odometer,Vessel,PulseDot,StatusRing,Whisper}.tsx` and their tests.
- B Home: `src/scenes/home/**` (`Backdrop.tsx` included), `src/screens/wallet/Home.tsx`, `src/scenes/shared/BackupBanner.tsx`, `src/stage/useIncoming.ts` (new), `src/design/copy/home.ts`, `__tests__/guards/home.test.tsx`.
- C Activity and detail: `src/scenes/activity/**`, `src/scenes/detail/**`, `src/screens/wallet/{Activity,Detail}.tsx`, `src/stage/layers/DetailCard.tsx`, `src/stage/useStableActivity.ts` (new), `src/design/copy/{activity,detail}.ts`, `__tests__/guards/{activity,detail}.test.tsx`.
- D Send: `src/scenes/send/**`, `src/scenes/keypad/**` (new), `src/screens/Send.tsx`, `src/components/AmountField.tsx`, `src/glyphs/{HoldButton,ExpiryRing}.tsx`, `src/stage/heldRequests.ts` (new), `src/design/copy/send.ts`, `__tests__/guards/send.test.tsx`.
- E Receive: `src/scenes/receive/**`, `src/screens/Receive.tsx`, `src/components/{ReceiveReceipt,ReceiveRequestDetails,Toast}.tsx`, `src/glyphs/{QrBloom,CopyChip}.tsx`, `src/design/copy/receive.ts`, `__tests__/guards/receive.test.tsx`.
- F Scan: `src/stage/layers/ScanReveal.tsx`, `src/components/Scanner.tsx`, `src/design/copy/scan.ts`, `__tests__/guards/scan.test.tsx`.
- G Phases: `src/scenes/phases/**`, `ios/chicory/LaunchScreen.storyboard`, the Android launch background resources under `android/app/src/main/res` (the window background in `values/colors.xml` and `values/styles.xml`, and a launch drawable it adds under `drawable/`), `src/design/copy/phases.ts`, `__tests__/guards/phases.test.tsx`, `__tests__/NativeCopy.test.ts` (new).
- H Settings: `src/scenes/settings/**`, `src/screens/{Settings,NetworkSettings,DeviceSetup}.tsx`, `src/components/RecoveryPhrase.tsx`, `src/stage/layers/CreateSheet.tsx`, `src/services/hapticsPreference.ts` (new), `src/design/copy/settings.ts`, `__tests__/guards/settings.test.tsx`.
- Any other source file not named above is shared: a track that needs it changed asks the integrator. Track G may edit only the launch files named above under `ios/` and `android/`, and no track edits any other native file.
- Existing test suites are edited by the track whose surface they exercise; where two tracks must edit the same suite, each edits only the tests (it blocks) for its own surface.
- `__tests__/CanvasMotion.test.tsx`, `__tests__/Contracts.test.tsx` and `__tests__/TestSupport.test.tsx` are shared, with one allowance: a track may update the assertions in them that inspect its own region's internals (for example CanvasMotion's `homeParts` for the home track), and nothing else.
- **Copy.** A track may read any area's words, but adds new strings only in its own area file. A string another area owns is duplicated into its own area rather than edited where it is. Track D owns the keypad words: `copy.keypad` in `send.ts`, which `index.ts` also serves as `copy.amount.backspace` and `copy.amount.backspaceHint`.
- **Moved at integration.** Once every track had merged, the helpers the tracks kept in their own files for want of a shared one moved to shared files: the loop, awake and spring helpers from `glyphs/Bloom.tsx` and the loop, shake, pop and dissolve from `scenes/send/motion.ts` to `src/motion` (10.4), `mixHex` and `alpha` to the palette, and `useFocus` from `scenes/settings/ui.tsx` to `src/motion/focus.ts`, which also replaces the phases' own arrival hook. `useIncoming` is called once, by the canvas. Home's `GestureRoot` and `PullBloom`, and `components/CopyValue.tsx`, are gone.
- **Bottom inset.** The canvas runs to the bottom edge, under the system bars. Each region that runs to the bottom edge (home, sheet, detail, send and receive) applies the bottom safe-area inset itself, so Android's 3-button bar never covers its content.
