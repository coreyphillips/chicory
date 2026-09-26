import { SHAKE } from '../../motion/tokens';
import { type as typography } from '../../theme';

/**
 * How big the keyed amount is drawn so its row fits the field it sits in
 * (REDESIGN.md 3.3 and 5, Keypad), as pure functions over what the row
 * holds, so the fit is a table test and the readout only draws.
 *
 * The row is the figures, the unit and any marks after it, and the whole of
 * it must fit, with room for a refusal's shake either side: at 48pt nine
 * figures in radish and the limit's 32pt disc ran past a 354pt field, and
 * the shake cut off more. Like the hero, the amount steps down through a few
 * sizes rather than shrinking to fit, which `adjustsFontSizeToFit` would do
 * figure by figure and frame by frame.
 */

/** The amount's sizes, largest first: it takes the first its row fits. */
export const AMOUNT_SIZES = [48, 40, 32, 26, 20, 16];

/**
 * A tabular figure's advance, and a separator's, as a share of the size.
 * The size is chosen before anything is drawn, so these err a little wide,
 * as the hero's do: the system faces' figures sit just under them.
 */
const FIGURE_EM = 0.6;
const SEPARATOR_EM = 0.3;

/** The unit after the figures, "sats" at heroUnit's 15pt, and its gap. */
const UNIT_WIDTH = 4 * 0.62 * 15;
const UNIT_GAP = 6;

/** How far a refusal's shake carries the row either way. */
export const SHAKE_TRAVEL = Math.max(...SHAKE.map(Math.abs));

/** What one amount's row holds, as far as its width goes. */
export interface ReadoutRow {
  /** Figures drawn: the digits, or one for the 0 that stands in for none. */
  figures: number;
  /** The separators between them. */
  separators: number;
  /** Each mark after the unit, as wide as it is drawn, with its gap. */
  marks: number[];
}

/**
 * How wide `row` is drawn with its figures at `size`, at `scale` times the
 * type size. The figures and the unit grow with the text; the gaps and the
 * marks do not.
 */
export function readoutWidth(
  row: ReadoutRow,
  size: number,
  scale: number,
): number {
  const figures =
    (row.figures * FIGURE_EM + row.separators * SEPARATOR_EM) * size;
  const marks = row.marks.reduce((sum, mark) => sum + mark, 0);
  return scale * (figures + UNIT_WIDTH) + UNIT_GAP + marks;
}

/**
 * The size the figures of `row` are drawn at in a field `room` points wide,
 * at `scale` times the type size: 48, stepping down until the row and a
 * shake either side of it fit, and the smallest when nothing does.
 */
export function amountSize(
  row: ReadoutRow,
  room: number,
  scale: number,
): number {
  const fits = (size: number) =>
    readoutWidth(row, size, scale) <= room - 2 * SHAKE_TRAVEL;
  return AMOUNT_SIZES.find(fits) ?? AMOUNT_SIZES[AMOUNT_SIZES.length - 1];
}

/** The amount's line at `size`, in step with type.amount's 56 on 48. */
export function amountLine(size: number): number {
  const { fontSize = 48, lineHeight = 56 } = typography.amount;
  return Math.round((size * lineHeight) / fontSize);
}
