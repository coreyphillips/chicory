import { satsToBtcString } from '@beignet/wallet-core';
import { cellsFor, digitPosition } from '../src/glyphs/Odometer';
import type { OdometerCell } from '../src/glyphs/Odometer';
import { number } from '../src/theme';

/**
 * The odometer's arithmetic (REDESIGN.md 5, Odometer): where each column has
 * rolled to for a value in flight, and which cells an amount is drawn with.
 */
const text = (cells: OdometerCell[]) =>
  cells
    .map(cell => (cell.kind === 'digit' ? String(cell.digit) : cell.char))
    .join('');

describe('digitPosition', () => {
  test('a settled amount shows its own digit in every column', () => {
    const v = 9_876_543_210;
    for (let k = 0; k < 10; k++) {
      expect(digitPosition(v, k)).toBe(Math.floor(v / 10 ** k) % 10);
    }
  });

  test('the ones column follows the value directly', () => {
    expect(digitPosition(1234, 0)).toBe(4);
    expect(digitPosition(1234.25, 0)).toBeCloseTo(4.25);
    expect(digitPosition(1239.5, 0)).toBeCloseTo(9.5);
  });

  test('a higher column holds still until the places below it are in their last tenth', () => {
    expect(digitPosition(1230, 1)).toBe(3);
    expect(digitPosition(1238.9, 1)).toBe(3);
    expect(digitPosition(1239, 1)).toBe(3);
    // Halfway through the last tenth, smoothstep is halfway too.
    expect(digitPosition(1239.5, 1)).toBeCloseTo(3.5);
    expect(digitPosition(1240, 1)).toBe(4);
  });

  test('a carry eases in and out rather than stepping', () => {
    const early = digitPosition(1239.1, 1) - 3;
    const late = digitPosition(1239.9, 1) - 3;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.1);
    expect(late).toBeGreaterThan(0.9);
    expect(late).toBeLessThan(1);
  });

  test('the hundreds carry over the last ten sats before they change', () => {
    expect(digitPosition(1289.9, 2)).toBe(2);
    expect(digitPosition(1295, 2)).toBeCloseTo(2.5);
    expect(digitPosition(1300, 2)).toBe(3);
  });

  test('a nine rolls on to the trailing zero, then wraps to the top', () => {
    expect(digitPosition(99.95, 1)).toBeGreaterThan(9.9);
    expect(digitPosition(99.95, 1)).toBeLessThan(10);
    expect(digitPosition(100, 1)).toBe(0);
  });

  test('no column ever runs backwards while the value rises', () => {
    for (const k of [0, 1, 2]) {
      let last = digitPosition(0, k);
      for (let v = 0.05; v < 1000; v += 0.05) {
        const pos = digitPosition(v, k);
        // A wrap from the trailing zero back to the top is the one drop.
        if (pos < last) expect(last - pos).toBeGreaterThan(9);
        last = pos;
      }
    }
  });
});

describe('cellsFor', () => {
  test('sats group in threes and read as the formatter writes them', () => {
    for (const sats of [0, 7, 999, 1000, 21_000, 1_234_567, 2_100_000_000]) {
      expect(text(cellsFor(sats, 'sats'))).toBe(number(sats));
    }
  });

  test('BTC always shows eight decimals', () => {
    for (const sats of [0, 1, 120_000, 123_456, 250_000_000, 2_100_000_000]) {
      const [whole, fraction = ''] = satsToBtcString(sats).split('.');
      expect(text(cellsFor(sats, 'btc'))).toBe(
        `${whole}.${fraction.padEnd(8, '0')}`,
      );
    }
  });

  test('trailing zeros of a BTC amount are dimmed, and nothing else is', () => {
    const dimmed = (sats: number) =>
      cellsFor(sats, 'btc')
        .filter(cell => cell.kind === 'digit' && cell.dim)
        .map(cell => cell.key);
    expect(dimmed(123_456)).toEqual([]);
    expect(dimmed(120_000)).toEqual(['d3', 'd2', 'd1', 'd0']);
    expect(dimmed(250_000_000)).toEqual([
      'd6',
      'd5',
      'd4',
      'd3',
      'd2',
      'd1',
      'd0',
    ]);
    // No amount at all: every decimal, but never the whole part.
    expect(dimmed(0)).toEqual(['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1', 'd0']);
    expect(
      cellsFor(0, 'sats').some(cell => cell.kind === 'digit' && cell.dim),
    ).toBe(false);
  });

  test('cells are keyed by place value, the same in either unit', () => {
    const sats = cellsFor(123_456, 'sats');
    const btc = cellsFor(123_456, 'btc');
    const keys = (cells: OdometerCell[]) => cells.map(cell => cell.key);
    for (const cells of [sats, btc]) {
      expect(new Set(keys(cells)).size).toBe(cells.length);
    }
    const byPlace = (cells: OdometerCell[]) =>
      Object.fromEntries(
        cells.flatMap(cell =>
          cell.kind === 'digit' ? [[cell.place, [cell.key, cell.digit]]] : [],
        ),
      );
    const inSats = byPlace(sats);
    const inBtc = byPlace(btc);
    for (const place of Object.keys(inSats)) {
      expect(inBtc[place]).toEqual(inSats[place]);
    }
  });

  test('a negative amount draws its magnitude; the sign is the caller’s', () => {
    expect(text(cellsFor(-4200, 'sats'))).toBe('4,200');
  });
});
