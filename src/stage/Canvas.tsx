import React, { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { slideIn, slideOut } from '../motion/presets';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { SheetPane } from '../scenes/activity/SheetPane';
import { DetailLayer } from '../scenes/detail/DetailLayer';
import { Backdrop } from '../scenes/home/Backdrop';
import { HomePane } from '../scenes/home/HomePane';
import { StatusRow } from '../scenes/home/StatusRow';
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
  SCANNING,
  STATUS_ROW,
  canvasLayout,
  canvasScene,
} from './layout';
import { CornerControl } from './panes/CornerControl';
import { EdgeBack } from './panes/EdgeBack';
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
}: {
  scene: Scene;
  overlay: Overlay;
  client: WalletAdapter;
  snapshot: WalletSnapshot;
  session: CanvasSession;
  stale: boolean;
  backup: Backup | null;
  view: CanvasView;
}) {
  const { state, dispatch, responders } = useStage();
  const { reduced } = useMotionPrefs();
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
  const { height: windowHeight } = useWindowDimensions();
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
  const shown = canvasScene({ scene, stack });
  const live = !overlay && !layout.covered;
  const home = shown === 'home';

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
  const sheetStyle = useAnimatedStyle(() => ({
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

  let top: ReactNode = null;
  if (scene.name === 'send') {
    top = (
      <PrimaryFor key={scene.key} primaries={primaries} scene="send">
        <SendScene {...region} sceneKey={scene.key} prefill={scene.prefill} />
      </PrimaryFor>
    );
  } else if (scene.name === 'receive') {
    top = (
      <PrimaryFor key={scene.key} primaries={primaries} scene="receive">
        <ReceiveScene {...region} sceneKey={scene.key} />
      </PrimaryFor>
    );
  }

  return (
    <PanesProvider value={panes}>
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
            ]}
          >
            <PrimaryFor primaries={primaries} scene="home">
              <HomePane {...region} home={home} />
            </PrimaryFor>
          </Pane>
          {/* Drawn at the right of the status row, but after Home, so a
              screen reader reaches it after the actions and before the
              sheet (REDESIGN.md 9). */}
          <View style={[styles.corner, { top: insets.top }]}>
            <CornerControl home={home} />
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
            {/* Sized for the compact stop, the highest the sheet rests, so
                the end of the list is reachable there. Lower down the rest
                simply runs past the bottom edge. */}
            <View style={{ height: height - panes.stops.compact }}>
              <PrimaryFor primaries={primaries} scene="activity">
                <SheetPane {...region} shown={shown} />
              </PrimaryFor>
            </View>
          </Pane>
          <View
            testID="slot-detail"
            style={[styles.detailSlot, { top: panes.stops.compact }]}
            pointerEvents={blocking ? 'none' : 'box-none'}
          >
            {scene.name === 'detail' && detail ? (
              <PrimaryFor key={scene.key} primaries={primaries} scene="detail">
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
          />
        ) : null}
      </View>
    </PanesProvider>
  );
}
Canvas.displayName = 'Canvas';

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  fill: StyleSheet.absoluteFill,
  flex: { flex: 1 },
  home: { position: 'absolute', left: 0, right: 0 },
  corner: {
    position: 'absolute',
    right: space.xl,
    height: STATUS_ROW,
    justifyContent: 'center',
  },
  topSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.pane,
    borderTopRightRadius: radius.pane,
  },
  detailSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  settings: { flex: 1, backgroundColor: colors.background },
});
