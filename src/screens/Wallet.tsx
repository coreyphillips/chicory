import React, { useCallback, useDeferredValue, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  Notice,
  Row,
  StatusDot,
  Title,
} from '../components/ui';
import {
  MASK,
  amountIn,
  colors,
  dateLabel,
  number,
  radius,
  space,
  type as typography,
} from '../theme';
import type { Unit } from '../theme';
import { useCountUp } from '../services/motion';
import { ReceiveReceipt } from '../components/ReceiveReceipt';
import { ReceiveRequestDetails } from '../components/ReceiveRequestDetails';
import { CopyValue } from '../components/CopyValue';
import type { WalletAdapter } from '../services/wallet';
import {
  FILTERS,
  activitySections,
  activityStatus,
} from '../scenes/activity/model';
import type { ActivitySection } from '../scenes/activity/model';
import { usePaneActive } from '../stage/panes/Pane';

// Re-exported so existing imports of it from this module keep working.
export { activityStatus };

/**
 * Memoized, and its `onPress` takes the row it belongs to.
 *
 * A per-row closure is a new prop on every render of the list, which defeats
 * the memo and re-renders every visible row for a keystroke in the search box.
 * Handing the item back instead lets both call sites pass one stable handler.
 */
export const ActivityRow = React.memo(function ActivityRowItem({
  item,
  onPress,
  hidden = false,
  unit = 'sats',
}: {
  item: Activity;
  onPress: (item: Activity) => void;
  hidden?: boolean;
  unit?: Unit;
}) {
  const live = usePaneActive();
  const incoming = item.kind === 'received';
  const failed = item.status === 'failed' || item.status === 'expired';
  const amount = amountIn(item.amountSats, unit);
  const sign = incoming ? '+' : item.kind === 'sent' ? '−' : '';
  return (
    <Pressable
      accessibilityRole="button"
      // Hiding the balance has to hide it from the screen reader too, or the
      // amount is simply announced out loud instead of shown.
      accessibilityLabel={
        hidden
          ? `${item.title}, amount hidden, ${activityStatus(item)}`
          : `${item.title}, ${number(item.amountSats)} sats, ${activityStatus(
              item,
            )}`
      }
      accessibilityHint="Opens the payment details."
      onPress={live ? () => onPress(item) : undefined}
      style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}
    >
      <View style={[styles.activityIcon, incoming && styles.incomingIcon]}>
        <Icon
          name={
            item.kind === 'sent'
              ? 'arrowUp'
              : item.kind === 'received'
              ? 'arrowDown'
              : 'activity'
          }
          size={19}
          color={incoming ? colors.mint : colors.text}
        />
      </View>
      <View style={styles.activityText}>
        <Text numberOfLines={1} style={styles.activityTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={styles.activityMeta}>
          {dateLabel(item.timestamp)} · {activityStatus(item)}
        </Text>
      </View>
      <Text
        style={[
          styles.activityAmount,
          incoming && styles.incomingAmount,
          failed && styles.failedAmount,
        ]}
      >
        {hidden ? MASK : `${sign}${amount.value}`}
        <Text style={styles.smallUnit}> {amount.suffix}</Text>
      </Text>
    </Pressable>
  );
});
ActivityRow.displayName = 'ActivityRow';

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

/**
 * The full history.
 *
 * This renders its own `FlatList` rather than mapping into the app's shared
 * ScrollView: a wallet with hundreds of payments used to mount every row at
 * once. It is also the only screen with search, which matters most exactly when
 * the list is long.
 */
export function ActivityScreen({
  snapshot,
  onDetail,
  filter,
  onFilter,
  query = '',
  onQuery,
  hidden = false,
  unit = 'sats',
  refreshing = false,
  onRefresh,
  banner,
}: {
  snapshot: WalletSnapshot;
  onDetail: (item: Activity) => void;
  filter: string;
  onFilter: (value: string) => void;
  query?: string;
  onQuery?: (value: string) => void;
  hidden?: boolean;
  unit?: Unit;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Something that must stay above the list, such as a pending backup. */
  banner?: React.ReactNode;
}) {
  const live = usePaneActive();
  // Filtering trails typing by a frame. The field itself still binds `query`,
  // so it never feels behind; only the list waits.
  const needle = useDeferredValue(query).trim().toLowerCase();
  const rows = useMemo(
    () => activitySections(snapshot.activity, filter, needle),
    [snapshot.activity, filter, needle],
  );

  // Stable identities, so the memoized rows can stay put across a keystroke
  // and across a background poll that changed nothing they show.
  const renderItem = useCallback(
    ({ item: row }: { item: ActivitySection }) =>
      row.kind === 'header' ? (
        <Text style={styles.dayHeader}>{row.label}</Text>
      ) : (
        <ActivityRow
          item={row.item}
          hidden={hidden}
          unit={unit}
          onPress={onDetail}
        />
      ),
    [hidden, unit, onDetail],
  );
  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      ) : undefined,
    [refreshing, onRefresh],
  );
  const header = useMemo(
    () => (
      <View style={styles.listHeader}>
        {banner ? <View style={styles.banner}>{banner}</View> : null}
        <Title>Activity</Title>
        {onQuery ? (
          <View style={styles.search}>
            <Icon name="search" size={17} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search activity"
              style={styles.searchInput}
              value={query}
              editable={live}
              onChangeText={live ? onQuery : undefined}
              placeholder="Search payments"
              placeholderTextColor={colors.faint}
              selectionColor={colors.primary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query ? (
              <IconButton
                name="close"
                size={15}
                tone="plain"
                accessibilityLabel="Clear search"
                onPress={live ? () => onQuery('') : undefined}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.filters}>
          {FILTERS.map(value => (
            <Chip
              key={value}
              label={value}
              selected={filter === value}
              onPress={live ? () => onFilter(value) : undefined}
            />
          ))}
        </View>
      </View>
    ),
    [banner, onQuery, query, live, filter, onFilter],
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={row => row.id}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      removeClippedSubviews
      initialNumToRender={12}
      windowSize={9}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      renderItem={renderItem}
      ListEmptyComponent={
        <Card>
          <Text style={styles.emptyTitle}>
            {query.trim()
              ? `No payments match “${query.trim()}”.`
              : filter === 'All'
              ? 'No activity yet.'
              : `No ${filter.toLowerCase()} payments.`}
          </Text>
        </Card>
      }
    />
  );
}

export function DetailScreen({
  item,
  client,
  hidden = false,
  unit = 'sats',
  onRefresh,
  onBusy,
}: {
  item: Activity;
  client?: WalletAdapter;
  hidden?: boolean;
  unit?: Unit;
  onRefresh?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  // A hidden balance stays hidden here too; tapping a row must not be the
  // way around the mask. References keep showing, they are not amounts.
  const amount = amountIn(item.amountSats, unit);
  const fee = amountIn(item.feeSats, unit);
  const receipt =
    item.receiveStatus && item.receiveStatus.phase !== 'waiting'
      ? item.receiveStatus
      : null;
  return (
    <View style={styles.stack}>
      <View style={styles.detailIcon}>
        <Icon
          name={
            item.kind === 'received'
              ? 'arrowDown'
              : item.kind === 'sent'
              ? 'arrowUp'
              : 'activity'
          }
          color={colors.primary}
          size={28}
        />
      </View>
      <Title>{item.title}</Title>
      <Text style={styles.detailAmount}>
        {hidden ? MASK : amount.value}{' '}
        <Text style={styles.detailUnit}>{amount.suffix}</Text>
      </Text>
      {item.receiveStatusUnavailable &&
      item.receiveRequest?.bitcoinTracking !== 'ambiguous' ? (
        <Notice icon="info">
          Payment status unavailable. Last known result shown.
        </Notice>
      ) : null}
      {receipt ? (
        <ReceiveReceipt
          status={receipt}
          amountSats={item.receiveRequest?.amountSats ?? item.amountSats}
          hidden={hidden}
          unit={unit}
        />
      ) : (
        <Notice
          icon={
            item.status === 'completed'
              ? 'check'
              : item.status === 'failed'
              ? 'alert'
              : 'clock'
          }
          kind={
            item.status === 'completed'
              ? 'success'
              : item.status === 'failed'
              ? 'error'
              : 'info'
          }
        >
          {item.status === 'completed'
            ? 'Completed'
            : item.status === 'uncertain'
            ? 'Status unknown. Do not pay again until this is resolved.'
            : item.status === 'pending'
            ? item.kind === 'request'
              ? 'Awaiting payment.'
              : item.kind === 'received'
              ? 'Payment detected. Waiting for confirmation.'
              : 'In progress.'
            : item.status === 'expired'
            ? item.receiveRequest?.legacy
              ? 'Invoice expired. Bitcoin payments appear separately until the original request is linked.'
              : 'Request expired.'
            : 'Payment did not complete.'}
        </Notice>
      )}
      <Card>
        <Row label="Date" value={dateLabel(item.timestamp)} />
        <Row
          label="Amount"
          value={hidden ? MASK : `${amount.value} ${amount.suffix}`}
        />
        <Row
          label={item.feeEstimated ? 'Estimated fee' : 'Fee'}
          value={
            item.feeKnown === false
              ? 'Unavailable'
              : hidden
              ? MASK
              : `${fee.value} ${fee.suffix}`
          }
        />
        <Row label="Status" value={activityStatus(item)} />
        {item.description ? (
          <Row label="Note" value={item.description} />
        ) : null}
      </Card>
      <ReceiveRequestDetails
        item={item}
        client={client}
        onRefresh={onRefresh}
        onBusy={onBusy}
      />
      {item.reference || item.txid || item.paymentHash || item.address ? (
        <Card>
          {item.reference ? (
            <CopyValue label="Reference" value={item.reference} />
          ) : null}
          {item.txid ? (
            <CopyValue label="Transaction" value={item.txid} />
          ) : null}
          {item.paymentHash ? (
            <CopyValue label="Payment hash" value={item.paymentHash} />
          ) : null}
          {item.address ? (
            <CopyValue label="Address" value={item.address} />
          ) : null}
        </Card>
      ) : null}
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
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
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
  activityRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  activityIcon: {
    height: 40,
    width: 40,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomingIcon: { backgroundColor: colors.mintSoft },
  activityText: { flex: 1, gap: 4 },
  activityTitle: { ...typography.label, fontSize: 14, color: colors.text },
  activityMeta: {
    ...typography.micro,
    fontSize: 11,
    color: colors.muted,
    fontWeight: '400',
  },
  activityAmount: {
    ...typography.label,
    fontSize: 14,
    color: colors.text,
    maxWidth: '42%',
    fontVariant: ['tabular-nums'],
  },
  incomingAmount: { color: colors.mint },
  failedAmount: { color: colors.muted, textDecorationLine: 'line-through' },
  smallUnit: { ...typography.micro, fontSize: 10, color: colors.muted },
  pressed: { opacity: 0.65 },
  emptyTitle: { ...typography.heading, color: colors.text },
  listContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  listHeader: { gap: space.sm, paddingTop: space.md, paddingBottom: space.sm },
  banner: { gap: space.lg, paddingBottom: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  filters: { flexDirection: 'row', gap: space.xxs + 2, flexWrap: 'wrap' },
  dayHeader: {
    ...typography.eyebrow,
    color: colors.faint,
    textTransform: 'uppercase',
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  sectionLabel: { ...typography.caption, color: colors.muted },
  detailIcon: {
    height: 64,
    width: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAmount: {
    ...typography.amount,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailUnit: { ...typography.caption, fontSize: 15, color: colors.muted },
});
