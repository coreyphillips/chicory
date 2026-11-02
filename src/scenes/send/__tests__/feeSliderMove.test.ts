import { moveTo } from '../FeeSlider';
import { durations } from '../../../motion/tokens';

/**
 * The thumb's move (REDESIGN.md 8): the snap spring, or under Reduce Motion
 * a crossfade with the jump unseen at its middle. Each animation is written
 * down as what it is, so what each value was set to reads straight off.
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
jest.mock('../../../motion/steady', () => ({
  steady: (animation: unknown) => animation,
}));

/** A stand-in for a shared value, keeping what it was set to. */
function value(start: number) {
  const log: unknown[] = [];
  let at: unknown = start;
  return {
    get: () => at as number,
    set: (next: unknown) => {
      log.push(next);
      at = next;
    },
    log,
  };
}

test('springs to the rate on the snap spring', () => {
  const position = value(0.5);
  const veil = value(0);
  moveTo(position as never, veil as never, 0.75, false);
  expect(position.log).toEqual([{ spring: 0.75 }]);
  expect(veil.log).toEqual([]);
});

test('under Reduce Motion fades out, jumps unseen at the middle, and fades back within 160ms', () => {
  const position = value(0.5);
  const veil = value(0);
  moveTo(position as never, veil as never, 0.75, true);
  const half = durations.crossfade / 2;
  expect(veil.log).toEqual([
    { steps: [{ timing: 1, ms: half }, { timing: 0, ms: half }] },
  ]);
  expect(position.log).toEqual([{ after: half, then: { timing: 0.75, ms: 1 } }]);
});
