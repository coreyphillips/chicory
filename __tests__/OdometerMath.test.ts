import { satsToBtcString } from '@beignet/wallet-core';
import {
  cellOpen,
  cellsFor,
  digitPosition,
  floorPlace,
  leadingZero,
  openWidth,
  placeInk,
  rollCells,
  rollDuration,
  rollPosition,
  rowInView,
  rowInk,
  startRoll,
} from '../src/glyphs/Odometer';
import type { OdometerCell, Roll } from '../src/glyphs/Odometer';
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

  test('a higher place turns only while the ones roll from 9 to 0', () => {
    // The hundreds hold through the tens' last tenth, which is not a carry.
    expect(digitPosition(1289.9, 2)).toBe(2);
    expect(digitPosition(1295, 2)).toBe(2);
    expect(digitPosition(1299, 2)).toBe(2);
    // Halfway through the last sat, the tens and the hundreds are halfway
    // over together, as the ones are.
    expect(digitPosition(1299.5, 1)).toBeCloseTo(9.5);
    expect(digitPosition(1299.5, 2)).toBeCloseTo(2.5);
    expect(digitPosition(1300, 2)).toBe(3);
    // The ten-thousands wait for 59,999, not for 59,000.
    expect(digitPosition(59_000, 4)).toBe(5);
    expect(digitPosition(59_877, 4)).toBe(5);
    expect(digitPosition(59_999, 4)).toBe(5);
    expect(digitPosition(59_999.5, 4)).toBeCloseTo(5.5);
  });

  /**
   * What the columns read at `v`: each shows the digit nearest where it has
   * rolled to, the one that fills most of its cell.
   */
  const reading = (v: number, places: number) => {
    let read = 0;
    for (let k = 0; k < places; k++) {
      read += (Math.round(digitPosition(v, k)) % 10) * 10 ** k;
    }
    return read;
  };

  test('a figure mid-roll never reads more than the amount has reached', () => {
    // A 5,000 sat receipt counting up, and a balance rolling past 60,000.
    expect(reading(4_987, 5)).toBe(4_987);
    expect(reading(59_877, 6)).toBe(59_877);
    for (const [from, to] of [
      [0, 5_000],
      [54_230, 60_054],
      [99_950, 100_020],
    ]) {
      for (let v = from; v <= to; v += 0.37) {
        const read = reading(v, 7);
        // Past the halfway of a sat it reads the next one up, and no more.
        expect(read).toBeGreaterThanOrEqual(Math.floor(v));
        expect(read).toBeLessThanOrEqual(Math.ceil(v));
      }
    }
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

describe('a figure mid-roll', () => {
  /**
   * What a frame of a roll draws at `v`, cell by cell, as the cells draw
   * it: each digit's cell the row that fills most of it, a separator when
   * the place before it shows, and a leading place only once it holds a
   * digit. `faults` lists what no frame may draw: two figures in one cell,
   * a figure in a cell too fast to slide that is not whole, and a leading
   * place's cell open with nothing in it.
   */
  const frame = (v: number, roll: Roll, cells: OdometerCell[], floor = 0) => {
    let drawn = '';
    const faults: string[] = [];
    for (const cell of cells) {
      const pos = rollPosition(v, cell.place, roll);
      const ink = placeInk(v, cell.place, floor, pos);
      if (ink === 0 && cellOpen(ink) !== 0) faults.push(`${cell.key} open`);
      if (cell.kind === 'mark') {
        if (ink >= 0.5) drawn += cell.char;
        continue;
      }
      const rows = [0, 1].map(parity => rowInView(pos, parity));
      const inks = rows.map(row => rowInk(row, pos, v, cell.place, floor));
      // The two rows in view share the cell: together never more than one
      // figure, and a column too fast to slide shows one row alone.
      if (inks[0] + inks[1] > 1 + 1e-9) faults.push(`${cell.key} doubled`);
      if (cell.place < (roll.snap ?? 0) && Math.min(...inks) > 0) {
        faults.push(`${cell.key} half`);
      }
      const best =
        inks[0] === inks[1]
          ? Math.max(...rows)
          : rows[inks[0] > inks[1] ? 0 : 1];
      if (ink >= 0.5) drawn += String(best % 10);
    }
    return { text: drawn, faults };
  };
  /** The amounts a frame may read at `v`: the one reached, or the next up. */
  const allowed = (v: number) =>
    [Math.floor(v), Math.ceil(v)].map(sats => text(cellsFor(sats, 'sats')));
  /** A well formed amount: no leading zero, no separator but between groups. */
  const WELL_FORMED = /^(0|[1-9]\d{0,2}(,\d{3})*)$/;
  /**
   * Frames all the way through a count from `from` to `to`, a little over
   * a third of a sat apart, or a 4,000th of the way where that is more, and
   * each carry into a new place caught in twentieths, where a frame can land
   * mid-roll.
   */
  const count = (
    from: number,
    to: number,
    duration = rollDuration(to - from),
  ) => {
    const roll = startRoll(from, to, null, duration);
    const cells = rollCells(from, to, 'sats');
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const at = new Set<number>([from, to]);
    const step = Math.max(0.37, (high - low) / 4_000);
    for (let v = low; v <= high; v += step) at.add(v);
    for (let u = 10; u <= high; u *= 10) {
      for (let t = 0; t <= 20; t++) {
        const v = u - 1 + t / 20;
        if (v >= low && v <= high) at.add(v);
      }
    }
    const read: string[] = [];
    const wrong: string[] = [];
    for (const v of [...at].sort((a, b) => (to > from ? a - b : b - a))) {
      const { text: shown, faults } = frame(v, roll, cells);
      if (!WELL_FORMED.test(shown) || !allowed(v).includes(shown)) {
        wrong.push(`${v}: ${shown}`);
      }
      wrong.push(...faults.map(fault => `${v}: ${fault}`));
      read.push(shown);
    }
    expect(wrong).toEqual([]);
    return read;
  };

  test('0 to 65,446 grows its places as it reaches them, never 065,446', () => {
    // The device pass (P12): the cold launch's hero read "065,446",
    // "009,98" and "019,605" on its way.
    const read = count(0, 65_446);
    expect(read[0]).toBe('0');
    expect(read[read.length - 1]).toBe('65,446');
    expect(read).toContain('9');
    expect(read.some(shown => /^\d{2},\d{3}$/.test(shown))).toBe(true);
  });

  test('0 to 888 has no leading zero at any frame', () => {
    // Receive's celebration read "+0,888" counting a receipt up.
    for (const duration of [rollDuration(888), 700]) {
      const read = count(0, 888, duration);
      expect(read[read.length - 1]).toBe('888');
      expect(read.every(shown => !shown.startsWith('0') || shown === '0')).toBe(
        true,
      );
    }
    // Nor counting 5,000 up in the celebration's 700ms.
    count(0, 5_000, 700);
  });

  test('9,999 to 10,000 rolls its new place up from blank', () => {
    const roll = startRoll(9_999, 10_000, null, rollDuration(1));
    const cells = rollCells(9_999, 10_000, 'sats');
    expect(count(9_999, 10_000)).toEqual(
      expect.arrayContaining(['9,999', '10,000']),
    );
    // The ten-thousands never show a 0: at the start the place is shut,
    // then its 1 rolls in over nothing as the nines roll over.
    let last = -1;
    for (let v = 9_999; v <= 10_000; v += 0.01) {
      const pos = rollPosition(v, 4, roll);
      expect(rowInk(0, pos, v, 4, 0)).toBe(0);
      const ink = placeInk(v, 4, 0, pos);
      expect(ink).toBeGreaterThanOrEqual(last - 1e-9);
      last = ink;
    }
    expect(placeInk(9_999, 4, 0, rollPosition(9_999, 4, roll))).toBe(0);
    expect(placeInk(10_000, 4, 0, rollPosition(10_000, 4, roll))).toBe(1);
    // And back down, the 1 rolls away to blank before the cell leaves.
    const back = startRoll(10_000, 9_999, null, rollDuration(1));
    expect(placeInk(9_999, 4, 0, rollPosition(9_999, 4, back))).toBe(0);
    expect(frame(9_999, back, cells).text).toBe('9,999');
  });

  test('a leading place is shut while blank and open once half its digit shows', () => {
    expect(leadingZero(999, 3, 0)).toBe(true);
    expect(leadingZero(1_000, 3, 0)).toBe(false);
    // The ones are always drawn, and in BTC every place to the whole coin.
    expect(leadingZero(0, 0, floorPlace('sats'))).toBe(false);
    expect(leadingZero(0, 8, floorPlace('btc'))).toBe(false);
    expect(leadingZero(0, 9, floorPlace('btc'))).toBe(true);
    expect(cellOpen(0)).toBe(0);
    expect(cellOpen(0.5)).toBe(1);
    expect(cellOpen(1)).toBe(1);
    expect(cellOpen(0.25)).toBeCloseTo(0.5);
    // A cell takes its own width open, none shut, and a share of a figure's
    // between, once a figure has been measured.
    expect(openWidth(1, 30)).toBe('auto');
    expect(openWidth(0, 30)).toBe(0);
    expect(openWidth(0.5, 30)).toBe(15);
    expect(openWidth(0.5, 0)).toBe('auto');
  });

  test('a BTC count keeps its decimals and grows only its whole part', () => {
    const roll = startRoll(0, 1_234_567_890, null, 1_100);
    const cells = rollCells(0, 1_234_567_890, 'btc');
    const floor = floorPlace('btc');
    expect(frame(0, roll, cells, floor).text).toBe('0.00000000');
    expect(frame(1_234_567_890, roll, cells, floor).text).toBe('12.34567890');
  });
});
