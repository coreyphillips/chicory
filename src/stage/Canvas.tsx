import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, {
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { scheduleOnRN } from 'react-native-worklets';
import { haptics } from '../design/haptics';
import { beginTransition } from '../motion/idle';
import { dropAway, riseFrom, slideIn, slideOut } from '../motion/presets';
import { ENTRY_GRACE_MS, useSureEntry } from '../motion/sureEntry';
import { steady } from '../motion/steady';
import { curves, durations } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { SheetPane } from '../scenes/activity/SheetPane';
import { DetailLayer } from '../scenes/detail/DetailLayer';
import { Backdrop } from '../scenes/home/Backdrop';
import { HomePane } from '../scenes/home/HomePane';
import { rowBack } from '../scenes/home/motion';
import { StatusRow } from '../scenes/home/StatusRow';
import { isTestNetwork } from '../scenes/home/visual';
import { ReceiveScene } from '../scenes/receive/ReceiveScene';
import { SendScene } from '../scenes/send/SendScene';
import { SettingsLayer } from '../scenes/settings/SettingsLayer';
import type { useWalletSession } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { colors, radius, space } from '../theme';
import type { Unit } from '../theme';
import { ScanReveal } from './layers/ScanReveal';
import {
  COVERED,
  PANE_SETTLE_MS,
  SCANNING,
  STATUS_ROW,
  buildBeats,
  canvasLayout,
  canvasScene,
  launchLanding,
  veilOpacity,
} from './layout';
import type { Arrival } from './layout';
import { BuildProvider, beganAt } from './panes/Build';
import type { Build } from './panes/Build';
import {
  CORNER_REACH,
  CORNER_ROOM,
  CornerControl,
} from './panes/CornerControl';
import { EdgeBack } from './panes/EdgeBack';
import { LaunchProvider, Launched } from './panes/Launch';
import type { Launch } from './panes/Launch';
import { SceneLeave } from './panes/Leaving';
import { Pane, PanesProvider } from './panes/Pane';
import { PrimaryFor, usePrimaryFocus } from './panes/Primary';
import type { Primaries } from './panes/Primary';
import { usePaneMotion } from './panes/usePaneMotion';
import type { Overlay, Scene } from './scene';
import { newestFirst, useStage } from './StageContext';
import { useIncoming } from './useIncoming';

type Session = ReturnType<typeof useWalletSession>;

/** What the canvas and the regions drawn on it use of the wallet session. */
export type CanvasSession = Pick<
  Session,
  | 'error'
  | 'switchError'
  | 'refreshing'
  | 'connecting'
  | 'refresh'
  | 'manualRefresh'
  | 'disconnect'
  | 'chooseWallet'
  | 'switchNetwork'
  | 'eraseDevice'
>;

/**
 * A recovery phrase backup, as data, for each region to draw its own way.
 * `pending` holds until the user confirms the phrase is saved.
 */
export interface Backup {
  pending: boolean;
  loadPhrase: () => Promise<string>;
  onSaved: () => void;
}

/**
 * How the wallet is being looked at. The stage keeps it rather than the
 * canvas, because the canvas goes away under a lock or a network switch and a
 * hidden balance must still be hidden when it comes back.
 */
export function useCanvasView() {
  const [hidden, setHidden] = useState(false);
  const [unit, setUnit] = useState<Unit>('sats');
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  return {
    hidden,
    setHidden,
    unit,
    setUnit,
    filter,
    setFilter,
    query,
    setQuery,
  };
}

export type CanvasView = ReturnType<typeof useCanvasView>;

/**
 * What the canvas gives every region it draws, whole, plus what is the
 * region's own. A region reads what it needs of it, so a region that comes
 * to need more of the wallet, the session or the view takes it without the
 * canvas changing.
 */
export interface RegionProps {
  snapshot: WalletSnapshot;
  client: WalletAdapter;
  session: CanvasSession;
  view: CanvasView;
  /** The balance is too old to spend against. */
  stale: boolean;
  backup: Backup | null;
  /**
   * A count that goes up with each read that brought money in
   * (`useIncoming`), counted once for the whole canvas so every region keys
   * its flash, burst or roll on the same arrival.
   */
  arrived: number;
}

/**
 * The wallet as one surface (REDESIGN.md 2.3). A top pane at the back holds
 * the backdrop, the status row, Home and the corner control, and takes Send
 * and Receive in its slot. A sheet
 * over it holds the one Activity list and moves only by its top edge, the
 * seam. A payment's detail is a card on the sheet at its compact stop, and
 * Settings slides over the whole canvas from the right.
 *
 * Every scene keeps the panes mounted and only moves them, so the list keeps
 * its instance, its scroll and its search from Home to Activity. What a scene
 * does not use stays drawn while it moves away, but inactive: it cannot be
 * touched, a screen reader skips it, and its controls have no handlers.
 *
 * The canvas owns where each region sits, which panes are in use and how
 * they move. What each region draws lives with its scene, under src/scenes.
 *
 * Scan opens over all of it. The panes stay drawn beneath, out of use, and a
 * code it reads goes to the Send already open, or opens a new one.
 *
 * As each scene settles, and as an overlay over it closes, a screen reader
 * lands on the scene's primary element (REDESIGN.md 9): the header of its
 * slot, Home's balance, or the first filter of the open list. Each region
 * names its own with `usePrimary`.
 *
 * Given how it came, `arrival`, the canvas builds in rather than appearing
 * at rest (REDESIGN.md 7, R-1, R-3 and R-5): the hero counts up, the sheet
 * rises, the actions pop in and the rows follow, each on its beat of the
 * build (`useBuild`), and a wallet that was offline bursts its mark with a
 * success. While the build plays, work that waits for a transition, such
 * as moving focus, waits for it too. Leaving, the sheet drops away and the
 * figures roll out (R-6); the lock alone takes it away with no exits.
 */
export function Canvas({
  scene,
  overlay,
  client,
  snapshot,
  session,
  stale,
  backup,
  view,
  arrival,
}: {
  scene: Scene;
  overlay: Overlay;
  client: WalletAdapter;
  snapshot: WalletSnapshot;
  session: CanvasSession;
  stale: boolean;
  backup: Backup | null;
  view: CanvasView;
  arrival?: Arrival;
}) {
  const { state, dispatch, responders } = useStage();
  const { reduced } = useMotionPrefs();
  // Read once, as the canvas mounts: a build only ever plays then. It
  // begins with the canvas's first painted frame (`beganAt`), however long
  // that frame takes to come.
  const [build] = useState<Build | null>(() =>
    arrival ? { arrival, beats: buildBeats(arrival), began: Date.now() } : null,
  );
  useEffect(() => {
    if (!build) return;
    const frame = requestAnimationFrame(() => beganAt(build, Date.now()));
    return () => cancelAnimationFrame(frame);
  }, [build]);
  const [primaries] = useState<Primaries>(() => new Map());
  usePrimaryFocus(primaries, scene, !!overlay);
  const arrived = useIncoming(snapshot);
  const region: RegionProps = {
    snapshot,
    client,
    session,
    view,
    stale,
    backup,
    arrived,
  };

  // Measured rather than assumed. The canvas draws edge to edge, top to
  // bottom under the system bars, and each region keeps its own content
  // clear of them. Only a side cutout, in landscape, narrows it. The
  // window's height stands in until the first layout.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Where the regions under the status row start.
  const belowStatus = insets.top + STATUS_ROW;
  const [measured, setMeasured] = useState(0);
  const height = measured || windowHeight;
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.height),
    [],
  );

  const { stack } = state;
  const layout = useMemo(
    () => canvasLayout({ scene, stack, overlay }),
    [scene, stack, overlay],
  );
  const { panes, blocking } = usePaneMotion(height, layout);

  // The hand-over from the action circle that opens Send or Receive to the
  // scene's own control (REDESIGN.md 7, T1 and T2; `panes/Launch`): the
  // circle travels whole to where the control is drawn, and fades under it
  // once it has landed.
  const landingAt = launchLanding(windowWidth, height, insets);
  const launchX = useSharedValue(landingAt.x);
  const launchY = useSharedValue(landingAt.y);
  const handover = useSharedValue(0);
  // Kept whole from the first draw, so every region reads the same values.
  const [launch] = useState<Launch>(() => ({
    x: launchX,
    y: launchY,
    handover,
  }));
  // As Send or Receive opens, the circle starts over at the slot's bottom
  // centre. Home hands it over once it is on the scene's control, whenever
  // the move gets it there (`landedAt`); in case it never travels, as when
  // Home is not drawn, the hand-over comes by HANDOVER_LATEST all the same,
  // and at once under Reduce Motion, where the circle fades with its row.
  // As the scene goes, it comes back up as the content leaves.
  const launchOpen = useCallback(() => {
    launch.x.set(landingAt.x);
    launch.y.set(landingAt.y);
    launch.handover.set(reduced ? 1 : 0);
    if (reduced) return;
    launch.handover.set(
      steady(
        withDelay(
          HANDOVER_LATEST,
          withTiming(1, { duration: durations.exit, easing: curves.standard }),
        ),
      ),
    );
  }, [launch, landingAt.x, landingAt.y, reduced]);
  const launchLeave = useCallback(
    () =>
      launch.handover.set(
        steady(
          withTiming(0, { duration: durations.exit, easing: curves.standard }),
        ),
      ),
    [launch],
  );

  // The sheet rises from past the bottom edge on its beat, and drops away
  // as the canvas leaves.
  const [sheetIn] = useState(() =>
    build
      ? riseFrom(panes.stops.gone - panes.stops.home, build.beats.sheet)
      : undefined,
  );
  const [sheetOut] = useState(dropAway);
  // The sheet holds the history, so it is sure to rise however its entrance
  // fares: one that has not ended well past its beat is drawn again at
  // rest, its rows with it (`useSureEntry`).
  const sheetEntry = useSureEntry(
    sheetIn,
    (build ? build.beats.sheet : 0) + ENTRY_GRACE_MS,
  );
  // The build is a transition: focus, and what is said after it, wait for
  // it to land. A wallet back from offline bursts with a success (R-5).
  // Both happen once, as the canvas mounts.
  const landed = useSharedValue(0);
  const played = useRef(false);
  useEffect(() => {
    if (!build || played.current) return;
    played.current = true;
    // Under Reduce Motion the build is a crossfade and holds for that long;
    // left to the system setting, Reanimated would skip the wait.
    const hold = reduced ? durations.crossfade : build.beats.done;
    const end = beginTransition(hold);
    landed.set(
      steady(
        withDelay(
          hold,
          withTiming(1, { duration: 0 }, done => {
            'worklet';
            if (done) scheduleOnRN(end);
          }),
          ReduceMotion.Never,
        ),
      ),
    );
    if (build.arrival === 'reconnect') haptics.success();
    return end;
  }, [build, reduced, landed]);
  const shown = canvasScene({ scene, stack });
  const live = !overlay && !layout.covered;
  const home = shown === 'home';

  // Coming home from Send or Receive, the circle that opened it comes back
  // up where it landed, near the foot of the screen, where the sheet rises
  // on its way home (REDESIGN.md 7). Drawn under the sheet, it went behind
  // it and came out from its top edge late. So until the row is back, Home
  // is drawn over the sheet and what the scene leaves: the two never
  // overlap at rest, so only the circle is seen over it.
  const [came, setCame] = useState(shown);
  const [rising, setRising] = useState(false);
  if (came !== shown) {
    setCame(shown);
    setRising(home && (came === 'send' || came === 'receive'));
  }
  useAnimatedReaction(
    () => panes.bar.get(),
    (bar, before) => {
      if (rising && rowBack(bar, before)) scheduleOnRN(setRising, false);
    },
    [rising, panes.bar],
  );
  // Should the row never report back, it is back by the time the move's
  // lock lets go at the latest.
  useEffect(() => {
    if (!rising) return;
    const back = setTimeout(() => setRising(false), RISEN_BY);
    return () => clearTimeout(back);
  }, [rising]);

  // A payment's detail follows the live history, so a status that changes
  // while it is open changes on screen too.
  const opened = scene.name === 'detail' ? scene.item : null;
  const detail = useMemo(
    () =>
      opened
        ? snapshot.activity.find(item => item.id === opened.id) || opened
        : null,
    [snapshot.activity, opened],
  );

  // Settings dims and shrinks what it covers, and so, a little less, does
  // the scan overlay. Under Reduce Motion each only dims, since a shrinking
  // canvas is movement too.
  const coveredStyle = useAnimatedStyle(() => {
    const cover = panes.cover.get();
    const scan = panes.scan.get();
    const opacity =
      (1 - (1 - COVERED.opacity) * cover) * (1 - (1 - SCANNING.opacity) * scan);
    if (reduced) return { opacity };
    const scale =
      (1 - (1 - COVERED.scale) * cover) * (1 - (1 - SCANNING.scale) * scan);
    return { opacity, transform: [{ scale }] };
  }, [reduced]);
  // Under Reduce Motion the sheet fades out and back in around its jump
  // instead of travelling (`veilOpacity`); otherwise the veil rests at 1.
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: veilOpacity(panes.veil?.get() ?? 1),
    transform: [{ translateY: panes.seam.get() }],
  }));

  // A Send that is open takes the code through its receiver. Either way the
  // reducer closes the overlay, and from home it opens Send with the code.
  const scanning = overlay?.name === 'scan' ? overlay : null;
  const onScanned = useCallback(
    (value: string) => {
      const [receiver] = newestFirst(responders.scan);
      if (scanning?.target === 'send' && receiver) receiver(value);
      dispatch({ type: 'scanned', value });
    },
    [scanning, responders, dispatch],
  );
  const onScanCancelled = useCallback(
    () => dispatch({ type: 'back' }),
    [dispatch],
  );

  // The top slot draws Send or Receive, and keeps one that has gone drawn
  // where it was, with what it last showed, while it fades out there
  // (`SceneLeave`): under the sheet and Home as they come back, which a
  // layout exit drew it over on the device. Out of use, it names no
  // primary element, so a scene opened while it fades claims its own.
  const topScene =
    scene.name === 'send' || scene.name === 'receive' ? scene : null;
  const [drawnTop, setDrawnTop] = useState<TopScene | null>(topScene);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  if (drawnTop?.key !== topScene?.key) {
    setDrawnTop(topScene);
    if (drawnTop) {
      const left = { scene: drawnTop, region };
      setLeaving(list => [...list, left]);
    }
  }
  const [nowhere] = useState<Primaries>(() => new Map());
  const letGo = useCallback(
    (key: number) =>
      setLeaving(list => list.filter(item => item.scene.key !== key)),
    [],
  );
  const drawTop = (at: TopScene, drawn: RegionProps, gone: boolean) => (
    <PrimaryFor
      key={at.key}
      primaries={gone ? nowhere : primaries}
      scene={at.name}
    >
      <SceneLeave leaving={gone} onGone={() => letGo(at.key)}>
        <Launched onOpen={launchOpen} onLeave={launchLeave} leaving={gone}>
          {at.name === 'send' ? (
            <SendScene {...drawn} sceneKey={at.key} prefill={at.prefill} />
          ) : (
            <ReceiveScene {...drawn} sceneKey={at.key} />
          )}
        </Launched>
      </SceneLeave>
    </PrimaryFor>
  );
  const top: ReactNode[] = leaving.map(item =>
    drawTop(item.scene, item.region, true),
  );
  if (topScene) top.push(drawTop(topScene, region, false));

  return (
    <PanesProvider value={panes}>
      <LaunchProvider value={launch}>
        <BuildProvider value={build}>
          <View
            style={[
              styles.canvas,
              { marginLeft: insets.left, marginRight: insets.right },
            ]}
            onLayout={onLayout}
          >
            <Pane active={live} style={[styles.fill, coveredStyle]}>
              {/* The ground, behind everything, under the status bar too. */}
              <Backdrop {...region} />
              <StatusRow {...region} shown={shown} />
              <Pane
                active={home}
                style={[
                  styles.home,
                  { top: belowStatus, height: panes.stops.home - belowStatus },
                  rising ? styles.over : null,
                ]}
              >
                <PrimaryFor primaries={primaries} scene="home">
                  <HomePane {...region} home={home} />
                </PrimaryFor>
              </Pane>
              {/* Drawn at the right of the status row, but after Home, so a
              screen reader reaches it after the actions and before the
              sheet (REDESIGN.md 9). TalkBack follows the tree. VoiceOver
              orders what shares a container by where each part starts, so
              the control hangs from an anchor that starts just under the
              home pane's top edge: it sorts after Home and before the
              sheet, while drawn, and pressed, in the status row above. */}
              <View
                testID="corner"
                pointerEvents="box-none"
                style={[styles.cornerAnchor, { top: belowStatus + 1 }]}
              >
                <View style={styles.corner}>
                  <CornerControl home={home} />
                </View>
              </View>
              <View
                testID="slot-top"
                style={[styles.topSlot, { top: belowStatus }]}
                pointerEvents={blocking ? 'none' : 'box-none'}
              >
                {top}
              </View>
              <Pane
                active={home || shown === 'activity'}
                style={[styles.sheet, { height }, sheetStyle]}
              >
                {/* The sheet as it is seen, which rises in as the canvas
                  builds and drops away as it leaves. It moves inside the
                  pane rather than the pane moving, so the pane's own place,
                  where VoiceOver orders it, is always the seam. */}
                <Reanimated.View
                  key={sheetEntry.key}
                  testID="sheet"
                  entering={sheetEntry.entering}
                  exiting={sheetOut}
                  style={styles.sheetFace}
                >
                  {/* Sized for the compact stop, the highest the sheet rests,
                    so the end of the list is reachable there. Lower down the
                    rest simply runs past the bottom edge. */}
                  <LayoutAnimationConfig
                    skipEntering={sheetEntry.state === 'stalled'}
                  >
                    <View style={{ height: height - panes.stops.compact }}>
                      <PrimaryFor primaries={primaries} scene="activity">
                        <SheetPane {...region} shown={shown} />
                      </PrimaryFor>
                    </View>
                  </LayoutAnimationConfig>
                </Reanimated.View>
              </Pane>
              <View
                testID="slot-detail"
                style={[styles.detailSlot, { top: panes.stops.compact }]}
                pointerEvents={blocking ? 'none' : 'box-none'}
              >
                {scene.name === 'detail' && detail ? (
                  <PrimaryFor
                    key={scene.key}
                    primaries={primaries}
                    scene="detail"
                  >
                    <DetailLayer {...region} item={detail} from={scene.from} />
                  </PrimaryFor>
                ) : null}
              </View>
            </Pane>
            <View
              testID="slot-settings"
              style={styles.fill}
              pointerEvents={blocking ? 'none' : 'box-none'}
            >
              {scene.name === 'settings' ? (
                <Reanimated.View
                  key={scene.key}
                  entering={slideIn()}
                  exiting={slideOut()}
                  style={styles.fill}
                >
                  {/* A swipe in from the left edge takes Settings back, the
                  canvas coming back under the finger (REDESIGN.md 7, T6). */}
                  <EdgeBack style={styles.settings}>
                    <Pane active={!overlay} style={styles.flex}>
                      <PrimaryFor primaries={primaries} scene="settings">
                        <SettingsLayer {...region} />
                      </PrimaryFor>
                    </Pane>
                  </EdgeBack>
                </Reanimated.View>
              ) : null}
            </View>
            {scanning ? (
              <ScanReveal
                key={scanning.key}
                origin={scanning.origin}
                target={scanning.target}
                onDetected={onScanned}
                onCancel={onScanCancelled}
                test={isTestNetwork(snapshot.wallet.network)}
              />
            ) : null}
          </View>
        </BuildProvider>
      </LaunchProvider>
    </PanesProvider>
  );
}
Canvas.displayName = 'Canvas';

/** A scene the top slot draws. */
type TopScene = Extract<Scene, { name: 'send' | 'receive' }>;

/** A scene that has gone from the top slot, fading out with what it showed. */
interface Leaving {
  scene: TopScene;
  region: RegionProps;
}

/**
 * The latest the launched circle hands over to the scene's control, in ms
 * of the move's steady clock: well past where it lands, about 300ms, so it
 * only ever stands in for an arrival that never came.
 */
export const HANDOVER_LATEST = 2 * PANE_SETTLE_MS;

/**
 * The latest the circle that opened Send or Receive is back in the row,
 * coming home, in ms: the row waits for the scene's content to go
 * (`rowWait`), then settles with the panes, and a long frame on the way
 * holds the steady clock back by at most about as long again.
 */
export const RISEN_BY = 2 * (PANE_SETTLE_MS + durations.exit);

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  fill: StyleSheet.absoluteFill,
  flex: { flex: 1 },
  home: { position: 'absolute', left: 0, right: 0 },
  // Over the sheet and the top slot, while the circle comes home.
  over: { zIndex: 1 },
  // Its glyph sits where the page edge puts it; the target around it
  // reaches a little nearer the screen's edge.
  cornerAnchor: {
    position: 'absolute',
    right: space.xl - CORNER_REACH,
    width: CORNER_ROOM,
    height: STATUS_ROW,
  },
  corner: {
    position: 'absolute',
    top: -(STATUS_ROW + 1),
    right: 0,
    height: STATUS_ROW,
    justifyContent: 'center',
  },
  topSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  sheetFace: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.pane,
    borderTopRightRadius: radius.pane,
  },
  detailSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  settings: { flex: 1, backgroundColor: colors.background },
});
