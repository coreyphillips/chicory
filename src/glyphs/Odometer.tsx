import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PixelRatio,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { TextStyle } from 'react-native';
import Reanimated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryAnimationsValues,
  EntryExitAnimationFunction,
  SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { copy } from '../design/copy';
import { mixHex, palette } from '../design/palette';
import { fract, useAwake, useLoop } from '../motion/loops';
import { curves, durations, springs } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { MASK, space, type as typography } from '../theme';
import type { Unit } from '../theme';

/**
 * A rolling amount (REDESIGN.md 5, Odometer). Each digit is a clipped column
 * of "0..9,0" that rolls to the digit's position, keyed by its place value so
 * a digit keeps its column as the amount grows. BTC always shows all eight
 * decimals, with the zeros after the last significant one in dust.
 *
 * A cell is exactly one line of its figures tall, and a rolling digit fades
 * as it slides over the cell's edge, so no part of a neighbouring digit shows
 * above or below it mid-roll.
 *
 * One shared value in sats drives every column on the UI thread, so a roll
 * costs no renders past its first and last. At rest each cell is a single
 * digit; the columns exist only while something moves. A new unit lifts the
 * old cells away and rises the new ones in, hiding scrambles the digits
 * before six dots scale in, and a stale amount turns steam while a dip runs
 * across its cells. Under Reduce Motion every change is a short crossfade.
 *
 * The whole odometer is one element to a screen reader; the cells are hidden.
 * Without an `accessibilityLabel` it reads the amount in sats.
 *
 * The hero sizes itself to fit `room`, the width its container measured,
 * and until it has one the window's width between the page edges. When it
 * steps to another size with the unit unchanged, the figures crossfade over
 * 160ms rather than jump; a new unit brings its cells in at the new size.
 */
export type OdometerVariant =
  | 'hero'
  | 'amount'
  | 'amountDetail'
  | 'line'
  | 'row';

export interface OdometerProps {
  sats: number;
  unit: Unit;
  masked?: boolean;
  stale?: boolean;
  variant: OdometerVariant;
  color?: string;
  /** Drawn before the digits, and dropped while masked. */
  sign?: '+' | '-' | null;
  /** The width the hero may take, as its container measured it. */
  room?: number;
  /**
   * How long a roll takes, in place of `rollDuration` of the change: for a
   * count whose length is set by what it belongs to, as the received
   * celebration's count-up is (REDESIGN.md 5).
   */
  duration?: number;
  accessibilityLabel?: string;
}

/** A digit's column, or a separator between columns. */
export type OdometerCell =
  | {
      kind: 'digit';
      key: string;
      /** The power of ten, in sats, this column counts. */
      place: number;
      digit: number;
      /** A trailing zero of a BTC amount, drawn in dust. */
      dim: boolean;
    }
  | { kind: 'mark'; key: string; char: ',' | '.' };

/** Eight decimals: a BTC amount's decimal point sits above place 8. */
const BTC_PLACES = 8;

const smoothstep = (t: number) => {
  'worklet';
  return t * t * (3 - 2 * t);
};

/**
 * Where the column for place `k` has rolled to when the amount is `v` sats,
 * in digits: 3 shows a 3, 3.5 is halfway to 4, and 10 is the trailing 0 that
 * wraps back to the top. The ones column follows `v` directly. Every higher
 * column holds still until the places below it are in their last tenth, then
 * eases over in step with them, the way a mechanical counter carries.
 */
export function digitPosition(v: number, k: number): number {
  'worklet';
  const u = 10 ** k;
  const whole = Math.floor(v / u);
  const rem = v - whole * u;
  if (k === 0) return (whole % 10) + rem;
  const carry = Math.min(1, Math.max(0, (rem - 0.9 * u) / (0.1 * u)));
  return (whole % 10) + smoothstep(carry);
}

/** How far column `k` has carried toward its next digit at `v`, 0 to 1. */
function carryOf(v: number, k: number): number {
  'worklet';
  return digitPosition(v, k) - (Math.floor(v / 10 ** k) % 10);
}

/**
 * How much of a rolling column's row `i` shows when the column stands at
 * `pos`: all of it where it fills the cell, less as it slides over the
 * cell's edge, and none once it is a whole row out. The two rows in view
 * always add to one, so a roll crossfades its digits as it slides them.
 */
export function rowFade(i: number, pos: number): number {
  'worklet';
  return 1 - smoothstep(Math.min(1, Math.abs(i - pos)));
}

/**
 * Which of a column's even rows (`parity` 0) or odd rows (1) is in view at
 * `pos`. A cell shows at most two rows, one of each, so a column drawn as
 * two layers, one for each parity, can fade each by its one row in view.
 */
export function rowInView(pos: number, parity: number): number {
  'worklet';
  const top = Math.floor(pos);
  return top % 2 === parity ? top : top + 1;
}

/** A column position folded back into its ten digits. */
function wrap(pos: number): number {
  'worklet';
  return ((pos % 10) + 10) % 10;
}

/**
 * A roll in flight: the amounts it runs between, and for each place how far
 * the column was drawn from digitPosition when the roll set out.
 */
export interface Roll {
  from: number;
  to: number;
  lead: number[];
}

/**
 * Where column `k` is drawn at `v` during `roll`. digitPosition starts a
 * column's carry while the places below it are in their last tenth, so on
 * its own an amount such as 1,295 would sit with its hundreds halfway to 3.
 * That difference is blended out across the roll: every column sets out
 * from the digit that was showing and lands on the amount's own digit.
 */
export function rollPosition(v: number, k: number, roll: Roll): number {
  'worklet';
  const span = roll.to - roll.from;
  const p = span === 0 ? 1 : Math.min(1, Math.max(0, (v - roll.from) / span));
  return wrap(
    digitPosition(v, k) +
      (1 - p) * (roll.lead[k] ?? 0) -
      p * carryOf(roll.to, k),
  );
}

/**
 * A roll from `from` to `to`. One that takes over from a roll still under
 * way sets out from where that one had drawn each column, so nothing jumps.
 */
export function startRoll(
  from: number,
  to: number,
  previous: Roll | null,
): Roll {
  const places = String(Math.ceil(Math.max(from, to))).length + 1;
  const lead = Array.from({ length: places }, (_, k) => {
    const shown = previous
      ? rollPosition(from, k, previous)
      : Math.floor(from / 10 ** k) % 10;
    const off = shown - digitPosition(from, k);
    // The short way round a column's ten digits.
    return off - 10 * Math.round(off / 10);
  });
  return { from, to, lead };
}

/**
 * The cells for `sats` in `unit`, left to right. Sats group in threes; BTC
 * has a whole part with no grouping, a point and eight decimals.
 */
export function cellsFor(sats: number, unit: Unit): OdometerCell[] {
  const digits = String(Math.abs(Math.trunc(sats)));
  const cells: OdometerCell[] = [];
  const digit = (place: number, dim = false): OdometerCell => ({
    kind: 'digit',
    key: `d${place}`,
    place,
    digit: Math.floor(Math.abs(sats) / 10 ** place) % 10,
    dim,
  });
  if (unit === 'sats') {
    for (let place = digits.length - 1; place >= 0; place--) {
      cells.push(digit(place));
      if (place > 0 && place % 3 === 0) {
        cells.push({ kind: 'mark', key: `m${place}`, char: ',' });
      }
    }
    return cells;
  }
  const top = Math.max(BTC_PLACES, digits.length - 1);
  // Decimals below the last significant digit dim; all eight for no amount.
  const trailing = sats
    ? digits.length - digits.replace(/0+$/, '').length
    : BTC_PLACES;
  for (let place = top; place >= 0; place--) {
    cells.push(digit(place, place < BTC_PLACES && place < trailing));
    if (place === BTC_PLACES) {
      cells.push({ kind: 'mark', key: 'point', char: '.' });
    }
  }
  return cells;
}

/**
 * The cells a roll from `from` to `to` passes through: the target's, plus
 * any leading column only the other end has, so a digit that is going away
 * rolls to 0 before it leaves and one that is arriving rolls up from 0.
 */
export function rollCells(from: number, to: number, unit: Unit) {
  const target = cellsFor(to, unit);
  const wide = cellsFor(Math.max(Math.abs(from), Math.abs(to)), unit);
  if (wide.length === target.length) return target;
  const kept = new Map(target.map(cell => [cell.key, cell]));
  return wide.map(cell => kept.get(cell.key) ?? cell);
}

/** The hero's sizes, largest first: it takes the first the amount fits. */
export const HERO_SIZES = [64, 56, 48, 40];
/**
 * A tabular figure's advance as a share of its size. The hero picks its
 * size before it draws, so a balance never changes size mid-roll, and this
 * errs a little wide, since the system faces' figures sit just under it.
 */
const FIGURE_EM = 0.6;
/** The unit beside the hero, at heroUnit's 15pt, and the gap before it. */
const UNIT_EM = 0.62;
const UNIT_SIZE = 15;
const UNIT_GAP = 6;

/**
 * The hero's font size for `figures` digits (and a sign, if any) and
 * `marks` separators beside `suffix`, in `room` points at `scale` times the
 * type size: 64, stepping down to 56, 48 and 40 until it fits, and 40 when
 * nothing does. Never `adjustsFontSizeToFit`, which would shrink it per frame.
 */
export function heroSize(
  figures: number,
  marks: number,
  suffix: string,
  room: number,
  scale: number,
): number {
  const unit = suffix.length * UNIT_EM * UNIT_SIZE + UNIT_GAP;
  const fits = (size: number) => {
    const figure = FIGURE_EM * size + heroSpacing(size);
    return (figures * figure + marks * MARK_EM * size + unit) * scale <= room;
  };
  return HERO_SIZES.find(fits) ?? HERO_SIZES[HERO_SIZES.length - 1];
}

/**
 * A cell's height: one line box of its figures, in whole pixels rounded up
 * as Android sets a line with a line height, so a column's rows step by
 * exactly what the cell shows and nothing of the next row is in it.
 */
export function cellHeight(
  lineHeight: number,
  scale: number,
  ratio: number,
): number {
  return Math.ceil(lineHeight * scale * ratio - 1e-6) / ratio;
}

/** The hero's tracking, which tightens with its size. */
function heroSpacing(size: number): number {
  return ((typography.hero.letterSpacing ?? 0) * size) / HERO_SIZES[0];
}

/** A roll's length: longer for a bigger change, never slow. */
export function rollDuration(delta: number): number {
  return Math.min(
    1100,
    Math.max(280, 280 + 140 * Math.log10(Math.abs(delta) + 1)),
  );
}

export const SCRAMBLE_JUMPS = 4;
const SCRAMBLE_STEP_MS = 40;

/**
 * The digit a column shows `s` jumps into a scramble (0 to 4). Hiding starts
 * on the real digit and jumps four times; showing jumps four times and lands
 * on it. A jump never shows the column's own digit.
 */
export function scrambleDigit(
  digit: number,
  place: number,
  s: number,
  landing: boolean,
): number {
  'worklet';
  const jump = Math.min(SCRAMBLE_JUMPS, Math.max(0, Math.floor(s)));
  if (landing ? jump === SCRAMBLE_JUMPS : jump === 0) return digit;
  return (digit + 1 + ((place * 7 + jump * 3) % 9)) % 10;
}

const DIP_MS = 420;
const DIP_STEP_MS = 60;

/**
 * Cell `index`'s opacity `ms` into the stale shimmer: each cell in turn
 * dips to .65 and back, 60ms after the one before it.
 */
export function staleDip(ms: number, index: number): number {
  'worklet';
  const t = ms - index * DIP_STEP_MS;
  if (t <= 0 || t >= DIP_MS) return 1;
  return 1 - 0.35 * Math.sin((Math.PI * t) / DIP_MS);
}

/**
 * What the cells are doing: at rest, rolling to a new amount, or scrambling
 * on the way to the mask or back from it.
 */
export type OdometerPhase = 'rest' | 'roll' | 'scramble' | 'unscramble';

interface Reading {
  sats: number;
  unit: Unit;
  masked: boolean;
}

/**
 * The phase a change from `before` to `after` starts. A new unit swaps the
 * cells rather than rolling them, and nothing moves under a mask or under
 * Reduce Motion, where the cells crossfade instead.
 */
export function nextPhase(
  before: Reading,
  after: Reading,
  current: OdometerPhase,
  reduced: boolean,
): OdometerPhase {
  if (reduced) return 'rest';
  if (before.masked !== after.masked) {
    return after.masked ? 'scramble' : 'unscramble';
  }
  if (after.masked) return current === 'scramble' ? current : 'rest';
  if (before.unit !== after.unit) return 'rest';
  if (before.sats !== after.sats) {
    return current === 'unscramble' ? current : 'roll';
  }
  return current;
}

const VARIANTS: Record<OdometerVariant, TextStyle> = {
  hero: typography.hero,
  amount: typography.amount,
  amountDetail: typography.amountDetail,
  line: typography.line,
  row: typography.row,
};

/** The hero at each of its sizes, its line height and tracking in step. */
const HERO_AT: Record<number, TextStyle> = Object.fromEntries(
  HERO_SIZES.map(size => [
    size,
    {
      ...typography.hero,
      fontSize: size,
      lineHeight: Math.round(
        ((typography.hero.lineHeight ?? 0) * size) / HERO_SIZES[0],
      ),
      letterSpacing: heroSpacing(size),
    },
  ]),
);

const SUFFIX: Record<Unit, string> = { sats: 'sats', btc: 'BTC' };

/** Big figures stop growing sooner, so they never outrun the screen. */
const MAX_SCALE: Record<OdometerVariant, number> = {
  hero: 1.2,
  amount: 1.2,
  amountDetail: 1.2,
  line: 1.4,
  row: 1.4,
};

/** A separator is narrower than a digit: .30em. */
const MARK_EM = 0.3;
const STALE_FADE_MS = 600;
const COLUMN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const DOTS = [...MASK];
const CELL_STEP_MS = 12;
const DOT_STEP_MS = 20;
/** How far a cell lifts as it leaves and rises as it arrives. */
const CELL_RISE = 8;

/** A cell arriving: it rises into place on the snap spring. */
function cellIn(index: number, reduced: boolean) {
  if (reduced) return CROSSFADE_IN;
  const delay = index * CELL_STEP_MS;
  const enter: EntryExitAnimationFunction = () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: CELL_RISE }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, { duration: durations.enter, easing: curves.enter }),
        ),
        transform: [
          { translateY: withDelay(delay, withSpring(0, springs.snap)) },
        ],
      },
    };
  };
  return enter;
}

/**
 * A leading cell a roll brings in: it opens from no width as it fades up,
 * while the cells beside it slide over.
 */
const growIn: EntryExitAnimationFunction = (values: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, width: 0 },
    animations: {
      opacity: withTiming(1, {
        duration: durations.enter,
        easing: curves.enter,
      }),
      width: withTiming(values.targetWidth, {
        duration: durations.move,
        easing: curves.standard,
      }),
    },
  };
};

/** How a cell arrives: grown by a roll, risen by a swap, faded if reduced. */
function arrival(index: number, rolling: boolean, reduced: boolean) {
  return rolling && !reduced ? growIn : cellIn(index, reduced);
}

/** A cell leaving: it lifts and fades, a beat after the one to its left. */
function cellOut(index: number, reduced: boolean) {
  if (reduced) return CROSSFADE_OUT;
  const delay = index * CELL_STEP_MS;
  const exit: EntryExitAnimationFunction = () => {
    'worklet';
    const config = { duration: durations.exit, easing: curves.exit };
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: {
        opacity: withDelay(delay, withTiming(0, config)),
        transform: [
          { translateY: withDelay(delay, withTiming(-CELL_RISE, config)) },
        ],
      },
    };
  };
  return exit;
}

/** A mask dot arriving: it scales in on the snap spring. */
function dotIn(index: number, reduced: boolean) {
  if (reduced) return CROSSFADE_IN;
  const delay = index * DOT_STEP_MS;
  const enter: EntryExitAnimationFunction = () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.3 }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, { duration: durations.exit, easing: curves.enter }),
        ),
        transform: [{ scale: withDelay(delay, withSpring(1, springs.snap)) }],
      },
    };
  };
  return enter;
}

/** The figures crossfade as the hero steps to another size. */
const STEP_IN = FadeIn.duration(durations.crossfade).reduceMotion(
  ReduceMotion.Never,
);
const STEP_OUT = FadeOut.duration(durations.crossfade).reduceMotion(
  ReduceMotion.Never,
);

/**
 * Whether the figures crossfade on the way from one size to the next: only
 * for a step with the unit unchanged, whose cells would otherwise jump, and
 * only between sizes fitted to the same room, so the first measure does
 * not fade the hero in again.
 */
export function stepsSize(
  before: { unit: Unit; size: number; measured: boolean },
  after: { unit: Unit; size: number; measured: boolean },
): boolean {
  return (
    before.unit === after.unit &&
    before.measured === after.measured &&
    before.size !== after.size
  );
}

/** Reduce Motion: values swap with a 120ms crossfade. */
const CROSSFADE_MS = 120;
const CROSSFADE_IN = FadeIn.duration(CROSSFADE_MS).reduceMotion(
  ReduceMotion.Never,
);
const CROSSFADE_OUT = FadeOut.duration(CROSSFADE_MS).reduceMotion(
  ReduceMotion.Never,
);
/** Cells slide aside for a new leading digit rather than jump. */
const CELL_LAYOUT = LinearTransition.duration(durations.move).easing(
  curves.standard,
);

/** What every cell of one odometer shares. */
interface Rig {
  v: SharedValue<number>;
  roll: SharedValue<Roll>;
  s: SharedValue<number>;
  shimmer: SharedValue<number>;
  /** The ink, which turns steam when stale. */
  ink: object;
  text: TextStyle[];
  height: number;
  markWidth: number;
  maxScale: number;
  reduced: boolean;
}

type Motion = 'still' | 'roll' | 'scramble' | 'unscramble';

function useShimmer(shimmer: SharedValue<number>, index: number) {
  return useAnimatedStyle(
    () => ({
      opacity: staleDip(fract(shimmer.get()) * durations.shimmer, index),
    }),
    [index],
  );
}

/**
 * A column's rows of one parity, even (0) or odd (1), with a gap where each
 * row of the other parity sits, rolled to where the column stands and faded
 * by its one row in view.
 */
const ColumnRows = memo(function DigitColumnRows({
  parity,
  place,
  digit,
  dim,
  motion,
  rig,
}: {
  parity: number;
  place: number;
  digit: number;
  dim: boolean;
  motion: Motion;
  rig: Rig;
}) {
  const { v, roll, s, height } = rig;
  const style = useAnimatedStyle(() => {
    const pos =
      motion === 'roll'
        ? rollPosition(v.get(), place, roll.get())
        : scrambleDigit(digit, place, s.get(), motion === 'unscramble');
    return {
      opacity: rowFade(rowInView(pos, parity), pos),
      transform: [{ translateY: -pos * height }],
    };
  }, [parity, motion, place, digit, height]);
  return (
    <Reanimated.View style={[parity ? styles.over : undefined, style]}>
      {COLUMN.map((d, i) =>
        i % 2 === parity ? (
          <Reanimated.Text
            key={i}
            style={[...rig.text, { height }, dim ? styles.dim : rig.ink]}
            maxFontSizeMultiplier={rig.maxScale}
          >
            {d}
          </Reanimated.Text>
        ) : (
          <View key={i} style={{ height }} />
        ),
      )}
    </Reanimated.View>
  );
});

/**
 * A digit's column while it moves: the even rows in the cell's flow, which
 * size it, and the odd rows over them.
 */
function Column(props: {
  place: number;
  digit: number;
  dim: boolean;
  motion: Motion;
  rig: Rig;
}) {
  return (
    <>
      <ColumnRows parity={0} {...props} />
      <ColumnRows parity={1} {...props} />
    </>
  );
}

const DigitCell = memo(function OdometerDigit({
  place,
  digit,
  dim,
  index,
  motion,
  rig,
}: {
  place: number;
  digit: number;
  dim: boolean;
  index: number;
  motion: Motion;
  rig: Rig;
}) {
  const wave = useShimmer(rig.shimmer, index);
  return (
    <Reanimated.View
      entering={arrival(index, motion === 'roll', rig.reduced)}
      exiting={cellOut(index, rig.reduced)}
      layout={rig.reduced ? undefined : CELL_LAYOUT}
      style={[styles.cell, { height: rig.height }, wave]}
    >
      {motion === 'still' ? (
        <Reanimated.Text
          style={[
            ...rig.text,
            { height: rig.height },
            dim ? styles.dim : rig.ink,
          ]}
          maxFontSizeMultiplier={rig.maxScale}
        >
          {digit}
        </Reanimated.Text>
      ) : (
        <Column
          place={place}
          digit={digit}
          dim={dim}
          motion={motion}
          rig={rig}
        />
      )}
    </Reanimated.View>
  );
});

const MarkCell = memo(function OdometerMark({
  char,
  index,
  rolling,
  rig,
}: {
  char: string;
  index: number;
  rolling: boolean;
  rig: Rig;
}) {
  const wave = useShimmer(rig.shimmer, index);
  return (
    <Reanimated.View
      entering={arrival(index, rolling, rig.reduced)}
      exiting={cellOut(index, rig.reduced)}
      layout={rig.reduced ? undefined : CELL_LAYOUT}
      style={[styles.cell, { height: rig.height, width: rig.markWidth }, wave]}
    >
      <Reanimated.Text
        style={[...rig.text, styles.mark, rig.ink]}
        maxFontSizeMultiplier={rig.maxScale}
      >
        {char}
      </Reanimated.Text>
    </Reanimated.View>
  );
});

const DotCell = memo(function OdometerDot({
  index,
  rig,
}: {
  index: number;
  rig: Rig;
}) {
  return (
    <Reanimated.View
      entering={dotIn(index, rig.reduced)}
      exiting={rig.reduced ? CROSSFADE_OUT : cellOut(0, false)}
      style={[styles.cell, { height: rig.height }]}
    >
      <Reanimated.Text
        style={[...rig.text, rig.ink]}
        maxFontSizeMultiplier={rig.maxScale}
      >
        {DOTS[index]}
      </Reanimated.Text>
    </Reanimated.View>
  );
});

export function Odometer({
  sats,
  unit,
  masked = false,
  stale = false,
  variant,
  color = palette.cream,
  sign = null,
  room,
  duration,
  accessibilityLabel,
}: OdometerProps) {
  const { reduced } = useMotionPrefs();
  const awake = useAwake();
  const { fontScale, width } = useWindowDimensions();

  // Where the cells were last asked to be, and what they are doing about
  // it. A change is read during the render that brings it, so the first
  // frame of a roll already draws columns rather than the new digits.
  const [seen, setSeen] = useState(() => ({
    sats,
    unit,
    masked,
    phase: 'rest' as OdometerPhase,
    // The widest amount the current roll has passed through.
    span: Math.abs(sats),
  }));
  let now = seen;
  if (seen.sats !== sats || seen.unit !== unit || seen.masked !== masked) {
    const phase = nextPhase(seen, { sats, unit, masked }, seen.phase, reduced);
    const from = seen.phase === 'roll' ? seen.span : Math.abs(seen.sats);
    const span =
      phase === 'roll' ? Math.max(from, Math.abs(sats)) : Math.abs(sats);
    now = { sats, unit, masked, phase, span };
    setSeen(now);
  }
  const { phase, span } = now;
  const settle = useCallback(
    () =>
      setSeen(last => ({ ...last, phase: 'rest', span: Math.abs(last.sats) })),
    [],
  );

  // The columns count the amount's size; a sign is drawn on its own.
  const target = Math.abs(sats);
  const v = useSharedValue(target);
  const roll = useSharedValue<Roll>({ from: target, to: target, lead: [] });
  const rolling = useRef<Roll | null>(null);
  useEffect(() => {
    cancelAnimation(v);
    if (phase !== 'roll') {
      rolling.current = null;
      v.set(target);
      return;
    }
    const from = v.get();
    const next = startRoll(from, target, rolling.current);
    rolling.current = next;
    roll.set(next);
    v.set(
      withTiming(
        target,
        {
          duration: duration ?? rollDuration(target - from),
          easing: curves.standard,
        },
        done => {
          'worklet';
          if (done) scheduleOnRN(settle);
        },
      ),
    );
  }, [v, roll, phase, target, settle, duration]);

  const s = useSharedValue(0);
  useEffect(() => {
    if (phase !== 'scramble' && phase !== 'unscramble') return;
    cancelAnimation(s);
    s.set(0);
    s.set(
      withTiming(
        SCRAMBLE_JUMPS,
        {
          duration: SCRAMBLE_JUMPS * SCRAMBLE_STEP_MS,
          easing: curves.linear,
        },
        done => {
          'worklet';
          if (done) scheduleOnRN(settle);
        },
      ),
    );
  }, [s, phase, settle]);

  const dull = useSharedValue(stale ? 1 : 0);
  useEffect(() => {
    if (dull.get() === (stale ? 1 : 0)) return;
    dull.set(
      withTiming(stale ? 1 : 0, {
        duration: STALE_FADE_MS,
        easing: curves.standard,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [dull, stale]);
  const ink = useAnimatedStyle(
    () => ({ color: mixHex(color, palette.steam, dull.get()) }),
    [color],
  );
  const shimmer = useLoop(durations.shimmer, stale && awake && !reduced);

  const dots = masked && phase !== 'scramble';
  // A masked amount is its dots alone: a sign would say which way it went.
  const signed = masked ? null : sign;
  const motion: Motion = phase === 'rest' ? 'still' : phase;
  const cells =
    phase === 'roll' ? rollCells(span, sats, unit) : cellsFor(sats, unit);

  const maxScale = MAX_SCALE[variant];
  const scale = Math.min(fontScale, maxScale);
  // The hero sizes itself to what it draws, across the page between its
  // edges. A roll draws its widest end throughout, so it never resizes
  // midway, and a mask is sized as its six dots, so a hidden balance does
  // not give away how long it is.
  const marks = dots ? 0 : cells.filter(cell => cell.kind === 'mark').length;
  const figures =
    (dots ? DOTS.length : cells.length - marks) + (signed ? 1 : 0);
  const measured = room !== undefined;
  const fitted = heroSize(
    figures,
    marks,
    SUFFIX[unit],
    room ?? width - 2 * space.xl,
    scale,
  );
  const base = variant === 'hero' ? HERO_AT[fitted] : VARIANTS[variant];
  // Each step to another size in the same unit keys the figures afresh, so
  // the old ones fade out as the new ones fade in.
  const size = base.fontSize ?? 0;
  const [step, setStep] = useState({ unit, size, measured, count: 0 });
  if (step.unit !== unit || step.size !== size || step.measured !== measured) {
    const next = { unit, size, measured };
    setStep({
      ...next,
      count: step.count + (stepsSize(step, next) ? 1 : 0),
    });
  }
  const received = variant === 'row' && sign === '+';
  const rig = useMemo<Rig>(
    () => ({
      v,
      roll,
      s,
      shimmer,
      ink,
      text: received
        ? [base, styles.figure, styles.received]
        : [base, styles.figure],
      height: cellHeight(base.lineHeight ?? 0, scale, PixelRatio.get()),
      markWidth: MARK_EM * (base.fontSize ?? 0) * scale,
      maxScale,
      reduced,
    }),
    [v, roll, s, shimmer, ink, base, received, scale, maxScale, reduced],
  );
  // Under Reduce Motion a changed digit is a new cell, so it crossfades
  // with the old one in place instead of changing under the eye.
  const keyOf = (cell: OdometerCell) =>
    `${unit}${cell.key}${
      reduced && cell.kind === 'digit' ? `:${cell.digit}` : ''
    }`;

  const label =
    accessibilityLabel ??
    (masked ? copy.amount.hidden : copy.amount.spoken(sats));
  return (
    <View accessible accessibilityLabel={label} style={styles.row}>
      <View
        style={styles.row}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <LayoutAnimationConfig skipEntering>
          <Reanimated.View
            key={`size${step.count}`}
            entering={STEP_IN}
            exiting={STEP_OUT}
            style={styles.cells}
          >
            <LayoutAnimationConfig skipEntering skipExiting>
              {signed ? (
                <Reanimated.Text
                  style={[...rig.text, ink]}
                  maxFontSizeMultiplier={maxScale}
                >
                  {signed === '-' ? '−' : '+'}
                </Reanimated.Text>
              ) : null}
              {dots
                ? DOTS.map((_, i) => (
                    <DotCell key={`mask${i}`} index={i} rig={rig} />
                  ))
                : cells.map((cell, i) =>
                    cell.kind === 'digit' ? (
                      <DigitCell
                        key={keyOf(cell)}
                        place={cell.place}
                        digit={cell.digit}
                        dim={cell.dim}
                        index={i}
                        motion={motion}
                        rig={rig}
                      />
                    ) : (
                      <MarkCell
                        key={keyOf(cell)}
                        char={cell.char}
                        index={i}
                        rolling={phase === 'roll'}
                        rig={rig}
                      />
                    ),
                  )}
            </LayoutAnimationConfig>
          </Reanimated.View>
          <Reanimated.Text
            key={unit}
            entering={cellIn(0, reduced)}
            exiting={cellOut(0, reduced)}
            style={[typography.heroUnit, styles.unit]}
            maxFontSizeMultiplier={maxScale}
          >
            {SUFFIX[unit]}
          </Reanimated.Text>
        </LayoutAnimationConfig>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  cells: { flexDirection: 'row' },
  cell: { overflow: 'hidden' },
  // A figure's line box and nothing more: no font padding over it on
  // Android, and its glyphs in the middle of it.
  figure: { includeFontPadding: false, textAlignVertical: 'center' },
  over: { position: 'absolute', top: 0, left: 0, right: 0 },
  mark: { textAlign: 'center' },
  received: { fontWeight: '600' },
  dim: { color: palette.dust },
  unit: { color: palette.steam },
});
