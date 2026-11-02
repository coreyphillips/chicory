import type { FeeRates } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import {
  GRAB,
  NEEDLE_DRAWN,
  NEEDLE_FROM,
  NEEDLE_SWEEP,
  RUBBER,
  THUMB,
  TRACK_START,
  clamp01,
  feeAnchors,
  feeSpoken,
  feeZone,
  grabs,
  markPositions,
  marksPassed,
  needleRotate,
  positionAtX,
  positionOf,
  rateAt,
  rubber,
  stepRate,
  thumbCentre,
  travelOf,
} from '../feeTrack';

/**
 * The fee rate slider's maths (REDESIGN.md 6, Send): the track's anchors and
 * the rate at each point of it, the thumb's geometry, a screen reader's
 * steps, and the words for a rate against the engine's estimates.
 */
const RATES: FeeRates = { fast: 20, normal: 12, slow: 8, minimum: 1 };
const FIVE = feeAnchors(RATES, 1, 40);

describe('the anchors', () => {
  test('are the distinct whole rates of the range and the estimates, sorted', () => {
    expect(FIVE).toEqual([1, 8, 12, 20, 40]);
    expect(feeAnchors(RATES, 8, 40)).toEqual([8, 12, 20, 40]);
    expect(feeAnchors({ ...RATES, slow: 12 }, 1, 40)).toEqual([1, 12, 20, 40]);
    expect(feeAnchors({ fast: 12, normal: 12, slow: 12, minimum: 12 }, 1, 40)).toEqual([1, 12, 40]);
  });

  test('keep the estimates inside the range and round them whole', () => {
    expect(feeAnchors({ ...RATES, fast: 500 }, 1, 400)).toEqual([1, 8, 12, 400]);
    expect(feeAnchors({ ...RATES, slow: 0 }, 2, 40)).toEqual([2, 12, 20, 40]);
    expect(feeAnchors({ fast: 20.4, normal: 11.6, slow: 7.5, minimum: 1 }, 1, 40)).toEqual([1, 8, 12, 20, 40]);
  });

  test('are one anchor, and so no track, when the range has no room', () => {
    expect(feeAnchors(RATES, 12, 12)).toEqual([12]);
    expect(feeAnchors(RATES, 12, 5)).toEqual([12]);
  });
});

describe('the position of a rate', () => {
  test('spaces the anchors evenly, with normal at the centre of five', () => {
    expect(FIVE.map(rate => positionOf(rate, FIVE))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test('runs linearly between neighbours', () => {
    expect(positionOf(10, FIVE)).toBeCloseTo(0.375);
    expect(positionOf(30, FIVE)).toBeCloseTo(0.875);
  });

  test('clamps past the ends, and is the start with one anchor or none', () => {
    expect(positionOf(0, FIVE)).toBe(0);
    expect(positionOf(99, FIVE)).toBe(1);
    expect(positionOf(12, [12])).toBe(0);
    expect(positionOf(12, [])).toBe(0);
  });
});

describe('the rate at a position', () => {
  test('is the inverse at every anchor and between them', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map(at => rateAt(at, FIVE))).toEqual(FIVE);
    expect(rateAt(0.375, FIVE)).toBe(10);
    expect(rateAt(0.875, FIVE)).toBe(30);
  });

  test('rounds to a whole rate and clamps past the ends', () => {
    expect(rateAt(0.3, FIVE)).toBe(9);
    expect(rateAt(-1, FIVE)).toBe(1);
    expect(rateAt(2, FIVE)).toBe(40);
    expect(rateAt(0.5, [12])).toBe(12);
    expect(rateAt(0.5, [])).toBe(1);
  });

  test.each([
    [RATES, 1, 40],
    [{ fast: 120, normal: 60, slow: 40, minimum: 5 }, 5, 240],
    [{ fast: 3, normal: 2, slow: 1, minimum: 1 }, 1, 13],
    [{ fast: 2, normal: 2, slow: 2, minimum: 2 }, 2, 12],
  ])('lands on every whole rate of the range %#', (rates, min, max) => {
    const anchors = feeAnchors(rates, min, max);
    for (let rate = min; rate <= max; rate += 1) {
      expect(rateAt(positionOf(rate, anchors), anchors)).toBe(rate);
    }
  });
});

describe('the marks', () => {
  test('sit at slow, normal and fast, merged where they coincide', () => {
    expect(markPositions(RATES, FIVE)).toEqual([0.25, 0.5, 0.75]);
    const merged = feeAnchors({ ...RATES, slow: 12 }, 1, 40);
    expect(markPositions({ ...RATES, slow: 12 }, merged)).toEqual([1 / 3, 2 / 3]);
    const atStart = feeAnchors({ ...RATES, slow: 1 }, 1, 40);
    expect(markPositions({ ...RATES, slow: 1 }, atStart)).toEqual([0, 1 / 3, 2 / 3]);
  });

  test('are counted as the thumb reaches and passes them', () => {
    const marks = [0.25, 0.5, 0.75];
    expect(marksPassed(0, marks)).toBe(0);
    expect(marksPassed(0.25, marks)).toBe(1);
    expect(marksPassed(0.6, marks)).toBe(2);
    expect(marksPassed(1, marks)).toBe(3);
    expect(marksPassed(0, [0])).toBe(1);
  });
});

describe('the thumb', () => {
  const WIDTH = 236;

  test('travels from the track start to the row end, its edges reaching the ends', () => {
    expect(travelOf(WIDTH)).toBe(WIDTH - TRACK_START - THUMB);
    expect(thumbCentre(0, WIDTH)).toBe(TRACK_START + THUMB / 2);
    expect(thumbCentre(1, WIDTH)).toBe(WIDTH - THUMB / 2);
    expect(thumbCentre(0.5, WIDTH)).toBe((TRACK_START + WIDTH) / 2);
  });

  test('is found under a touch, and a touch places it', () => {
    expect(positionAtX(thumbCentre(0, WIDTH), WIDTH)).toBe(0);
    expect(positionAtX(thumbCentre(1, WIDTH), WIDTH)).toBe(1);
    expect(positionAtX(thumbCentre(0.5, WIDTH), WIDTH)).toBeCloseTo(0.5);
    expect(positionAtX(0, WIDTH)).toBe(0);
    expect(positionAtX(9999, WIDTH)).toBe(1);
    const centre = thumbCentre(0.5, WIDTH);
    expect(grabs(centre, 0.5, WIDTH)).toBe(true);
    expect(grabs(centre + GRAB, 0.5, WIDTH)).toBe(true);
    expect(grabs(centre + GRAB + 1, 0.5, WIDTH)).toBe(false);
    expect(grabs(centre - GRAB - 1, 0.5, WIDTH)).toBe(false);
  });

  test('never divides by a width it has not measured', () => {
    expect(travelOf(0)).toBe(1);
    expect(Number.isFinite(positionAtX(10, 0))).toBe(true);
    expect(Number.isFinite(thumbCentre(0.5, 0))).toBe(true);
  });

  test('follows the finger past either end on the rubber band', () => {
    expect(rubber(-0.2)).toBeCloseTo(-0.2 * RUBBER);
    expect(rubber(1.2)).toBeCloseTo(1 + 0.2 * RUBBER);
    expect(rubber(0.4)).toBe(0.4);
    expect(rubber(0)).toBe(0);
    expect(rubber(1)).toBe(1);
  });

  test('turns the needle from low at the slow end, through straight up, to high', () => {
    expect(needleRotate(0)).toBe(NEEDLE_FROM - NEEDLE_DRAWN);
    expect(needleRotate(0.5)).toBe(-NEEDLE_DRAWN);
    expect(needleRotate(1)).toBe(NEEDLE_FROM + NEEDLE_SWEEP - NEEDLE_DRAWN);
    expect(needleRotate(-1)).toBe(needleRotate(0));
    expect(needleRotate(2)).toBe(needleRotate(1));
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(3)).toBe(1);
  });
});

describe("a screen reader's step", () => {
  test('is one sat per virtual byte on a short range', () => {
    expect(stepRate(12, 1, FIVE)).toBe(13);
    expect(stepRate(12, -1, FIVE)).toBe(11);
  });

  test('strides across a wide range, landing on any estimate it would pass', () => {
    const wide = feeAnchors({ fast: 120, normal: 60, slow: 40, minimum: 5 }, 5, 240);
    expect(stepRate(60, 1, wide)).toBe(66);
    expect(stepRate(60, -1, wide)).toBe(54);
    expect(stepRate(58, 1, wide)).toBe(60);
    expect(stepRate(62, -1, wide)).toBe(60);
    expect(stepRate(116, 1, wide)).toBe(120);
  });

  test('stops at the ends, unchanged there', () => {
    expect(stepRate(40, 1, FIVE)).toBe(40);
    expect(stepRate(1, -1, FIVE)).toBe(1);
    expect(stepRate(39, 1, FIVE)).toBe(40);
  });
});

describe('the words', () => {
  test.each([
    [5, 'belowSlow'],
    [8, 'slow'],
    [10, 'betweenSlowAndNormal'],
    [12, 'normal'],
    [15, 'betweenNormalAndFast'],
    [20, 'fast'],
    [30, 'aboveFast'],
  ])('place %i sat/vB in its zone', (rate, zone) => {
    expect(feeZone(rate, RATES)).toBe(zone);
  });

  test('call a rate that is more than one estimate normal, then fast, then slow', () => {
    expect(feeZone(12, { fast: 12, normal: 12, slow: 12, minimum: 1 })).toBe('normal');
    expect(feeZone(12, { fast: 12, normal: 20, slow: 12, minimum: 1 })).toBe('fast');
    expect(feeZone(8, { fast: 20, normal: 12, slow: 8, minimum: 8 })).toBe('slow');
  });

  test('speak the zone, the rate and the fee', () => {
    expect(feeSpoken(12, 1_680, RATES)).toBe('Normal, 12 sats per virtual byte, fee 1,680 sats');
    expect(feeSpoken(1, 140, RATES)).toBe('Below the slow estimate, 1 sat per virtual byte, fee 140 sats');
    expect(copy.send.feeRateAt(1, 140)).toBe('Fee 140 sats at 1 sat per virtual byte.');
    expect(copy.send.feeRateAt(30, 4_200)).toBe('Fee 4,200 sats at 30 sats per virtual byte.');
  });
});
