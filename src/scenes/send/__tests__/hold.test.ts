import { letGo, pressIn, seal } from '../../../glyphs/HoldButton';
import type { HoldParts } from '../../../glyphs/HoldButton';
import { durations } from '../../../motion/tokens';

/**
 * The hold's motion (REDESIGN.md 5, HoldButton) as the worklets that play it
 * on the UI thread. Each animation is written down as what it is, so the
 * order of the complete reads straight off what each part was set to.
 */
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    withTiming: (to: number, config?: { duration?: number }) => ({
      timing: to,
      ms: config?.duration,
    }),
    withSpring: (to: number) => ({ spring: to }),
    withDelay: (ms: number, then: unknown) => ({ after: ms, then }),
    withSequence: (...steps: unknown[]) => ({ steps }),
  };
});

type Part = keyof HoldParts;

/** Stand-ins for the hold's shared values, keeping what each was set to. */
function parts() {
  const set: Record<Part, unknown[]> = {
    fill: [],
    scale: [],
    flash: [],
    launch: [],
    burst: [],
    sealed: [],
    commit: [],
  };
  const value = (part: Part, start: unknown) => {
    let at = start;
    return {
      get: () => at,
      set: (next: unknown) => {
        set[part].push(next);
        at = next;
      },
    };
  };
  const held = {
    fill: value('fill', 0),
    scale: value('scale', 1),
    flash: value('flash', 0),
    launch: value('launch', 0),
    burst: value('burst', 0),
    sealed: value('sealed', false),
    commit: value('commit', 0),
  } as unknown as HoldParts;
  return { held, set };
}

const afterFlash = (then: unknown) => ({ after: durations.tick, then });

describe('the complete', () => {
  test('the ring is made whole, then drains once the flash has peaked, clearing the track for the orbit', () => {
    const { held, set } = parts();
    expect(seal(held, false)).toBe(true);
    expect(set.fill).toEqual([
      1,
      afterFlash({ timing: 0, ms: durations.move }),
    ]);
  });

  test('the flash rises over a tick, and the arrow launches and the sparks burst only as it peaks', () => {
    const { held, set } = parts();
    seal(held, false);
    expect(set.flash).toEqual([
      {
        steps: [
          { timing: 1, ms: durations.tick },
          { timing: 0, ms: durations.move },
        ],
      },
    ]);
    expect(set.scale).toEqual([{ steps: [{ spring: 1.06 }, { spring: 1 }] }]);
    expect(set.launch).toEqual([afterFlash({ timing: 1, ms: 240 })]);
    expect(set.burst).toEqual([0, afterFlash({ timing: 1, ms: 700 })]);
  });

  test("what the commit ends, such as the quote's ring, fades as the flash rises, here and not a render later", () => {
    // Left to the payment's render, the quote's ring stayed drawn and
    // running down for 600ms after the flash (P12, 06d).
    for (const reduced of [false, true]) {
      const { held, set } = parts();
      seal(held, reduced);
      expect(set.commit).toEqual([{ timing: 1, ms: durations.tick }]);
    }
  });

  test('under Reduce Motion nothing pops or bursts, and the arrow only fades after the flash', () => {
    const { held, set } = parts();
    seal(held, true);
    expect(set.scale).toEqual([]);
    expect(set.burst).toEqual([]);
    expect(set.launch).toEqual([
      afterFlash({ timing: 1, ms: durations.crossfade }),
    ]);
    // The ring still empties, as it is no travel through space.
    expect(set.fill).toEqual([
      1,
      afterFlash({ timing: 0, ms: durations.move }),
    ]);
  });

  test('it plays once, however often it is told', () => {
    const { held, set } = parts();
    expect(seal(held, false)).toBe(true);
    const fills = set.fill.length;
    expect(seal(held, false)).toBe(false);
    expect(set.fill).toHaveLength(fills);
    expect(set.sealed).toEqual([true]);
  });
});

describe('the press', () => {
  test('let go early, the fill drains with the snap spring', () => {
    const { held, set } = parts();
    expect(pressIn(held, durations.hold, false)).toBe(true);
    expect(set.fill).toEqual([{ timing: 1, ms: durations.hold }]);
    expect(set.scale).toEqual([{ spring: 0.94 }]);
    letGo(held);
    expect(set.fill.at(-1)).toEqual({ spring: 0 });
    expect(set.scale.at(-1)).toEqual({ spring: 1 });
  });

  test('a finger lifted once the ring is whole takes nothing back, and a new press starts nothing', () => {
    const { held, set } = parts();
    pressIn(held, durations.hold, false);
    seal(held, false);
    const fills = set.fill.length;
    letGo(held);
    expect(pressIn(held, durations.hold, false)).toBe(false);
    expect(set.fill).toHaveLength(fills);
  });

  test('under Reduce Motion the circle does not dip, and the fill still runs', () => {
    const { held, set } = parts();
    pressIn(held, durations.holdWarning, true);
    expect(set.scale).toEqual([]);
    expect(set.fill).toEqual([{ timing: 1, ms: durations.holdWarning }]);
  });
});
