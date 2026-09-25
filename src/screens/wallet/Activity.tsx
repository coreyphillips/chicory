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
import { Card, Chip, Icon, IconButton, Title } from '../../components/ui';
import {
  MASK,
  amountIn,
  colors,
  dateLabel,
  number,
  radius,
  space,
  type as typography,
} from '../../theme';
import type { Unit } from '../../theme';
import {
  FILTERS,
  activitySections,
  activityStatus,
} from '../../scenes/activity/model';
import type { ActivitySection } from '../../scenes/activity/model';
import { usePaneActive } from '../../stage/panes/Pane';

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

const styles = StyleSheet.create({
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
});
