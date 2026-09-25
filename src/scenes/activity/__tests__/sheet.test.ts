import {
  BAR_HEIGHT,
  CLOSE_AT,
  FLING,
  OPEN_AT,
  RUBBER,
  barFor,
  dragSeam,
  filterFor,
  listShift,
  pastThreshold,
  releaseOpens,
  ROW_RETURN_MS,
  ROW_RETURN_SPAN,
  ROW_RETURN_STEP,
  STAGGERED_ROWS,
  rowBeat,
  rowReturn,
  sheetProgress,
} from '../sheet';
import { BUILD, buildBeats } from '../../../stage/layout';

/**
 * The sheet under the finger (REDESIGN.md 7, T5): where the seam follows a
 * drag, where a release sends it, and what fades on the way.
 */
const at = { compact: 100, home: 500 };

describe('the seam under the finger', () => {
  test('follows the finger between the stops', () => {
    expect(dragSeam(500, -150, at)).toBe(350);
    expect(dragSeam(100, 120, at)).toBe(220);
  });

  test('rubber-bands past either stop', () => {
    expect(dragSeam(500, 100, at)).toBe(500 + 100 * RUBBER);
    expect(dragSeam(100, -60, at)).toBe(100 - 60 * RUBBER);
    // From home straight past compact: only the part beyond it gives.
    expect(dragSeam(500, -500, at)).toBe(100 - 100 * RUBBER);
  });

  test('progress runs from home to compact and holds past them', () => {
    expect(sheetProgress(500, at)).toBe(0);
    expect(sheetProgress(300, at)).toBe(0.5);
    expect(sheetProgress(100, at)).toBe(1);
    expect(sheetProgress(40, at)).toBe(1);
    expect(sheetProgress(640, at)).toBe(0);
  });
});

describe('a release', () => {
  test('from home opens past 40% up, and not before', () => {
    expect(releaseOpens(false, OPEN_AT, 0)).toBe(true);
    expect(releaseOpens(false, OPEN_AT - 0.01, 0)).toBe(false);
  });

  test('from the list closes past 25% down, and not before', () => {
    expect(releaseOpens(true, 1 - CLOSE_AT, 0)).toBe(false);
    expect(releaseOpens(true, 1 - CLOSE_AT + 0.01, 0)).toBe(true);
  });

  test('a flick goes the way it was thrown, wherever it is let go', () => {
    expect(releaseOpens(false, 0.05, -(FLING + 1))).toBe(true);
    expect(releaseOpens(true, 0.95, FLING + 1)).toBe(false);
    // A flick back toward where it began wins over a threshold passed.
    expect(releaseOpens(false, 0.9, FLING + 1)).toBe(false);
    expect(releaseOpens(true, 0.1, -(FLING + 1))).toBe(true);
    // At the fling speed itself, the threshold still decides.
    expect(releaseOpens(false, 0.1, -FLING)).toBe(false);
  });

  test('the threshold a drag crosses depends on where it began', () => {
    expect(pastThreshold(false, 0.39)).toBe(false);
    expect(pastThreshold(false, 0.4)).toBe(true);
    expect(pastThreshold(true, 0.76)).toBe(false);
    expect(pastThreshold(true, 0.75)).toBe(true);
  });
});

describe('what moves with the sheet', () => {
  test('the action row fades over the first 40% of the way up', () => {
    expect(barFor(0)).toBe(1);
    expect(barFor(0.2)).toBeCloseTo(0.5);
    expect(barFor(0.4)).toBe(0);
    expect(barFor(1)).toBe(0);
  });

  test('the filter bar fades in over the last 40%', () => {
    expect(filterFor(0)).toBe(0);
    expect(filterFor(0.6)).toBe(0);
    expect(filterFor(0.8)).toBeCloseTo(0.5);
    expect(filterFor(1)).toBe(1);
  });

  test('the list gives back the bar’s room at home and takes it as it opens', () => {
    expect(listShift(0)).toBe(-BAR_HEIGHT);
    expect(listShift(0.3)).toBe(-BAR_HEIGHT);
    expect(listShift(0.5)).toBeCloseTo(-BAR_HEIGHT / 2);
    expect(listShift(0.7)).toBeCloseTo(0);
    expect(listShift(1)).toBeCloseTo(0);
  });

  test('the rows make room before the bar fades in over them', () => {
    // A day header sits at the top of the list: had the list still been
    // up over the bar's place, the bar's glyphs would fade in over it.
    for (let progress = 0; progress <= 1; progress += 0.01) {
      if (filterFor(progress) > 0) {
        expect(listShift(progress)).toBeGreaterThanOrEqual(-BAR_HEIGHT / 4);
      }
    }
  });
});

describe('the rows coming back in (T1, reversed)', () => {
  test('each starts 25ms after the one above and is in 220ms later', () => {
    expect(ROW_RETURN_STEP).toBe(25);
    for (const index of [0, 1, 5]) {
      const start = index * ROW_RETURN_STEP;
      expect(rowReturn(start, index)).toBe(0);
      expect(rowReturn(start + ROW_RETURN_MS / 2, index)).toBeGreaterThan(0);
      expect(rowReturn(start + ROW_RETURN_MS / 2, index)).toBeLessThan(1);
      expect(rowReturn(start + ROW_RETURN_MS, index)).toBe(1);
    }
    // A row lower down is never ahead of one above it.
    for (let ms = 0; ms <= ROW_RETURN_SPAN; ms += 10) {
      expect(rowReturn(ms, 3)).toBeLessThanOrEqual(rowReturn(ms, 2));
    }
  });

  test('rows below the first screen come in with its last, and all are in by the end', () => {
    const last = STAGGERED_ROWS - 1;
    expect(rowReturn(200, 40)).toBe(rowReturn(200, last));
    expect(rowReturn(ROW_RETURN_SPAN, 40)).toBe(1);
    expect(ROW_RETURN_SPAN).toBe(ROW_RETURN_MS + last * ROW_RETURN_STEP);
  });
});

describe('the rows as the canvas builds in (R-1, R-3)', () => {
  test('wait for their beat, 30ms apart down the list', () => {
    const beats = buildBeats('unlock');
    expect(beats.rowStep).toBe(BUILD.rowStep);
    expect(rowBeat(beats, 0, 0)).toBe(beats.rows);
    expect(rowBeat(beats, 1, 0)).toBe(beats.rows + 30);
    expect(rowBeat(beats, 4, 0)).toBe(beats.rows + 120);
  });

  test('count from when the build began, and never wait less than nothing', () => {
    const beats = buildBeats('load');
    expect(rowBeat(beats, 2, 100)).toBe(beats.rows + 60 - 100);
    expect(rowBeat(beats, 0, beats.done)).toBe(0);
    expect(rowBeat(beats, 40, 0)).toBe(rowBeat(beats, STAGGERED_ROWS - 1, 0));
  });
});
