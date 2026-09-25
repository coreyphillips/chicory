import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { IconButton, Notice, StatusDot } from '../../components/ui';
import { copy } from '../../design/copy';
import { STATUS_ROW } from '../../stage/layout';
import { CornerControl } from '../../stage/panes/CornerControl';
import { usePaneActive } from '../../stage/panes/Pane';
import { colors, space, type as typography } from '../../theme';

/**
 * The wallet's name and connection, the two controls every scene keeps, and
 * the corner control. The canvas runs under the system status bar, so the
 * row starts below it.
 */
export function StatusRow({
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
  const { top } = useSafeAreaInsets();
  const { wallet, primary } = snapshot;
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
});
