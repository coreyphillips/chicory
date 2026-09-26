import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Bloom } from '../src/glyphs/Bloom';
import { Odometer } from '../src/glyphs/Odometer';
import { PulseDot } from '../src/glyphs/PulseDot';
import { StatusRing } from '../src/glyphs/StatusRing';
import { Vessel } from '../src/glyphs/Vessel';
import {
  AMBIENT_REST_MS,
  useAmbientRest,
  wakeAmbient,
  wakeOnTouch,
} from '../src/motion/ambient';
import * as loops from '../src/motion/loops';
import { REST_CURVE, restEase, useLoop } from '../src/motion/loops';
import { durations } from '../src/motion/tokens';
import { Backdrop, swingAt } from '../src/scenes/home/Backdrop';
import { Pulse, Rock, Spin } from '../src/scenes/receive/loops';
import { shownBy } from '../src/stage/Stage';
import { activityOf, snapshotOf } from '../test-support/fixtures';

/**
 * The ambient clock (REDESIGN.md 3.5). A phone left alone kept drawing its
 * decoration forever, so Android's uiautomator, which waits for a still
 * screen, never read it, and the battery kept paying. Decoration now rests
 * once nobody has touched the app for AMBIENT_REST_MS and picks up with the
 * next touch; a loop that says something is under way never rests.
 */
const mounted: ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  mounted.push(tree);
  return tree;
}
const pass = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const touch = () =>
  act(async () => {
    expect(wakeOnTouch.onStartShouldSetResponderCapture()).toBe(false);
  });

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  // Each test starts touched.
  wakeAmbient();
});
afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** The timers set to wait out the quiet, as their ids. */
const restTimers = (waits: jest.SpyInstance) =>
  waits.mock.calls
    .map((call, i) => [call[1], waits.mock.results[i].value] as const)
    .filter(([delay]) => delay === AMBIENT_REST_MS)
    .map(([, id]) => id);

/**
 * Shared values that live as long as their component, as on a device: the
 * mock makes a new one each render, which would lose where a clock stood.
 */
function keepSharedValues() {
  const made = Reanimated.useSharedValue;
  jest
    .spyOn(Reanimated, 'useSharedValue')
    .mockImplementation(init => React.useState(() => made(init))[0]);
}

/** Reports whether decoration rests, each time it renders. */
function Probe({ ambient, seen }: { ambient?: boolean; seen: boolean[] }) {
  seen.push(useAmbientRest(ambient));
  return null;
}

describe('the clock', () => {
  test('rests once the app has gone untouched for 20 seconds, and not before', async () => {
    expect(AMBIENT_REST_MS).toBe(20_000);
    const seen: boolean[] = [];
    await render(<Probe seen={seen} />);
    await pass(AMBIENT_REST_MS - 1);
    expect(seen[seen.length - 1]).toBe(false);
    await pass(1);
    expect(seen[seen.length - 1]).toBe(true);
  });

  test('a touch wakes it, and each touch starts the quiet over', async () => {
    const seen: boolean[] = [];
    await render(<Probe seen={seen} />);
    await pass(AMBIENT_REST_MS);
    expect(seen[seen.length - 1]).toBe(true);
    await touch();
    expect(seen[seen.length - 1]).toBe(false);
    await pass(15_000);
    // A finger moving counts as much as one landing.
    await act(async () => {
      expect(wakeOnTouch.onMoveShouldSetResponderCapture()).toBe(false);
    });
    await pass(15_000);
    expect(seen[seen.length - 1]).toBe(false);
    await pass(5_000);
    expect(seen[seen.length - 1]).toBe(true);
  });

  test('a loop that carries meaning neither listens nor rests', async () => {
    const seen: boolean[] = [];
    const waits = jest.spyOn(globalThis, 'setTimeout');
    await render(<Probe ambient={false} seen={seen} />);
    expect(restTimers(waits)).toEqual([]);
    await pass(3 * AMBIENT_REST_MS);
    expect(new Set(seen)).toEqual(new Set([false]));
  });

  test('with no decoration on screen, no timer runs', async () => {
    const seen: boolean[] = [];
    const waits = jest.spyOn(globalThis, 'setTimeout');
    const clears = jest.spyOn(globalThis, 'clearTimeout');
    const tree = await render(<Probe seen={seen} />);
    const [timer] = restTimers(waits);
    expect(timer).toBeDefined();
    await act(async () => tree.unmount());
    expect(clears).toHaveBeenCalledWith(timer);
  });
});

describe('a loop', () => {
  function Loop({ ambient }: { ambient: boolean }) {
    useLoop(1_000, true, ambient);
    return null;
  }

  test('that decorates settles as the clock rests, and picks up at the next touch', async () => {
    const repeats = jest.spyOn(Reanimated, 'withRepeat');
    const stops = jest.spyOn(Reanimated, 'cancelAnimation');
    await render(<Loop ambient />);
    expect(repeats).toHaveBeenCalledTimes(1);
    await pass(AMBIENT_REST_MS);
    expect(stops).toHaveBeenCalledTimes(1);
    expect(repeats).toHaveBeenCalledTimes(1);
    await touch();
    expect(repeats).toHaveBeenCalledTimes(2);
  });

  test('comes to rest by slowing from its own speed, forward to its next whole cycle', () => {
    // A quarter of the way round, three quarters are left: at the loop's own
    // speed that is 750ms, and the ease-out opens at twice its average.
    expect(restEase(2.25, 1_000)).toEqual({ to: 3, duration: 1_500 });
    // The square's ease-out opens at twice its average speed, which is then
    // the loop's own: one cycle every 1,800ms.
    const { to, duration } = restEase(0.4, 1_800);
    expect((2 * (to - 0.4)) / duration).toBeCloseTo(1 / 1_800, 9);
    // Never backwards, and at a whole cycle it is already at rest.
    expect(restEase(4.9, 1_000).to).toBe(5);
    expect(restEase(3, 1_000)).toEqual({ to: 3, duration: 0 });
  });

  test('that decorates eases into its rest pose rather than stopping', async () => {
    // Caught 40% of the way through a cycle as the quiet runs out.
    keepSharedValues();
    jest.spyOn(Reanimated, 'withRepeat').mockReturnValue(0.4 as never);
    const timings = jest.spyOn(Reanimated, 'withTiming');
    await render(<Loop ambient />);
    timings.mockClear();
    await pass(AMBIENT_REST_MS);
    expect(timings).toHaveBeenCalledWith(1, {
      duration: 1_200,
      easing: REST_CURVE,
    });
  });

  test('that says something is under way keeps running', async () => {
    const repeats = jest.spyOn(Reanimated, 'withRepeat');
    const stops = jest.spyOn(Reanimated, 'cancelAnimation');
    await render(<Loop ambient={false} />);
    await pass(3 * AMBIENT_REST_MS);
    expect(repeats).toHaveBeenCalledTimes(1);
    expect(stops).not.toHaveBeenCalled();
  });
});

describe('what rests', () => {
  /**
   * Whether each loop `element` runs is ambient, by its period; with `all`,
   * each loop it keeps, running or not.
   */
  async function loopsOf(element: React.ReactElement, all = false) {
    const clocks = jest.spyOn(loops, 'useLoop');
    const tree = await render(element);
    const running = clocks.mock.calls
      .filter(([, on]) => all || on)
      .map(([period, , ambient]) => [period, !!ambient] as const);
    await act(async () => tree.unmount());
    clocks.mockRestore();
    return [...new Map(running).entries()];
  }

  test('decoration: a breath, a halo, the sheen, the seeds, the moon and a caret', async () => {
    expect(await loopsOf(<Bloom size={28} mode="breathe" />)).toEqual([
      [durations.breathe, true],
    ]);
    expect(await loopsOf(<Bloom size={28} halo />)).toEqual([
      [durations.halo, true],
    ]);
    // The vessel's sheen and seeds run once it has measured its width,
    // which Jest never lays out, so these are the loops it keeps.
    const arriving = await loopsOf(
      <Vessel availableSats={40_000} pendingSats={10_000} unit="sats" />,
      true,
    );
    expect(arriving.length).toBeGreaterThan(0);
    for (const [, ambient] of arriving) expect(ambient).toBe(true);
    expect(await loopsOf(<Rock />)).toEqual([[durations.breathe, true]]);
    expect(await loopsOf(<Pulse period={1_000} />)).toEqual([[1_000, true]]);
  });

  test('meaning: the chase, a payment in flight, a busy spin, the stale shimmer and reconnecting', async () => {
    for (const element of [
      <Bloom size={28} mode="chase" />,
      <StatusRing
        size={40}
        visual={{ tone: 'bloom', pattern: 'orbit', glyph: 'send' }}
      />,
      <StatusRing
        size={40}
        visual={{ tone: 'bloom', pattern: 'dashed', glyph: 'qr' }}
      />,
      <StatusRing
        size={40}
        visual={{ tone: 'honey', pattern: 'held', glyph: 'pause' }}
      />,
      <Spin />,
      <Odometer sats={4_200} unit="sats" variant="hero" stale />,
      <PulseDot state="reconnecting" />,
    ]) {
      const found = await loopsOf(element);
      expect(found.length).toBeGreaterThan(0);
      for (const [, ambient] of found) expect(ambient).toBe(false);
    }
  });

  test("the backdrop's drift comes to rest, and drifts again at a touch", async () => {
    const repeats = jest.spyOn(Reanimated, 'withRepeat');
    await render(
      <Backdrop
        snapshot={snapshotOf()}
        stale={false}
        backup={null}
        session={{ error: '' } as never}
        arrived={0}
      />,
    );
    // The glow's drift and turn, and the crema's.
    expect(repeats).toHaveBeenCalledTimes(3);
    await pass(AMBIENT_REST_MS);
    expect(repeats).toHaveBeenCalledTimes(3);
    await touch();
    expect(repeats).toHaveBeenCalledTimes(6);
  });

  test("the backdrop's swings slow into the end each was heading for", async () => {
    // A swing's clock stands at an end, still, on each whole number.
    expect(swingAt(0)).toBe(0);
    expect(swingAt(1)).toBe(1);
    expect(swingAt(2)).toBeCloseTo(0);
    expect(swingAt(0.5)).toBeCloseTo(0.5);
    // Each clock caught 30% of the way across a swing as the quiet runs out.
    keepSharedValues();
    jest.spyOn(Reanimated, 'withRepeat').mockReturnValue(2.3 as never);
    const timings = jest.spyOn(Reanimated, 'withTiming');
    await render(
      <Backdrop
        snapshot={snapshotOf()}
        stale={false}
        backup={null}
        session={{ error: '' } as never}
        arrived={0}
      />,
    );
    timings.mockClear();
    await pass(AMBIENT_REST_MS);
    const rests = timings.mock.calls.filter(
      ([, config]) => config?.easing === REST_CURVE,
    );
    // The glow's drift and turn, and the crema's, each on to its end.
    expect(rests).toHaveLength(3);
    for (const [to] of rests) expect(to).toBe(3);
  });

  test('a poll that lands while decoration rests sends out no ping, and waking sends none', async () => {
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const pings = () =>
      timings.mock.calls.filter(
        ([to, config]) => to === 1 && config?.duration === 900,
      ).length;
    const tree = await render(<PulseDot state="live" pingKey={1} />);
    expect(pings()).toBe(1);
    await act(async () => tree.update(<PulseDot state="live" pingKey={2} />));
    expect(pings()).toBe(2);
    await pass(AMBIENT_REST_MS);
    await act(async () => tree.update(<PulseDot state="live" pingKey={3} />));
    expect(pings()).toBe(2);
    await touch();
    expect(pings()).toBe(2);
    await act(async () => tree.update(<PulseDot state="live" pingKey={4} />));
    expect(pings()).toBe(3);
  });
});

describe('a read', () => {
  test('wakes decoration only when it changes what is shown, not merely when it lands', () => {
    const pending = activityOf('sent', 'pending');
    const read = snapshotOf({ activity: [pending] });
    // The next poll, twelve seconds on, with nothing new.
    expect(shownBy({ ...read, updatedAt: read.updatedAt + 12_000 })).toBe(
      shownBy(read),
    );
    for (const changed of [
      snapshotOf({ activity: [pending], balance: { availableSats: 1 } }),
      snapshotOf({ activity: [pending], primary: { connected: false } }),
      snapshotOf({ activity: [{ ...pending, status: 'completed' }] }),
      snapshotOf({ activity: [activityOf('received', 'completed'), pending] }),
      snapshotOf({ activity: [pending], lfbw: { setup: 'pending' } }),
      snapshotOf({ activity: [pending], balance: { totalSats: 1 } }),
    ]) {
      expect(shownBy(changed)).not.toBe(shownBy(read));
    }
  });

  test('a channelize pass that decides nothing new wakes nothing', () => {
    // Every pass writes its decision again with a new time (the P10 device
    // pass saw lastChannelize.at move while the result stayed the same).
    const decided = (at: number, reason = 'below-floor') =>
      snapshotOf({
        balance: {
          totalSats: 30_000,
          availableSats: 20_000,
          pendingSats: 10_000,
        },
        lfbw: { lastChannelize: { action: 'wait', at, reason } },
      });
    expect(shownBy(decided(2_000))).toBe(shownBy(decided(1_000)));
    // A new decision that changes the vessel's look is worth seeing.
    expect(shownBy(decided(2_000, 'fee-too-high'))).not.toBe(
      shownBy(decided(1_000)),
    );
  });
});
