import {
  AMOUNT_SIZES,
  SHAKE_TRAVEL,
  amountLine,
  amountSize,
  readoutWidth,
} from '../fit';
import { STATE_PIP } from '../AmountReadout';
import { amountCells } from '../keys';

/**
 * How big a keyed amount is drawn so its row fits its field (REDESIGN.md
 * 3.3 and 5, Keypad): the figures step down, and the unit, the marks and a
 * refusal's shake are counted in.
 */

/** The row `digits` make, with a mark after the unit for each of `marks`. */
const rowOf = (digits: string, marks: number[] = []) => {
  const cells = amountCells(digits);
  return {
    figures: Math.max(1, cells.length),
    separators: cells.filter(cell => cell.text.endsWith(',')).length,
    marks,
  };
};

/** A limit's disc after the unit, with its gap. */
const PIP = 8 + STATE_PIP;
/** The field on a 402pt phone, inside the 24pt page edges (P12, 09c). */
const FIELD = 354;

test('an amount that fits its field is drawn at the full 48', () => {
  expect(amountSize(rowOf('4200'), FIELD, 1)).toBe(48);
  // Nine figures in cream, with no mark, still fit (P12: 42 to 360pt).
  expect(amountSize(rowOf('999999999'), FIELD, 1)).toBe(48);
});

test('nine figures refused, with their disc, step down until row and shake fit', () => {
  // At 48 they ran past the field: the first 9 and half the disc were cut
  // off, and more as it shook (P12, 09d).
  const refused = rowOf('999999999', [PIP]);
  expect(readoutWidth(refused, 48, 1)).toBeGreaterThan(
    FIELD - 2 * SHAKE_TRAVEL,
  );
  const size = amountSize(refused, FIELD, 1);
  expect(size).toBeLessThan(48);
  expect(readoutWidth(refused, size, 1)).toBeLessThanOrEqual(
    FIELD - 2 * SHAKE_TRAVEL,
  );
  // One step at a time: the size above it does not fit.
  const above = AMOUNT_SIZES[AMOUNT_SIZES.indexOf(size) - 1];
  expect(readoutWidth(refused, above, 1)).toBeGreaterThan(
    FIELD - 2 * SHAKE_TRAVEL,
  );
});

test('the longest amount there can be fits a small phone, its disc, unit and larger text included', () => {
  const most = rowOf('9'.repeat(16), [PIP]);
  for (const [field, scale] of [
    [FIELD, 1],
    [375 - 48, 1],
    [375 - 48, 1.2],
  ]) {
    const size = amountSize(most, field, scale);
    expect(AMOUNT_SIZES).toContain(size);
    expect(readoutWidth(most, size, scale)).toBeLessThanOrEqual(
      field - 2 * SHAKE_TRAVEL,
    );
  }
});

test('the figures and the unit grow with the text, the gaps and marks do not', () => {
  const row = rowOf('4200', [PIP]);
  const grown = readoutWidth(row, 48, 1.2) - readoutWidth(row, 48, 1);
  const unmarked = rowOf('4200');
  expect(grown).toBeCloseTo(
    readoutWidth(unmarked, 48, 1.2) - readoutWidth(unmarked, 48, 1),
  );
  // So larger text steps a long amount down sooner.
  const long = rowOf('99999999', [PIP]);
  expect(amountSize(long, FIELD, 1.2)).toBeLessThan(amountSize(long, FIELD, 1));
});

test('each size keeps the amount line in step, 56 on 48', () => {
  expect(amountLine(48)).toBe(56);
  for (const size of AMOUNT_SIZES) {
    expect(amountLine(size) / size).toBeCloseTo(56 / 48, 1);
  }
});
