import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Notice, StatusDot } from '../../components/ui';
import { copy } from '../../design/copy';
import type { RegionProps } from '../../stage/Canvas';
import type { CanvasSceneName } from '../../stage/layout';
import { STATUS_ROW } from '../../stage/layout';
import { CORNER_ROOM } from '../../stage/panes/CornerControl';
import { usePaneActive } from '../../stage/panes/Pane';
import { colors, space, type as typography } from '../../theme';

/**
 * The status row, which every scene on the canvas keeps: the wallet's name
 * and its connection, and for now the two controls that hide the balance and
 * refresh. The canvas runs under the system status bar, so the row starts
 * below it.
 *
 * The corner control at its right is the canvas's own, drawn after Home so a
 * screen reader reaches it in order (REDESIGN.md 9); the row leaves it room.
 */
export function StatusRow({
  snapshot,
  session,
  view,
}: RegionProps & {
  /** The scene the canvas shows. */
  shown: CanvasSceneName;
}) {
  const live = usePaneActive();
  const { top } = useSafeAreaInsets();
  const { wallet, primary } = snapshot;
  const { hidden, setHidden } = view;
  const refreshing = session.refreshing || session.connecting;
  return (
    <View
      style={[styles.status, { paddingTop: top, height: top + STATUS_ROW }]}
    >
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
          onPress={live ? () => setHidden(!hidden) : undefined}
        />
        <IconButton
          name="refresh"
          tone="plain"
          disabled={refreshing}
          accessibilityLabel={copy.home.refresh}
          onPress={live ? session.manualRefresh : undefined}
        />
      </View>
    </View>
  );
}

/**
 * A refresh that failed, said in words above Home until the mark's PulseDot
 * carries it (REDESIGN.md 6, Wallet health). Nothing while the last one
 * worked.
 */
export function RefreshFailed({ error }: { error: string }) {
  return error ? (
    <Notice kind="error" icon="alert">
      {copy.notice.refreshFailed(error)}
    </Notice>
  ) : null;
}

const styles = StyleSheet.create({
  status: {
    paddingLeft: space.xl,
    paddingRight: space.xl + CORNER_ROOM,
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
});
