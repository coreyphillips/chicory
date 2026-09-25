import React, { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { IconButton, Notice, StatusDot } from '../components/ui';
import { copy } from '../design/copy';
import { haptics } from '../design/haptics';
import { ActivityScreen, DetailScreen, HomeScreen } from '../screens/Wallet';
import { ReceiveScreen, SendScreen } from '../screens/Payments';
import { SettingsScreen } from '../screens/Settings';
import type { useWalletSession } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { HIT_SLOP, colors, radius, space, type as typography } from '../theme';
import type { Unit } from '../theme';
import { CornerControl } from './panes/CornerControl';
import { SceneSlot } from './panes/SceneSlot';
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
 * The wallet as one surface. A top pane holds the status row and Home, a
 * bottom sheet holds the one Activity list, and Send, Receive, a payment's
 * detail and Settings take the place of both in the scene slot.
 *
 * Scenes swap by plain conditional rendering for now. The sheet stays at one
 * place in the tree from Home to Activity, so the list keeps its instance,
 * its scroll and its search while it grows.
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
  const { actions } = useStage();
  const { hidden, unit, setHidden, setUnit } = view;
  const home = scene.name === 'home';
  const sheet = home || scene.name === 'activity';

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

  let slot: ReactNode = null;
  switch (scene.name) {
    case 'send':
      slot = (
        <SceneSlot key={scene.key} label={copy.scene.send}>
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
      );
      break;
    case 'receive':
      slot = (
        <SceneSlot key={scene.key} label={copy.scene.receive}>
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
      );
      break;
    case 'detail':
      slot = detail ? (
        <SceneSlot key={scene.key} label={copy.scene.detail}>
          <DetailScreen
            item={detail}
            client={client}
            hidden={hidden}
            unit={unit}
            onRefresh={session.refresh}
            onBusy={actions.setBusy}
          />
        </SceneSlot>
      ) : null;
      break;
    case 'settings':
      slot = (
        <SceneSlot key={scene.key} refreshControl={refreshControl}>
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
      );
      break;
  }

  return (
    <View
      style={styles.canvas}
      // An overlay covers the canvas entirely, so a screen reader must not
      // wander into what is underneath it.
      importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={!!overlay}
    >
      <StatusRow
        snapshot={snapshot}
        hidden={hidden}
        refreshing={session.refreshing || session.connecting}
        home={home}
        onToggleHidden={() => setHidden(!hidden)}
        onRefresh={session.manualRefresh}
      />
      {home ? (
        <ScrollView
          style={styles.top}
          contentContainerStyle={styles.topContent}
          refreshControl={refreshControl}
        >
          {banner}
          {notice}
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
      ) : null}
      {sheet ? (
        <View style={[styles.sheet, home && styles.peek]}>
          {home ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.home.activity}
              hitSlop={HIT_SLOP}
              onPress={() => {
                haptics.tick();
                actions.openActivity();
              }}
              style={styles.handle}
            >
              <View style={styles.grabber} />
            </Pressable>
          ) : notice ? (
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
            banner={home ? undefined : banner}
          />
        </View>
      ) : null}
      {slot}
    </View>
  );
}
Canvas.displayName = 'Canvas';

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
          onPress={onToggleHidden}
        />
        <IconButton
          name="refresh"
          tone="plain"
          disabled={refreshing}
          accessibilityLabel={copy.home.refresh}
          onPress={onRefresh}
        />
        <CornerControl home={home} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  stack: { gap: space.lg },
  status: {
    paddingHorizontal: space.xl,
    paddingTop: space.xs,
    paddingBottom: space.xs,
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
  top: { flex: 3 },
  topContent: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.lg,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.pane,
    borderTopRightRadius: radius.pane,
  },
  // At home the sheet is a short preview under the top pane.
  peek: { flex: 2 },
  handle: { alignItems: 'center', paddingVertical: space.sm },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.round,
    backgroundColor: colors.line,
  },
  sheetNotice: { paddingHorizontal: space.xl, paddingTop: space.md },
});
