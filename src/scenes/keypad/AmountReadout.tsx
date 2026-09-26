import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { popIn, useShake } from '../../motion/effects';
import { dropOut, riseIn, smooth } from '../../motion/presets';
import { steady } from '../../motion/steady';
import { curves, durations } from '../../motion/tokens';
import { motionReduced } from '../../services/motion';
import { type as typography } from '../../theme';
import { BANG, DrawnGlyph } from '../send/DrawnGlyph';
import type { Stroke } from '../send/DrawnGlyph';
import { WaitingClock } from '../send/LoopingGlyphs';
import { Keypad } from './Keypad';
import { amountCells, digitsOnly, grouped, isBlank, pressKey } from './keys';
import type { AmountTone, KeyName } from './keys';

/** Amounts are entered in sats, whatever unit the balance shows. */
const UNIT = 'sats';

/** How far an amount and its unit grow with Dynamic Type. */
const AMOUNT_SCALE = 1.2;

/** The size of the lock beside an amount set elsewhere. */
const MARK = 16;

/**
 * A limit's glyph, and the soft disc it sits on beside the amount, in the
 * tone's own fill: on a disc it reads as a state the amount is in, where a
 * bare bang or clock beside the unit read as punctuation.
 */
export const STATE_GLYPH = 20;
export const STATE_PIP = 32;

/** A new digit rises this far into place, and a deleted one drops this far. */
const RISE = 12;
const DROP = 8;

const LEAVE_FADE = { duration: durations.tick, easing: curves.standard };
const LEAVE_DROP = { duration: durations.exit, easing: curves.exit };

/**
 * A deleted digit drops DROP points as it leaves, and is gone from sight
 * within a tick: the unit steps into its place at once, so the two are
 * never drawn over each other for more than a frame or two, and then
 * faintly. Under Reduce Motion it only fades.
 */
export function leave(): EntryExitAnimationFunction {
  if (motionReduced()) return dropOut(DROP);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: {
        opacity: steady(withTiming(0, LEAVE_FADE)),
        transform: [{ translateY: steady(withTiming(DROP, LEAVE_DROP)) }],
      },
    };
  };
}

const TONES: Record<AmountTone, string> = {
  plain: palette.cream,
  'over-spendable': palette.honey,
  'over-total': palette.radish,
  under: palette.dust,
};

/** The disc under each tone's glyph. */
const SOFT: Record<AmountTone, string> = {
  plain: palette.mocha,
  'over-spendable': palette.honeySoft,
  'over-total': palette.radishSoft,
  under: palette.mocha,
};

/**
 * The micro-glyph each tone adds, so it reads without its colour
 * (REDESIGN.md 9): a clock while the rest is still arriving, a bang past all
 * there is, and a sprout under the least it can be, which is only not
 * enough yet.
 */
const MARKS: Record<AmountTone, GlyphName | null> = {
  plain: null,
  'over-spendable': 'clock',
  'over-total': 'bang',
  under: 'sprout',
};

/** The sprout grows from its base with the reveal spring (REDESIGN.md 4). */
const SPROUT: Stroke[] = [{ pop: { x: 12, y: 21 } }];
const DRAW: Stroke[] = [{ duration: durations.draw }];

/**
 * A mark beside the amount. The lock is still, a small steam glyph. A limit
 * is a state glyph on its tone's disc: the clock ticks while the rest of
 * the money arrives; the bang draws in as the amount goes past all there
 * is; the sprout grows in while there is not enough yet.
 */
function Mark({
  name,
  color,
  tone,
}: {
  name: GlyphName;
  color: string;
  tone: AmountTone;
}) {
  if (name === 'lock') {
    return <Glyph name={name} size={MARK} color={palette.steam} />;
  }
  return (
    <View style={[styles.pip, { backgroundColor: SOFT[tone] }]}>
      {name === 'clock' ? (
        <WaitingClock size={STATE_GLYPH} color={color} />
      ) : (
        <DrawnGlyph
          name={name}
          size={STATE_GLYPH}
          color={color}
          strokes={name === 'bang' ? BANG : name === 'sprout' ? SPROUT : DRAW}
        />
      )}
    </View>
  );
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
  /**
   * What stands in the amount while it has no digits, in place of the dust
   * 0, such as an infinity where the payer may choose.
   */
  empty?: ReactNode;
  /** Each change shakes the amount once, as when something refuses it. */
  shake?: number;
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
 * The amount moves as one: its figures, separators, unit and marks are laid
 * out afresh at once, so a comma moves with the digits it groups and the
 * unit is out of the way before a new digit shows, and only the row as a
 * whole eases to where its new width centres it.
 * Holding backspace clears the amount. A 17th digit is refused: the amount
 * flashes radish and shakes, with a rigid tap, and a screen reader is told
 * why.
 *
 * `tone` colours the amount against what it may be, with a micro-glyph for
 * each: honey and a clock when more than can be sent now, radish and a bang,
 * with one shake, when more than it can ever be, and dust and a sprout under
 * the least it can be. The words for each are the caller's, in `hint`, which
 * a long press on a mark whispers. The label is only ever spoken.
 *
 * The digits and their unit stop growing at 1.2 with Dynamic Type
 * (REDESIGN.md 3.3).
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
  empty,
  shake: shakes,
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
        // Felt, seen and heard: a screen reader is told why the key did
        // nothing.
        announce(copy.keypad.refused);
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

  // A caller's refusal shakes it once for each, from the second on too.
  const shaken = useRef(shakes);
  useEffect(() => {
    if (shakes === shaken.current) return;
    shaken.current = shakes;
    shake();
  }, [shakes, shake]);

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
        accessibilityState={{ disabled: !editable, busy }}
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
        <Reanimated.View layout={smooth()} style={styles.amount}>
          {cells.length ? (
            cells.map(cell => (
              <Reanimated.View
                key={cell.key}
                entering={riseIn(RISE)}
                exiting={leave()}
              >
                <Text
                  style={[styles.digits, { color }]}
                  maxFontSizeMultiplier={AMOUNT_SCALE}
                >
                  {cell.text}
                </Text>
              </Reanimated.View>
            ))
          ) : empty ? (
            <View style={styles.face}>{empty}</View>
          ) : (
            <Text
              style={[styles.digits, styles.empty]}
              maxFontSizeMultiplier={AMOUNT_SCALE}
            >
              0
            </Text>
          )}
          {/* The unit and the marks stand where the digits end, at once, so
            no digit is ever drawn over them on its way in. */}
          <Text style={styles.unit} maxFontSizeMultiplier={AMOUNT_SCALE}>
            {UNIT}
          </Text>
          {marks.map(mark => (
            <Reanimated.View
              key={mark}
              entering={mark === 'lock' ? undefined : popIn()}
              style={styles.mark}
            >
              <Whisper label={hint ?? ''} enabled={!!hint}>
                <Mark name={mark} color={color} tone={tone} />
              </Whisper>
            </Reanimated.View>
          ))}
        </Reanimated.View>
      </Reanimated.View>
      {children}
      {editable ? (
        <Keypad
          onKey={onKey}
          onClear={onClear}
          blank={isBlank(digits)}
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
  face: { flexDirection: 'row', alignItems: 'center' },
  unit: { ...typography.heroUnit, color: palette.steam, marginLeft: 6 },
  // Centred on the amount's line, level with its figures.
  mark: { marginLeft: 8, alignSelf: 'center' },
  pip: {
    width: STATE_PIP,
    height: STATE_PIP,
    borderRadius: STATE_PIP / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
