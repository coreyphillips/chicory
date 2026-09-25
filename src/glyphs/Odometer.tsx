import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { copy } from '../design/copy';
import { palette } from '../design/palette';
import { MASK, type as typography } from '../theme';
import type { Unit } from '../theme';

/**
 * A rolling amount (REDESIGN.md 5, Odometer). Each digit is a clipped column
 * of "0..9,0" that rolls to the digit's position, keyed by its place value so
 * a digit keeps its column as the amount grows. BTC always shows all eight
 * decimals, with the zeros after the last significant one in dust.
 *
 * The whole odometer is one element to a screen reader; the cells are hidden.
 * Without an `accessibilityLabel` it reads the amount in sats.
 *
 * This version sets the cells still. The roll, the unit swap, the mask
 * scramble and the stale ripple come later and keep this signature, reading
 * `digitPosition` on the UI thread.
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
  sign?: '+' | '-' | null;
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

const VARIANTS: Record<OdometerVariant, TextStyle> = {
  hero: typography.hero,
  amount: typography.amount,
  amountDetail: typography.amountDetail,
  line: typography.line,
  row: typography.row,
};

const SUFFIX: Record<Unit, string> = { sats: 'sats', btc: 'BTC' };

/** Big figures stop growing sooner, so they never outrun the screen. */
const MAX_SCALE: Record<OdometerVariant, number> = {
  hero: 1.2,
  amount: 1.2,
  amountDetail: 1.2,
  line: 1.4,
  row: 1.4,
};

export function Odometer({
  sats,
  unit,
  masked = false,
  stale = false,
  variant,
  color = palette.cream,
  sign = null,
  accessibilityLabel,
}: OdometerProps) {
  const ink = stale ? palette.steam : color;
  const style = [
    VARIANTS[variant],
    { color: ink },
    variant === 'row' && sign === '+' && styles.received,
  ];
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
        <Text style={style} maxFontSizeMultiplier={MAX_SCALE[variant]}>
          {sign === '-' ? '−' : sign}
          {masked
            ? MASK
            : cellsFor(sats, unit).map(cell => (
                <Text
                  key={cell.key}
                  style={cell.kind === 'digit' && cell.dim && styles.dim}
                >
                  {cell.kind === 'digit' ? cell.digit : cell.char}
                </Text>
              ))}
        </Text>
        <Text
          style={[typography.heroUnit, styles.unit]}
          maxFontSizeMultiplier={MAX_SCALE[variant]}
        >
          {SUFFIX[unit]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  received: { fontWeight: '600' },
  dim: { color: palette.dust },
  unit: { color: palette.steam },
});
