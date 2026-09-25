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
  sheetProgress,
} from '../sheet';

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
    expect(listShift(0.8)).toBeCloseTo(-BAR_HEIGHT / 2);
    expect(listShift(1)).toBeCloseTo(0);
  });
});
