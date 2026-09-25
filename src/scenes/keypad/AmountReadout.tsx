import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { dropOut, riseIn, smooth } from '../../motion/presets';
import { durations } from '../../motion/tokens';
import { type as typography } from '../../theme';
import { BANG, DrawnGlyph } from '../send/DrawnGlyph';
import { useShake } from '../send/motion';
import { WaitingClock } from '../send/LoopingGlyphs';
import { Keypad } from './Keypad';
import { amountCells, digitsOnly, grouped, pressKey } from './keys';
import type { AmountTone, KeyName } from './keys';

/** Amounts are entered in sats, whatever unit the balance shows. */
const UNIT = 'sats';

/** The size of a mark beside the amount. */
const MARK = 16;

/** A new digit rises this far into place, and a deleted one drops this far. */
const RISE = 12;
const DROP = 8;

const TONES: Record<AmountTone, string> = {
  plain: palette.cream,
  'over-spendable': palette.honey,
  'over-total': palette.radish,
};

/** The micro-glyph each tone adds, so it reads without its colour. */
const MARKS: Record<AmountTone, GlyphName | null> = {
  plain: null,
  'over-spendable': 'clock',
  'over-total': 'bang',
};

/**
 * A mark beside the amount. The lock is still; the clock ticks while the
 * rest of the money arrives; the bang draws in as the amount goes past all
 * there is.
 */
function Mark({ name, color }: { name: GlyphName; color: string }) {
  if (name === 'clock') return <WaitingClock size={MARK} color={color} />;
  if (name === 'bang') {
    return <DrawnGlyph name="bang" size={MARK} color={color} strokes={BANG} />;
  }
  return <Glyph name={name} size={MARK} color={palette.steam} />;
}

export interface AmountReadoutProps {
  /** What a screen reader calls the amount, and how the suites find it. */
  accessibilityLabel: string;
  /** The amount as shown, with or without its separators. */
  value: string;
  /**
   * Called with the digits after each key, as a text field reports text.
   * Without it, as in a pane out of use, the keys take no touches.
   */
  onChangeText?: (text: string) => void;
  /** What a screen reader hears in place of an amount while there is none. */
  placeholder?: string;
  /** What a screen reader hears after the amount. */
  hint?: string;
  /**
   * False when something else sets the amount, such as a request that names
   * it: a lock shows beside it and the keypad goes.
   */
  editable?: boolean;
  /** The keys take no touches while the amount is being used. */
  busy?: boolean;
  tone?: AmountTone;
  /** What sits between the amount and its keypad, such as preset chips. */
  children?: ReactNode;
  ref?: Ref<ComponentRef<typeof View>>;
}

/**
 * An amount entered on the keypad (REDESIGN.md 5, Keypad): the digits at
 * 48pt, the keypad under them, and whatever the caller puts between.
 *
 * It takes the props a text field would, and reports what a key does the way
 * one would, so a screen can swap it in for a field and keep its state. Each
 * digit rises into place as it is keyed and drops away as it is deleted.
 * Holding backspace clears the amount. A 17th digit is refused: the amount
 * flashes radish and shakes, with a rigid tap.
 *
 * `tone` colours the amount against what it may be, with a micro-glyph for
 * each: honey and a clock when more than can be sent now, radish and a bang,
 * with one shake, when more than it can ever be. The words for either are
 * the caller's, in `hint`.
 */
export function AmountReadout({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  hint,
  editable = true,
  busy = false,
  tone = 'plain',
  children,
  ref,
}: AmountReadoutProps) {
  const digits = digitsOnly(value);
  const cells = amountCells(digits);
  const refusal = useShake();
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const { play: shake } = refusal;

  // The keys read the latest amount through a ref, so the keypad's handlers
  // stay the same from one digit to the next and it never redraws for one.
  const latest = useRef({ digits, onChangeText });
  useLayoutEffect(() => {
    latest.current = { digits, onChangeText };
  });
  const onKey = useCallback(
    (key: KeyName) => {
      const now = latest.current;
      const next = pressKey(now.digits, key);
      if (next === null) {
        haptics.rigid();
        flash.set(
          withSequence(
            withTiming(1, { duration: durations.tick }),
            withTiming(0, { duration: durations.move }),
          ),
        );
        shake();
        return;
      }
      if (next === now.digits) return;
      // Two keys in one frame each build on the one before.
      now.digits = next;
      now.onChangeText?.(next);
    },
    [flash, shake],
  );
  const onClear = useCallback(() => {
    haptics.rigid();
    latest.current.digits = '';
    latest.current.onChangeText?.('');
  }, []);

  // Going over what it can ever be is felt once, as it happens.
  const before = useRef(tone);
  useEffect(() => {
    if (tone === 'over-total' && before.current !== 'over-total') {
      haptics.warning();
      shake();
    }
    before.current = tone;
  }, [tone, shake]);

  const shown = grouped(digits);
  const color = TONES[tone];
  const marks = [editable ? null : 'lock', MARKS[tone]].filter(
    (mark): mark is GlyphName => mark !== null,
  );
  return (
    <>
      <Reanimated.View
        ref={ref}
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{
          text: shown ? `${shown} ${UNIT}` : placeholder || `0 ${UNIT}`,
        }}
        accessibilityHint={hint}
        accessibilityState={{ disabled: !editable }}
        style={[styles.readout, refusal.style]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.wash, refusal.tint]}
        />
        <Reanimated.View
          pointerEvents="none"
          style={[styles.wash, flashStyle]}
        />
        <View style={styles.amount}>
          {cells.length ? (
            cells.map(cell => (
              <Reanimated.View
                key={cell.key}
                entering={riseIn(RISE)}
                exiting={dropOut(DROP)}
                layout={smooth()}
              >
                <Text
                  style={[styles.digits, { color }]}
                  maxFontSizeMultiplier={1.2}
                >
                  {cell.text}
                </Text>
              </Reanimated.View>
            ))
          ) : (
            <Text
              style={[styles.digits, styles.empty]}
              maxFontSizeMultiplier={1.2}
            >
              0
            </Text>
          )}
          <Text style={styles.unit}>{UNIT}</Text>
          {marks.map(mark => (
            <View key={mark} style={styles.mark}>
              <Mark name={mark} color={color} />
            </View>
          ))}
        </View>
      </Reanimated.View>
      {children}
      {editable ? (
        <Keypad
          onKey={onKey}
          onClear={onClear}
          disabled={busy || !onChangeText}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexGrow: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wash: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    backgroundColor: palette.radishWash,
  },
  amount: { flexDirection: 'row', alignItems: 'baseline' },
  digits: { ...typography.amount, color: palette.cream },
  empty: { color: palette.dust },
  unit: { ...typography.heroUnit, color: palette.steam, marginLeft: 6 },
  mark: { marginLeft: 6, alignSelf: 'center' },
});
