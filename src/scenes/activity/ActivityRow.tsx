import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Activity } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { StatusRing } from '../../glyphs/StatusRing';
import { riseIn } from '../../motion/presets';
import { curves } from '../../motion/tokens';
import { usePaneActive } from '../../stage/panes/Pane';
import type { Rect } from '../../stage/scene';
import {
  MASK,
  amountIn,
  dateLabel,
  radius,
  space,
  type as typography,
} from '../../theme';
import type { Unit } from '../../theme';
import { ROW_HEIGHT, activityStatus, timeLabel } from './model';
import type { Band } from './model';
import { measureNode, registerRow } from './rowRects';
import type { RowNode } from './rowRects';
import {
  EXPIRED_OPACITY,
  RAIL_GLYPH,
  amountVisual,
  railOf,
  ringFlags,
  ringVisual,
} from './visual';
import type { AmountVisual } from './visual';

/**
 * What the list tells the rows it draws: whether a payment has been shown
 * before, so only a new one arrives with a fade, and that rows here register
 * where they are, for a detail to grow out of.
 */
export interface RowList {
  seen: (id: string) => boolean;
}

export const RowListContext = createContext<RowList | null>(null);

/** How far a new payment falls into place from above. */
const ARRIVE = -8;

/** The strike through a failed or expired amount draws over this long. */
const STRIKE_MS = 300;

const TONES: Record<AmountVisual['tone'], string> = {
  sage: palette.sage,
  cream: palette.cream,
  steam: palette.steam,
  dust: palette.dust,
};

/**
 * One payment (REDESIGN.md 6, Activity row): its ring on the left, the amount
 * and the note in the middle, and the time over the rail it took on the
 * right. The engine's title only goes to a screen reader.
 *
 * Memoized, and its `onPress` takes the row it belongs to, and where the row
 * is on screen when that can be measured, for the detail to grow out of.
 * A per-row closure is a new prop on every render of the list, which defeats
 * the memo; handing the item back lets every call site pass one stable
 * handler.
 */
export const ActivityRow = React.memo(function ActivityRowItem({
  item,
  onPress,
  hidden = false,
  unit = 'sats',
  band,
}: {
  item: Activity;
  onPress: (item: Activity, rect?: Rect) => void;
  hidden?: boolean;
  unit?: Unit;
  /** Pinned to the honey band at the top of the list, and where in it. */
  band?: Band;
}) {
  const live = usePaneActive();
  const list = useContext(RowListContext);
  const ref = useRef<RowNode>(null);
  // Decided once, as the row mounts: only a payment the list has not shown
  // before arrives with a fade. One scrolled back into view does not.
  const [entering] = useState(() =>
    list && !list.seen(item.id) ? riseIn(ARRIVE) : undefined,
  );
  useEffect(
    () => (list ? registerRow(item.id, ref) : undefined),
    [list, item.id],
  );

  const status = activityStatus(item);
  const ring = ringVisual(item);
  const look = amountVisual(item);
  const amount = amountIn(item.amountSats, unit);
  const label = hidden
    ? copy.activity.rowHidden(item.title, status)
    : look.open
    ? copy.activity.rowOpen(item.title, status)
    : copy.activity.row(item.title, item.amountSats, status);
  const value = [
    ...ringFlags(ring),
    item.description,
    dateLabel(item.timestamp),
  ]
    .filter(Boolean)
    .join(', ');

  const press = () => {
    haptics.tick();
    onPress(item, measureNode(ref.current) ?? undefined);
  };

  return (
    <Reanimated.View entering={entering}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        // Hiding the balance has to hide it from the screen reader too, or
        // the amount is simply announced out loud instead of shown.
        accessibilityLabel={label}
        accessibilityHint={copy.activity.rowHint}
        accessibilityValue={{ text: value }}
        onPress={live ? press : undefined}
        style={({ pressed }) => [
          styles.row,
          band && [styles.band, BANDS[band]],
          item.status === 'expired' && styles.expired,
          pressed && styles.pressed,
        ]}
      >
        <StatusRing size={40} visual={ring} />
        <View style={styles.middle}>
          {look.open ? (
            <Glyph name="infinity" size={22} color={TONES[look.tone]} />
          ) : (
            <View style={styles.amount}>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={[
                  styles.figure,
                  { color: TONES[look.tone], fontWeight: look.weight },
                ]}
              >
                {hidden ? MASK : `${look.sign}${amount.value}`}
                <Text style={styles.unit}> {amount.suffix}</Text>
              </Text>
              <Strike struck={look.struck} />
            </View>
          )}
          {item.description ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={styles.note}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        <View style={styles.side}>
          <Text maxFontSizeMultiplier={1.4} style={styles.time}>
            {timeLabel(item.timestamp)}
          </Text>
          <Glyph
            name={RAIL_GLYPH[railOf(item)]}
            size={14}
            color={palette.dust}
          />
        </View>
      </Pressable>
    </Reanimated.View>
  );
});
ActivityRow.displayName = 'ActivityRow';

/**
 * A line through an amount that never moved. It draws across when a payment
 * fails or expires on screen, and is simply there for one that already had.
 */
function Strike({ struck }: { struck: boolean }) {
  const reach = useSharedValue(struck ? 1 : 0);
  useEffect(() => {
    reach.set(
      withTiming(struck ? 1 : 0, {
        duration: STRIKE_MS,
        easing: curves.standard,
      }),
    );
  }, [struck, reach]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: reach.get() }],
  }));
  return (
    <Reanimated.View pointerEvents="none" style={[styles.strike, style]} />
  );
}

const BANDS: Record<Band, object> = {
  solo: { borderRadius: radius.md },
  start: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  middle: {},
  end: {
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
};

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // The honey band runs a little wider than the rows, so what sits in it
  // still lines up with the rows below.
  band: {
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    backgroundColor: palette.honeyWash,
  },
  expired: { opacity: EXPIRED_OPACITY },
  pressed: { backgroundColor: palette.mocha },
  middle: { flex: 1, gap: 2, justifyContent: 'center' },
  amount: { alignSelf: 'flex-start' },
  figure: { ...typography.row },
  unit: { ...typography.meta, color: palette.steam, fontWeight: '400' },
  strike: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1.5,
    borderRadius: 1,
    backgroundColor: palette.dust,
    transformOrigin: 'left',
  },
  note: { ...typography.meta, color: palette.steam },
  side: { alignItems: 'flex-end', gap: space.xxs },
  time: { ...typography.meta, color: palette.steam },
});
