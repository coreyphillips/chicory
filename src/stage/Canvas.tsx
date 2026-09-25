import React, { useCallback, useMemo, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { IconButton, Notice, StatusDot } from '../components/ui';
import { copy } from '../design/copy';
import { haptics } from '../design/haptics';
import { sceneIn, sceneOut, slideIn, slideOut } from '../motion/presets';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { ActivityScreen, DetailScreen, HomeScreen } from '../screens/Wallet';
import { ReceiveScreen, SendScreen } from '../screens/Payments';
import { SettingsScreen } from '../screens/Settings';
import type { useWalletSession } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { HIT_SLOP, colors, radius, space, type as typography } from '../theme';
import type { Unit } from '../theme';
import { DetailCard } from './layers/DetailCard';
import {
  COVERED,
  HERO_MINI,
  STATUS_ROW,
  canvasLayout,
  canvasScene,
} from './layout';
import { CornerControl } from './panes/CornerControl';
import { Pane, PanesProvider, usePaneActive } from './panes/Pane';
import { SceneSlot } from './panes/SceneSlot';
import { usePaneMotion } from './panes/usePaneMotion';
import type { Overlay, Scene } from './scene';
import { useStage } from './StageContext';

type Session = ReturnType<typeof useWalletSession>;

const REFRESH_FAILED = 'Could not refresh. Showing the last known state.';

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
 */
export function Canvas({
  scene,
  overlay,
  client,
  snapshot,
  session,
  stale,
  banner,
  view,
}: {
  scene: Scene;
  overlay: Overlay;
  client: WalletAdapter;
  snapshot: WalletSnapshot;
  session: Pick<
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
  stale: boolean;
  /** What must stay above Home, Activity and Settings, such as a pending backup. */
  banner: ReactNode;
  view: ReturnType<typeof useCanvasView>;
}) {
  const { state, actions } = useStage();
  const { reduced } = useMotionPrefs();
  const { hidden, unit, setHidden, setUnit } = view;

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
  const scanInSend = useCallback(() => actions.openSend('', true), [actions]);
  const toggleUnit = useCallback(
    () => setUnit(value => (value === 'sats' ? 'btc' : 'sats')),
    [setUnit],
  );

  // Settings dims and shrinks what it covers. Under Reduce Motion it only
  // dims, since a shrinking canvas is movement too.
  const coveredStyle = useAnimatedStyle(() => {
    const cover = panes.cover.get();
    const opacity = 1 - (1 - COVERED.opacity) * cover;
    if (reduced) return { opacity };
    return { opacity, transform: [{ scale: 1 - (1 - COVERED.scale) * cover }] };
  }, [reduced]);
  const homeStyle = useAnimatedStyle(() => ({
    opacity: panes.bar.get(),
    transform: [{ scale: HERO_MINI + (1 - HERO_MINI) * panes.hero.get() }],
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: panes.seam.get() }],
  }));

  const notice = session.error ? (
    <Notice kind="error" icon="alert">
      {`${REFRESH_FAILED} ${session.error}`}
    </Notice>
  ) : null;
  const refreshControl = (
    <RefreshControl
      refreshing={session.refreshing}
      onRefresh={session.manualRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );

  let top: ReactNode = null;
  if (scene.name === 'send') {
    top = (
      <Arriving key={scene.key}>
        <SceneSlot label={copy.scene.send} offset={STATUS_ROW}>
          <SendScreen
            client={client}
            initialRequest={scene.prefill}
            initialScanning={scene.scanning}
            disabled={stale}
            onActivity={actions.openActivity}
            onRefresh={session.refresh}
            onBusy={actions.setBusy}
          />
        </SceneSlot>
      </Arriving>
    );
  } else if (scene.name === 'receive') {
    top = (
      <Arriving key={scene.key}>
        <SceneSlot label={copy.scene.receive} offset={STATUS_ROW}>
          <ReceiveScreen
            client={client}
            receivableSats={snapshot.balance.receivableSats}
            offlineReceivableSats={snapshot.balance.offlineReceivableSats}
            disabled={stale}
            onRefresh={session.refresh}
            onActivity={actions.openActivity}
            onBusy={actions.setBusy}
          />
        </SceneSlot>
      </Arriving>
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
            style={[
              styles.home,
              { height: panes.stops.home - STATUS_ROW },
              homeStyle,
            ]}
          >
            <ScrollView
              contentContainerStyle={styles.homeContent}
              refreshControl={refreshControl}
            >
              {/* The backup brings controls of its own, so it only sits in
                  a pane in use. Under Settings it shows there instead. */}
              {home && live ? banner : null}
              {home ? notice : null}
              <HomeScreen
                snapshot={snapshot}
                hidden={hidden}
                unit={unit}
                stale={stale}
                onSend={actions.openSend}
                onReceive={actions.openReceive}
                onScan={scanInSend}
                onActivity={actions.openActivity}
                onDetail={actions.openDetail}
                onToggleUnit={toggleUnit}
              />
            </ScrollView>
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
              {home ? (
                <SheetHandle />
              ) : shown === 'activity' && notice ? (
                <View style={styles.sheetNotice}>{notice}</View>
              ) : null}
              <ActivityScreen
                snapshot={snapshot}
                hidden={hidden}
                unit={unit}
                onDetail={actions.openDetail}
                filter={view.filter}
                onFilter={view.setFilter}
                query={view.query}
                onQuery={view.setQuery}
                refreshing={session.refreshing}
                onRefresh={session.manualRefresh}
                banner={shown === 'activity' && live ? banner : undefined}
              />
            </View>
          </Pane>
          <View
            style={[styles.detailSlot, { top: panes.stops.compact }]}
            pointerEvents={blocking ? 'none' : 'box-none'}
          >
            {scene.name === 'detail' && detail ? (
              <DetailCard key={scene.key} item={detail} from={scene.from}>
                <SceneSlot
                  label={copy.scene.detail}
                  offset={panes.stops.compact}
                >
                  <DetailScreen
                    item={detail}
                    client={client}
                    hidden={hidden}
                    unit={unit}
                    onRefresh={session.refresh}
                    onBusy={actions.setBusy}
                  />
                </SceneSlot>
              </DetailCard>
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
                <View style={styles.settingsBar}>
                  <CornerControl home={false} />
                </View>
                <SceneSlot refreshControl={refreshControl}>
                  <View style={styles.stack}>
                    {banner}
                    {notice}
                    <SettingsScreen
                      snapshot={snapshot}
                      client={client}
                      switchError={session.switchError}
                      onDisconnect={session.disconnect}
                      onChooseWallet={session.chooseWallet}
                      onRefresh={session.manualRefresh}
                      onNetwork={session.switchNetwork}
                      onErase={session.eraseDevice}
                    />
                  </View>
                </SceneSlot>
              </Pane>
            </Reanimated.View>
          ) : null}
        </View>
      </View>
    </PanesProvider>
  );
}
Canvas.displayName = 'Canvas';

/**
 * A scene in the top slot. It arrives once the outgoing one is on its way and
 * leaves with a short fade, so for a moment both are drawn and neither pops.
 */
function Arriving({ children }: PropsWithChildren) {
  return (
    <Reanimated.View
      entering={sceneIn()}
      exiting={sceneOut()}
      style={styles.flex}
    >
      {children}
    </Reanimated.View>
  );
}

/** The grip at the top of the sheet at home, which opens Activity. */
function SheetHandle() {
  const { actions } = useStage();
  const live = usePaneActive();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.home.activity}
      hitSlop={HIT_SLOP}
      onPress={
        live
          ? () => {
              haptics.tick();
              actions.openActivity();
            }
          : undefined
      }
      style={styles.handle}
    >
      <View style={styles.grabber} />
    </Pressable>
  );
}

/**
 * The wallet's name and connection, the two controls every scene keeps, and
 * the corner control.
 */
function StatusRow({
  snapshot,
  hidden,
  refreshing,
  home,
  onToggleHidden,
  onRefresh,
}: {
  snapshot: WalletSnapshot;
  hidden: boolean;
  refreshing: boolean;
  home: boolean;
  onToggleHidden: () => void;
  onRefresh: () => void;
}) {
  const live = usePaneActive();
  const { wallet, primary } = snapshot;
  return (
    <View style={styles.status}>
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.wallet}>
          {wallet.name}
          <Text style={styles.network}>{`  ·  ${wallet.network}`}</Text>
        </Text>
        <View
          accessible
          accessibilityLabel={
            primary.connected ? copy.health.fresh : copy.health.reconnecting
          }
        >
          <StatusDot tone={primary.connected ? 'good' : 'wait'} />
        </View>
      </View>
      <View style={styles.controls}>
        <IconButton
          name={hidden ? 'eyeOff' : 'eye'}
          tone="plain"
          accessibilityLabel={
            hidden ? copy.home.showBalance : copy.home.hideBalance
          }
          accessibilityHint={copy.home.hideHint}
          onPress={live ? onToggleHidden : undefined}
        />
        <IconButton
          name="refresh"
          tone="plain"
          disabled={refreshing}
          accessibilityLabel={copy.home.refresh}
          onPress={live ? onRefresh : undefined}
        />
        <CornerControl home={home} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  stack: { gap: space.lg },
  status: {
    height: STATUS_ROW,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  identity: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  wallet: { ...typography.micro, color: colors.muted, flexShrink: 1 },
  network: {
    ...typography.micro,
    color: colors.faint,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  fill: StyleSheet.absoluteFill,
  flex: { flex: 1 },
  // Scaled from its top edge, so the mini strip sits under the status row.
  home: {
    position: 'absolute',
    top: STATUS_ROW,
    left: 0,
    right: 0,
    transformOrigin: 'top',
  },
  homeContent: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.lg,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
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
  handle: { alignItems: 'center', paddingVertical: space.sm },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.round,
    backgroundColor: colors.line,
  },
  sheetNotice: { paddingHorizontal: space.xl, paddingTop: space.md },
  detailSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  settings: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
  settingsBar: {
    height: STATUS_ROW,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
});
