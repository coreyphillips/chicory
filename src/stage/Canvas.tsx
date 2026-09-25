import React, { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { slideIn, slideOut } from '../motion/presets';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { SheetPane } from '../scenes/activity/SheetPane';
import { DetailLayer } from '../scenes/detail/DetailLayer';
import { HomePane } from '../scenes/home/HomePane';
import { StatusRow } from '../scenes/home/StatusRow';
import { ReceiveScene } from '../scenes/receive/ReceiveScene';
import { SendScene } from '../scenes/send/SendScene';
import { SettingsLayer } from '../scenes/settings/SettingsLayer';
import type { useWalletSession } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { colors, radius } from '../theme';
import type { Unit } from '../theme';
import { ScanReveal } from './layers/ScanReveal';
import { COVERED, STATUS_ROW, canvasLayout, canvasScene } from './layout';
import { Pane, PanesProvider } from './panes/Pane';
import { usePaneMotion } from './panes/usePaneMotion';
import type { Overlay, Scene } from './scene';
import { newestFirst, useStage } from './StageContext';

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
 * The wallet as one surface (REDESIGN.md 2.3). A top pane at the back holds
 * the status row and Home, and takes Send and Receive in its slot. A sheet
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
  const { hidden, setHidden } = view;

  // Measured rather than assumed: the canvas is whatever the safe area
  // leaves. The window's height stands in until the first layout.
  const { height: windowHeight } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const height = measured || windowHeight;
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.height),
    [],
  );

  const { stack } = state;
  const layout = useMemo(() => canvasLayout({ scene, stack }), [scene, stack]);
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

  // Settings dims and shrinks what it covers. Under Reduce Motion it only
  // dims, since a shrinking canvas is movement too.
  const coveredStyle = useAnimatedStyle(() => {
    const cover = panes.cover.get();
    const opacity = 1 - (1 - COVERED.opacity) * cover;
    if (reduced) return { opacity };
    return { opacity, transform: [{ scale: 1 - (1 - COVERED.scale) * cover }] };
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
      <SendScene
        key={scene.key}
        prefill={scene.prefill}
        scanning={scene.scanning}
        client={client}
        stale={stale}
        session={session}
      />
    );
  } else if (scene.name === 'receive') {
    top = (
      <ReceiveScene
        key={scene.key}
        snapshot={snapshot}
        client={client}
        stale={stale}
        session={session}
      />
    );
  }

  return (
    <PanesProvider value={panes}>
      <View style={styles.canvas} onLayout={onLayout}>
        <Pane active={live} style={[styles.fill, coveredStyle]}>
          <StatusRow
            snapshot={snapshot}
            hidden={hidden}
            refreshing={session.refreshing || session.connecting}
            home={home}
            onToggleHidden={() => setHidden(!hidden)}
            onRefresh={session.manualRefresh}
          />
          <Pane
            active={home}
            style={[styles.home, { height: panes.stops.home - STATUS_ROW }]}
          >
            <HomePane
              home={home}
              snapshot={snapshot}
              session={session}
              view={view}
              stale={stale}
              backup={backup}
            />
          </Pane>
          <View
            style={styles.topSlot}
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
              <SheetPane
                shown={shown}
                snapshot={snapshot}
                session={session}
                view={view}
                backup={backup}
              />
            </View>
          </Pane>
          <View
            style={[styles.detailSlot, { top: panes.stops.compact }]}
            pointerEvents={blocking ? 'none' : 'box-none'}
          >
            {scene.name === 'detail' && detail ? (
              <DetailLayer
                key={scene.key}
                item={detail}
                from={scene.from}
                client={client}
                view={view}
                session={session}
              />
            ) : null}
          </View>
        </Pane>
        <View
          style={styles.fill}
          pointerEvents={blocking ? 'none' : 'box-none'}
        >
          {scene.name === 'settings' ? (
            <Reanimated.View
              key={scene.key}
              entering={slideIn()}
              exiting={slideOut()}
              style={styles.settings}
            >
              <Pane active={!overlay} style={styles.flex}>
                <SettingsLayer
                  snapshot={snapshot}
                  client={client}
                  session={session}
                  backup={backup}
                />
              </Pane>
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
  home: { position: 'absolute', top: STATUS_ROW, left: 0, right: 0 },
  topSlot: {
    position: 'absolute',
    top: STATUS_ROW,
    left: 0,
    right: 0,
    bottom: 0,
  },
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
  settings: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
});
