import { GLYPHS } from '../src/design/glyphs';
import { alpha, mixHex, palette } from '../src/design/palette';
import { fract, wave } from '../src/motion/loops';
import { kickVelocity, springStep } from '../src/motion/springMath';
import { springs } from '../src/motion/tokens';
import type { RingVisual } from '../src/scenes/activity/visual';
import {
  PETALS,
  breathe,
  burstPose,
  chaseOpacity,
  fallPose,
  haloOpacity,
  petalDelay,
  petalState,
  ratchetAngle,
  wiltPose,
} from '../src/glyphs/Bloom';
import {
  digitPosition,
  heroSize,
  nextPhase,
  stepsSize,
  rollCells,
  rollDuration,
  rollPosition,
  scrambleDigit,
  staleDip,
  startRoll,
} from '../src/glyphs/Odometer';
import { pingPose, pulseScale } from '../src/glyphs/PulseDot';
import {
  badgeAt,
  drawPlan,
  filled,
  ringEntrance,
  ringGeometry,
} from '../src/glyphs/StatusRing';
import {
  glyphLoop,
  glyphPose,
  ripplePose,
  seedBob,
  seedSpots,
  segmentWidths,
  sheenX,
} from '../src/glyphs/Vessel';
import { pillPlace } from '../src/glyphs/Whisper';

/**
 * The glyphs' motion as arithmetic (REDESIGN.md 5). Under Jest an animation
 * lands on its end at once, so the poses in between are proved here, as the
 * pure functions the UI thread runs every frame.
 */

/** A spring's value `seconds` after a kick of `velocity`, stepped finely. */
function simulate(
  velocity: number,
  { damping, stiffness, mass }: typeof springs.snap,
  seconds: number,
) {
  let x = 0;
  let v = velocity;
  let peak = 0;
  const dt = 1 / 20000;
  for (let t = 0; t < seconds; t += dt) {
    v += ((-stiffness * x - damping * v) / mass) * dt;
    x += v * dt;
    peak = Math.max(peak, x);
  }
  return { x, peak };
}

describe('loops', () => {
  test('a wave goes out and back, and rests on every whole number', () => {
    expect(wave(0)).toBe(0);
    expect(wave(3)).toBeCloseTo(0);
    expect(wave(0.5)).toBeCloseTo(1);
    expect(wave(0.25)).toBeCloseTo(0.5);
    for (const t of [0.1, 0.2, 0.4]) expect(wave(t)).toBeCloseTo(wave(1 - t));
  });

  test('a clock is at rest on every whole number', () => {
    expect(fract(3)).toBe(0);
    expect(fract(3.25)).toBeCloseTo(0.25);
    expect(breathe(0)).toEqual({ scale: 1, rotate: 0 });
    expect(breathe(7)).toEqual({ scale: 1, rotate: 0 });
    expect(haloOpacity(0)).toBe(1);
    expect(haloOpacity(4)).toBe(1);
    expect(pulseScale(2)).toBe(1);
  });

  test('a breath swells to 1.035 and turns 1.5 degrees halfway through', () => {
    const peak = breathe(0.5);
    expect(peak.scale).toBeCloseTo(1.035);
    expect(peak.rotate).toBeCloseTo(1.5);
  });

  test('the halo pulses between 1 and .5', () => {
    expect(haloOpacity(0.5)).toBeCloseTo(0.5);
  });

  test('reconnecting pulses between 1 and 1.3', () => {
    expect(pulseScale(0.5)).toBeCloseTo(1.3);
  });
});

describe('springs', () => {
  test('a step starts at 0 and settles at 1', () => {
    for (const config of Object.values(springs)) {
      expect(springStep(0, config)).toBe(0);
      expect(springStep(3, config)).toBeCloseTo(1, 3);
    }
  });

  test('the snap spring overshoots a little and lands within a ratchet step', () => {
    let peak = 0;
    for (let t = 0; t < 0.6; t += 0.005) {
      peak = Math.max(peak, springStep(t, springs.snap));
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.1);
    expect(springStep(0.6, springs.snap)).toBeCloseTo(1, 2);
  });

  test('a kick throws a spring out to the peak it was asked for', () => {
    for (const [peak, config] of [
      [0.3, springs.boing],
      [0.08, springs.reveal],
    ] as const) {
      const result = simulate(kickVelocity(peak, config), config, 1.5);
      expect(result.peak).toBeCloseTo(peak, 2);
      expect(Math.abs(result.x)).toBeLessThan(0.01);
    }
  });
});

describe('Bloom', () => {
  test('a petal follows REDESIGN.md 5 from bud to flower', () => {
    expect(petalState(0, 0)).toEqual({
      scaleX: 0.18,
      scaleY: 0.25,
      rotate: -1.5 - 14,
      opacity: 0.25,
    });
    expect(petalState(1, 1)).toEqual({
      scaleX: 1,
      scaleY: 0.96,
      rotate: 32,
      opacity: 1,
    });
    const half = petalState(0.5, 4);
    expect(half.scaleX).toBeCloseTo(0.59);
    expect(half.scaleY).toBeCloseTo(0.625);
    expect(half.rotate).toBeCloseTo(120 - 7);
    expect(half.opacity).toBeCloseTo(0.625);
  });

  test('each petal keeps its own angle and length', () => {
    const angles = Array.from(
      { length: PETALS },
      (_, i) => petalState(1, i).rotate,
    );
    expect(angles).toEqual([
      -1.5, 32, 60, 90.5, 120, 152, 178.5, 212, 240, 270.5, 300, 332,
    ]);
    const lengths = Array.from(
      { length: PETALS },
      (_, i) => petalState(1, i).scaleY,
    );
    expect(lengths).toEqual([
      1, 0.96, 0.99, 0.94, 1, 0.97, 0.95, 1, 0.98, 0.95, 0.99, 0.96,
    ]);
  });

  test('a burst pushes a petal past open, but never past full opacity', () => {
    const swollen = petalState(1 + burstPose(0.5).swell, 0);
    expect(swollen.scaleX).toBeCloseTo(0.18 + 0.82 * 1.12);
    expect(swollen.opacity).toBe(1);
  });

  test('the chase lights the head and fades over the four petals behind it', () => {
    expect(chaseOpacity(3, 3)).toBe(1);
    expect(chaseOpacity(4, 3)).toBeCloseTo(0.35 + 0.65 * 0.75);
    expect(chaseOpacity(7, 3)).toBeCloseTo(0.35);
    expect(chaseOpacity(2, 3)).toBeCloseTo(0.35);
    // Past twelve it wraps to the first petal again.
    expect(chaseOpacity(12, 0)).toBe(1);
    expect(chaseOpacity(1, 11)).toBeCloseTo(0.35 + 0.65 * 0.5);
  });

  test('an unfold reaches each petal as it passes i/12', () => {
    const opening = Array.from({ length: PETALS }, (_, i) =>
      petalDelay(i, 0, 1),
    );
    expect(opening[0]).toBe(0);
    expect(opening[6]).toBe(210);
    expect(opening).toEqual([...opening].sort((a, b) => a - b));
    // Closing starts from the last petal.
    expect(petalDelay(11, 1, 0)).toBe(0);
    expect(petalDelay(0, 1, 0)).toBe(opening[11]);
    // A small change hardly staggers.
    expect(petalDelay(11, 0.5, 0.6)).toBeLessThan(40);
  });

  test('the ratchet turns 30 degrees a step and holds between steps', () => {
    expect(ratchetAngle(0)).toBe(0);
    expect(ratchetAngle(1)).toBe(30);
    expect(ratchetAngle(4)).toBe(120);
    // The snap lands well before the next step.
    expect(ratchetAngle(1.9)).toBeCloseTo(60, 0);
    expect(ratchetAngle(1.05)).toBeGreaterThan(30);
    expect(ratchetAngle(1.05)).toBeLessThan(60);
  });

  test('a wilt droops 10 degrees and shortens to .92', () => {
    expect(wiltPose(0)).toEqual({ turn: 0, length: 1 });
    expect(wiltPose(1)).toEqual({ turn: 10, length: 0.92 });
  });

  test('a fall drops 48pt, turns either way and fades; reduced, it only fades', () => {
    expect(fallPose(1, 0, false)).toEqual({ drop: 48, turn: -25, opacity: 0 });
    expect(fallPose(1, 1, false)).toEqual({ drop: 48, turn: 25, opacity: 0 });
    expect(fallPose(1, 1, true)).toEqual({ drop: 0, turn: 0, opacity: 0 });
    expect(fallPose(0, 1, false)).toEqual({ drop: 0, turn: 0, opacity: 1 });
  });

  test('a burst clone grows to 1.6 and is gone by the end', () => {
    expect(burstPose(0).swell).toBe(0);
    expect(burstPose(1)).toEqual({
      swell: 0,
      cloneScale: 1.6,
      cloneOpacity: 0,
    });
    expect(burstPose(0.5).swell).toBeCloseTo(0.12);
  });

  test('reduced, a burst only brightens the flower where it stands', () => {
    for (const e of [0, 0.5, 1]) {
      expect(burstPose(e, true)).toMatchObject({ swell: 0, cloneScale: 1 });
    }
    expect(burstPose(0, true).cloneOpacity).toBeGreaterThan(0);
    expect(burstPose(1, true).cloneOpacity).toBe(0);
  });
});

describe('Odometer', () => {
  test('a roll is longer for a bigger change, within 280 and 1100ms', () => {
    expect(rollDuration(0)).toBe(280);
    expect(rollDuration(9)).toBe(420);
    expect(rollDuration(-9)).toBe(420);
    expect(rollDuration(99_999)).toBeCloseTo(980);
    expect(rollDuration(2_100_000_000_000_000)).toBe(1100);
  });

  describe('rollPosition', () => {
    const digit = (v: number, k: number) => Math.floor(v / 10 ** k) % 10;
    /** The shortest distance between two places on a column of ten. */
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % 10;
      return Math.min(d, 10 - d);
    };
    const PAIRS: Array<[number, number]> = [
      [1_295, 1_450],
      [4_995, 5_210],
      [99_950, 100_020],
      [100_020, 99_950],
      [999, 1_000],
    ];

    test('a roll sets out from the digits showing and lands on the amount', () => {
      // digitPosition alone has 1,295's hundreds already halfway to 3.
      expect(digitPosition(1_295, 2)).toBeCloseTo(2.5);
      for (const [from, to] of PAIRS) {
        const roll = startRoll(from, to, null);
        for (let k = 0; k < 7; k++) {
          expect(
            apart(rollPosition(from, k, roll), digit(from, k)),
          ).toBeCloseTo(0);
          expect(apart(rollPosition(to, k, roll), digit(to, k))).toBeCloseTo(0);
        }
      }
    });

    test('every column moves smoothly all the way', () => {
      const steps = 5_000;
      for (const [from, to] of PAIRS) {
        const roll = startRoll(from, to, null);
        for (let k = 0; k < 6; k++) {
          let last = rollPosition(from, k, roll);
          let jump = 0;
          let low = last;
          let high = last;
          for (let i = 1; i <= steps; i++) {
            const at = rollPosition(from + ((to - from) * i) / steps, k, roll);
            jump = Math.max(jump, apart(at, last));
            low = Math.min(low, at);
            high = Math.max(high, at);
            last = at;
          }
          expect(jump).toBeLessThan(0.1);
          expect(low).toBeGreaterThanOrEqual(0);
          expect(high).toBeLessThan(10);
        }
      }
    });

    test('a roll that takes over from another picks up where it was', () => {
      const first = startRoll(1_295, 1_450, null);
      const second = startRoll(1_372.5, 1_200, first);
      for (let k = 0; k < 5; k++) {
        expect(
          apart(
            rollPosition(1_372.5, k, second),
            rollPosition(1_372.5, k, first),
          ),
        ).toBeCloseTo(0);
        expect(
          apart(rollPosition(1_200, k, second), digit(1_200, k)),
        ).toBeCloseTo(0);
      }
    });
  });

  test('the hero steps down from 64 until the amount fits', () => {
    // 261,500 sats fits a phone at 64; 12,345,678 sats needs 56.
    expect(heroSize(6, 1, 'sats', 342, 1)).toBe(64);
    expect(heroSize(8, 2, 'sats', 342, 1)).toBe(56);
    // Nothing fits the whole supply in BTC, so it holds at 40.
    expect(heroSize(16, 1, 'BTC', 342, 1)).toBe(40);
    // Larger type steps down sooner.
    expect(heroSize(6, 1, 'sats', 300, 1)).toBe(64);
    expect(heroSize(6, 1, 'sats', 300, 1.2)).toBe(48);
  });

  test('the figures crossfade on a step in size, not on a new unit or a first measure', () => {
    const at = (size: number, unit: 'sats' | 'btc' = 'sats', measured = true) =>
      ({ unit, size, measured } as const);
    expect(stepsSize(at(64), at(56))).toBe(true);
    expect(stepsSize(at(56), at(56))).toBe(false);
    // A new unit brings its own cells in at the new size.
    expect(stepsSize(at(64), at(56, 'btc'))).toBe(false);
    // The first measure replaces the window's guess without a fade.
    expect(stepsSize(at(64, 'sats', false), at(48))).toBe(false);
  });

  test('a roll draws the leading columns of either end', () => {
    const keys = (from: number, to: number) =>
      rollCells(from, to, 'sats').map(cell => cell.key);
    expect(keys(999, 1000)).toEqual(['d3', 'm3', 'd2', 'd1', 'd0']);
    expect(keys(1000, 999)).toEqual(['d3', 'm3', 'd2', 'd1', 'd0']);
    expect(keys(120, 450)).toEqual(['d2', 'd1', 'd0']);
    // The target's digits and dims hold where both ends have a column.
    const cells = rollCells(10_000, 120_000, 'btc');
    const d3 = cells.find(cell => cell.key === 'd3');
    expect(d3).toMatchObject({ digit: 0, dim: true });
  });

  test('a scramble jumps four times, never onto the real digit', () => {
    for (let place = 0; place < 10; place++) {
      for (let digit = 0; digit < 10; digit++) {
        // Hiding: the real digit, then four jumps.
        expect(scrambleDigit(digit, place, 0, false)).toBe(digit);
        // Showing: four jumps, then the real digit.
        expect(scrambleDigit(digit, place, 4, true)).toBe(digit);
        for (let jump = 1; jump < 4; jump++) {
          expect(scrambleDigit(digit, place, jump, false)).not.toBe(digit);
          expect(scrambleDigit(digit, place, jump - 1, true)).not.toBe(digit);
        }
      }
    }
    // Neighbouring columns land on different digits.
    expect(scrambleDigit(5, 0, 1, false)).not.toBe(
      scrambleDigit(5, 1, 1, false),
    );
  });

  test('the stale shimmer dips each cell to .65 in turn, 60ms apart', () => {
    expect(staleDip(0, 0)).toBe(1);
    expect(staleDip(210, 0)).toBeCloseTo(0.65);
    expect(staleDip(270, 1)).toBeCloseTo(0.65);
    expect(staleDip(210, 1)).toBeGreaterThan(0.65);
    expect(staleDip(420, 0)).toBe(1);
    expect(staleDip(2599, 3)).toBe(1);
  });

  test('ink turns steam by blending the channels', () => {
    expect(mixHex(palette.cream, palette.steam, 0)).toBe(palette.cream);
    expect(mixHex(palette.cream, palette.steam, 1)).toBe(palette.steam);
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    // A colour it cannot read switches halfway instead.
    expect(mixHex('red', palette.steam, 0.4)).toBe('red');
    expect(mixHex('red', palette.steam, 0.6)).toBe(palette.steam);
  });

  describe('nextPhase', () => {
    const at = (sats: number, over: object = {}) => ({
      sats,
      unit: 'sats' as const,
      masked: false,
      ...over,
    });

    test('a new amount rolls', () => {
      expect(nextPhase(at(1), at(2), 'rest', false)).toBe('roll');
      expect(nextPhase(at(1), at(2), 'roll', false)).toBe('roll');
    });

    test('a new unit swaps the cells instead', () => {
      expect(nextPhase(at(1), at(2, { unit: 'btc' }), 'roll', false)).toBe(
        'rest',
      );
    });

    test('hiding scrambles, and showing scrambles back', () => {
      expect(nextPhase(at(1), at(1, { masked: true }), 'rest', false)).toBe(
        'scramble',
      );
      expect(nextPhase(at(1, { masked: true }), at(1), 'rest', false)).toBe(
        'unscramble',
      );
    });

    test('nothing moves under the mask', () => {
      const hidden = { masked: true };
      expect(nextPhase(at(1, hidden), at(2, hidden), 'rest', false)).toBe(
        'rest',
      );
      expect(nextPhase(at(1, hidden), at(2, hidden), 'scramble', false)).toBe(
        'scramble',
      );
    });

    test('Reduce Motion never rolls or scrambles', () => {
      expect(nextPhase(at(1), at(2), 'rest', true)).toBe('rest');
      expect(nextPhase(at(1), at(1, { masked: true }), 'rest', true)).toBe(
        'rest',
      );
    });
  });
});

describe('Vessel', () => {
  test('the seam splits the pill by what can be spent now', () => {
    expect(segmentWidths(0.75, 200)).toEqual({ solid: 150, arriving: 50 });
    expect(segmentWidths(1, 200)).toEqual({ solid: 200, arriving: 0 });
    expect(segmentWidths(-1, 200)).toEqual({ solid: 0, arriving: 200 });
    expect(segmentWidths(2, 200)).toEqual({ solid: 200, arriving: 0 });
  });

  test('the sheen crosses the glass, from behind the seam to past the end', () => {
    expect(sheenX(0, 0, 300, false)).toBe(-48);
    expect(sheenX(1, 0, 300, false)).toBe(300);
    expect(sheenX(0, 100, 300, false)).toBe(52);
    expect(sheenX(1, 100, 300, false)).toBe(300);
    expect(sheenX(0, 100, 300, true)).toBe(300);
    expect(sheenX(1, 100, 300, true)).toBe(52);
  });

  test('the glyphs over the pill move as REDESIGN.md 4 has them', () => {
    // The minute hand turns once a cycle and rests upright on each whole one.
    expect(glyphPose('clock', 3)).toEqual({ rotate: 0, scale: 1 });
    expect(glyphPose('clock', 2.25).rotate).toBeCloseTo(90);
    // The gauge's needle rests as drawn, dips back 30 degrees halfway round
    // its loop, and sweeps up again.
    expect(glyphPose('gauge', 3).rotate).toBeCloseTo(0);
    expect(glyphPose('gauge', 2.5).rotate).toBeCloseTo(-30);
    // A refresh turns forward once, a rewind back.
    expect(glyphPose('refresh', 1).rotate).toBe(360);
    expect(glyphPose('rewind', 1).rotate).toBe(-360);
    // A sprout grows from nothing.
    expect(glyphPose('sprout', 0).scale).toBe(0);
    expect(glyphPose('sprout', 1).scale).toBe(1);
    expect(glyphPose('inflow', 0)).toEqual({ rotate: 0, scale: 1 });
  });

  test('the clock, the gauge and a pending retry keep moving; the rest move once', () => {
    expect(glyphLoop('clock', false)).toBe(6000);
    // Back over 3s and up over 3s.
    expect(glyphLoop('gauge', false)).toBe(6000);
    expect(glyphLoop('refresh', true)).toBe(900);
    expect(glyphLoop('refresh', false)).toBeNull();
    for (const name of ['rewind', 'sprout', 'inflow'] as const) {
      expect(glyphLoop(name, true)).toBeNull();
    }
  });

  test('seeds spread over the glass and bob a point out of step', () => {
    const spots = seedSpots(0.5);
    expect(spots).toHaveLength(5);
    expect(spots[0]).toBeCloseTo(0.55);
    expect(spots[4]).toBeCloseTo(0.95);
    expect(Math.abs(seedBob(0.25, 0))).toBeCloseTo(1);
    expect(seedBob(0.25, 0)).not.toBeCloseTo(seedBob(0.25, 1));
  });

  test('the ripple widens as it fades', () => {
    expect(ripplePose(0)).toEqual({ opacity: 0.6, scale: 1 });
    expect(ripplePose(1)).toEqual({ opacity: 0, scale: 4 });
  });

  test('colours take their alpha from the palette tokens', () => {
    expect(alpha(palette.honey, 0.35)).toBe('rgba(242,196,107,0.35)');
    expect(alpha(palette.cream, 0.25)).toBe('rgba(243,236,223,0.25)');
  });
});

describe('PulseDot', () => {
  test('a ping grows to 2.6 and fades out; reduced, it only fades', () => {
    expect(pingPose(0, false)).toEqual({ scale: 1, opacity: 0.7 });
    expect(pingPose(1, false)).toEqual({ scale: 2.6, opacity: 0 });
    expect(pingPose(0, true).scale).toBe(pingPose(1, true).scale);
  });
});

describe('StatusRing', () => {
  const ring = (over: Partial<RingVisual>): RingVisual => ({
    tone: 'bloom',
    pattern: 'orbit',
    glyph: 'send',
    ...over,
  });

  test('each size leaves room for the halo inside its box', () => {
    for (const size of [40, 96, 120] as const) {
      const { c, r, stroke } = ringGeometry(size);
      expect(r + stroke * 1.4 + stroke * 0.4).toBeLessThanOrEqual(c);
    }
  });

  test('a finished ring fills and pops; an unknown one is held', () => {
    const pending = ring({});
    expect(
      ringEntrance(pending, ring({ tone: 'steam', pattern: 'full' })),
    ).toBe('completed');
    expect(
      ringEntrance(
        pending,
        ring({ tone: 'honey', pattern: 'held', glyph: 'pause' }),
      ),
    ).toBe('held');
    expect(
      ringEntrance(
        pending,
        ring({ tone: 'radish', pattern: 'full', glyph: 'cross' }),
      ),
    ).toBe('failed');
    expect(
      ringEntrance(pending, ring({ tone: 'dust', pattern: 'expired' })),
    ).toBe('expired');
  });

  test('a reused address never arrives like a success', () => {
    expect(
      ringEntrance(
        ring({ pattern: 'dashed', glyph: 'qr' }),
        ring({ tone: 'honey', pattern: 'full', glyph: 'twin' }),
      ),
    ).toBe('none');
  });

  test('a ring that only moves along does not replay an entrance', () => {
    expect(
      ringEntrance(
        ring({ tone: 'sage', progress: 0.2 }),
        ring({ tone: 'sage', progress: 0.6 }),
      ),
    ).toBe('none');
  });

  test('the fill starts from what the ring showed', () => {
    expect(filled(ring({ progress: 0.6 }))).toBe(0.6);
    expect(filled(ring({}))).toBe(0.25);
    expect(filled(ring({ pattern: 'dashed' }))).toBe(0);
    expect(filled(ring({ pattern: 'split', split: 0.4 }))).toBe(0.4);
    expect(filled(ring({ pattern: 'full' }))).toBe(1);
  });

  test('the cross draws in two quick strokes; a completed glyph after the fill starts', () => {
    expect(drawPlan('cross', 'failed')).toEqual([
      { delay: 0, duration: 140 },
      { delay: 60, duration: 140 },
    ]);
    expect(drawPlan('check', 'completed')).toEqual([
      { delay: 120, duration: 420 },
    ]);
    expect(drawPlan('chain', 'completed')).toHaveLength(GLYPHS.chain.length);
  });

  test('the badge sits in the gap of an open ring, else lower right', () => {
    expect(badgeAt(40, 'full')).toEqual({ left: 28, top: 28 });
    const { c, r } = ringGeometry(96);
    const inGap = badgeAt(96, 'gap');
    const size = Math.round(96 * 0.3);
    // One o'clock: right of centre and well above it.
    expect(inGap.left + size / 2).toBeCloseTo(c + r / 2);
    expect(inGap.top + size / 2).toBeCloseTo(c - (r * Math.sqrt(3)) / 2);
  });
});

describe('Whisper', () => {
  const source = { x: 100, y: 300, width: 40, height: 40 };

  test('the pill sits centred just above its source', () => {
    expect(pillPlace(source, 120, 26, 390)).toEqual({ x: 60, y: 266 });
  });

  test('it stays inside the screen', () => {
    expect(pillPlace({ ...source, x: 0 }, 120, 26, 390).x).toBe(16);
    expect(pillPlace({ ...source, x: 380 }, 120, 26, 390).x).toBe(254);
  });

  test('with no room above, it goes below', () => {
    expect(pillPlace({ ...source, y: 10 }, 120, 26, 390).y).toBe(58);
  });
});
