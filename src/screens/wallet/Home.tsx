import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { Button, Card, IconButton, StatusDot } from '../../components/ui';
import { MASK, amountIn, colors, space, type as typography } from '../../theme';
import type { Unit } from '../../theme';
import { useCountUp } from '../../services/motion';
import { usePaneActive } from '../../stage/panes/Pane';
import { ActivityRow } from './Activity';

/** The balance, and the two things you do with it. */
function BalanceHero({
  snapshot,
  hidden,
  unit,
  onToggleUnit,
}: {
  snapshot: WalletSnapshot;
  hidden: boolean;
  unit: Unit;
  onToggleUnit: () => void;
}) {
  const live = usePaneActive();
  const balance = snapshot.balance;
  const counted = useCountUp(balance.totalSats);
  const total = amountIn(unit === 'btc' ? balance.totalSats : counted, unit);
  const available = amountIn(balance.availableSats, unit);
  const pending = amountIn(balance.pendingSats, unit);
  return (
    <View style={styles.balanceBlock}>
      <View style={styles.balanceTop}>
        <Text style={styles.balanceLabel}>Total balance</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hidden
            ? 'Balance hidden'
            : `Total balance ${total.value} ${total.suffix}`
        }
        accessibilityHint="Switches between satoshis and BTC."
        onPress={live ? onToggleUnit : undefined}
        style={styles.balanceValueRow}
      >
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={styles.balanceValue}
        >
          {hidden ? MASK : total.value}
        </Text>
        <Text style={styles.balanceUnit}>{total.suffix}</Text>
      </Pressable>
      <View style={styles.balanceSub}>
        <View style={styles.balanceSubLine}>
          <StatusDot tone={snapshot.primary.connected ? 'good' : 'wait'} />
          <Text style={styles.balanceCaption}>
            {hidden ? MASK : available.value} {available.suffix} ready to send
          </Text>
        </View>
        {/* Money that is on its way sits with the money that is here, because
            that is the same question asked twice. What it is waiting for
            belongs in Activity, not in a paragraph above the buttons. */}
        {balance.pendingSats > 0 ? (
          <View style={styles.balanceSubLine}>
            <StatusDot tone="wait" />
            <Text style={styles.balancePending}>
              {hidden ? MASK : pending.value} {pending.suffix} arriving
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function HomeScreen({
  snapshot,
  hidden = false,
  unit = 'sats',
  stale = false,
  onSend,
  onReceive,
  onScan,
  onActivity,
  onDetail,
  onToggleUnit,
}: {
  snapshot: WalletSnapshot;
  hidden?: boolean;
  unit?: Unit;
  stale?: boolean;
  onSend: () => void;
  onReceive: () => void;
  onScan?: () => void;
  onActivity: () => void;
  onDetail: (item: Activity) => void;
  onToggleUnit?: () => void;
}) {
  // On the canvas, Home stays drawn while other scenes show, so its controls
  // only get their handlers while its pane is the one in use.
  const live = usePaneActive();
  return (
    <View style={styles.stack}>
      <BalanceHero
        snapshot={snapshot}
        hidden={hidden}
        unit={unit}
        onToggleUnit={onToggleUnit || (() => {})}
      />
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label="Send"
            icon="arrowUp"
            disabled={stale}
            accessibilityHint="Paste or scan a payment request."
            onPress={live ? onSend : undefined}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Receive"
            icon="arrowDown"
            disabled={stale}
            secondary
            accessibilityHint="Creates a request others can pay."
            onPress={live ? onReceive : undefined}
          />
        </View>
        {onScan ? (
          <IconButton
            name="scan"
            size={22}
            accessibilityLabel="Scan a payment request"
            accessibilityHint="Opens the camera to read a QR code."
            disabled={stale}
            onPress={live ? onScan : undefined}
          />
        ) : null}
      </View>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionLabel}>Activity</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all activity"
          onPress={live ? onActivity : undefined}
        >
          <Text style={styles.viewAll}>View all</Text>
        </Pressable>
      </View>
      {snapshot.activity.length ? (
        /* `collapsable={false}` gives this list a native view of its own on
           Android. Without it the view is layout-only and gets flattened away,
           so every row is mounted as a direct child of the animated wrapper
           several levels up, sharing that parent with the balance and the
           buttons. Inserting a row then has to re-position every one of those
           siblings rather than insert into a list, which is what painted two
           rows at the same offset for a frame when a payment arrived. It
           cannot change layout, style or hit-testing; it costs one view. */
        <View collapsable={false}>
          {snapshot.activity.slice(0, 5).map(item => (
            <ActivityRow
              item={item}
              key={item.id}
              hidden={hidden}
              unit={unit}
              onPress={onDetail}
            />
          ))}
        </View>
      ) : (
        <Card>
          <Text style={styles.emptyTitle}>No activity yet.</Text>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  balanceBlock: { paddingTop: space.md, paddingBottom: space.xs },
  balanceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLabel: { ...typography.caption, color: colors.muted },
  balanceValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
    marginTop: space.xxs,
  },
  balanceValue: {
    ...typography.display,
    color: colors.text,
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  balanceUnit: { ...typography.caption, fontSize: 14, color: colors.muted },
  balanceSub: { gap: space.xxs, marginTop: space.sm },
  balanceSubLine: {
    flexDirection: 'row',
    gap: space.xs,
    alignItems: 'center',
  },
  balanceCaption: { ...typography.caption, color: colors.mint },
  balancePending: { ...typography.caption, color: colors.warning },
  actions: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  action: { flex: 1 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xxs,
  },
  viewAll: {
    ...typography.micro,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyTitle: { ...typography.heading, color: colors.text },
  sectionLabel: { ...typography.caption, color: colors.muted },
});
