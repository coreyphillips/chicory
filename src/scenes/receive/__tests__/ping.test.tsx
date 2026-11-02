import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import { Rect } from 'react-native-svg';
import { palette } from '../../../design/palette';
import * as loops from '../../../motion/loops';
import { durations } from '../../../motion/tokens';
import { radius } from '../../../theme';
import { mount } from '../../../../test-support/guard';
import { ListeningPing, PING, listenPose } from '../ListeningPing';
import { RING_GAP } from '../RequestStep';
import { TestNetwork } from '../tone';

/**
 * A request listening for its payment (REDESIGN.md 5, Listening ping): the
 * ping's cycle, the one still ring it is drawn as, the clock it reads, and
 * what Reduce Motion leaves of it.
 */
beforeEach(() => {
  AppState.currentState = 'active';
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const SIDE = 280;
const CORNER = radius.qr + RING_GAP;
/** How far into each cycle the ping sets out. */
const quiet = 1 - PING.travel / PING.period;

describe('the ping through its cycle', () => {
  test('is gone at every whole number, where the clock rests, and quiet for its first third', () => {
    for (const clock of [0, 1, 2, 0.1, quiet - 0.01, 1 + quiet / 2]) {
      expect(listenPose(clock, SIDE)).toEqual({ scale: 1, opacity: 0 });
    }
  });

  test('sets out from the frame at its peak, going 12pt out as it fades', () => {
    expect(listenPose(quiet, SIDE)).toEqual({ scale: 1, opacity: PING.peak });
    const end = listenPose(0.9999, SIDE);
    expect(end.scale).toBeCloseTo(1 + (2 * PING.reach) / SIDE, 3);
    expect(end.opacity).toBeCloseTo(0, 2);
    let last = listenPose(quiet, SIDE);
    for (let p = quiet + 0.05; p < 1; p += 0.05) {
      const pose = listenPose(p, SIDE);
      expect(pose.scale).toBeGreaterThan(last.scale);
      expect(pose.opacity).toBeLessThan(last.opacity);
      last = pose;
    }
    // The same ping, every cycle.
    const again = listenPose(3 + quiet + 0.2, SIDE);
    const once = listenPose(quiet + 0.2, SIDE);
    expect(again.scale).toBeCloseTo(once.scale, 6);
    expect(again.opacity).toBeCloseTo(once.opacity, 6);
  });

  test('keeps to the tokens: one ping a sheen, over a halo', () => {
    expect(PING.period).toBe(durations.sheen);
    expect(PING.travel).toBe(durations.halo);
  });
});

describe('the ping round a frame', () => {
  test("is one still ring the frame's shape, in the network's tone, that only decorates", async () => {
    const clocks = jest.spyOn(loops, 'useLoop');
    const tree = await mount(
      <ListeningPing side={SIDE} radius={CORNER} running />,
    );
    // Decoration: it rests with the ambient clock.
    expect(clocks).toHaveBeenCalledWith(durations.sheen, true, true);
    expect(tree.root.findByType(Rect).props).toMatchObject({
      rx: CORNER,
      stroke: palette.bloom,
      fill: 'none',
      strokeWidth: PING.stroke,
    });
    const [view] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(view.props.pointerEvents).toBe('none');
    await act(async () => tree.unmount());
    const slate = await mount(
      <TestNetwork.Provider value={true}>
        <ListeningPing side={SIDE} radius={CORNER} running />
      </TestNetwork.Provider>,
    );
    expect(slate.root.findByType(Rect).props.stroke).toBe(palette.slate);
    await act(async () => slate.unmount());
  });

  test('told not to run, it lets its clock rest', async () => {
    const clocks = jest.spyOn(loops, 'useLoop');
    const tree = await mount(
      <ListeningPing side={SIDE} radius={CORNER} running={false} />,
    );
    expect(clocks).toHaveBeenCalledWith(durations.sheen, false, true);
    await act(async () => tree.unmount());
  });

  test('told to stop mid-flight, it fades out where it is going: its clock runs on under the fade, then rests', async () => {
    jest.useFakeTimers();
    // Shared values live as long as their component, as on a device, so
    // the clock is the same one from render to render.
    const made = Reanimated.useSharedValue;
    jest
      .spyOn(Reanimated, 'useSharedValue')
      .mockImplementation(init => React.useState(() => made(init))[0]);
    const clocks = jest.spyOn(loops, 'useLoop');
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const repeats = jest.spyOn(Reanimated, 'withRepeat');
    const tree = await mount(
      <ListeningPing side={SIDE} radius={CORNER} running />,
    );
    clocks.mockClear();
    timings.mockClear();
    repeats.mockClear();
    await act(async () =>
      tree.update(
        <ListeningPing side={SIDE} radius={CORNER} running={false} />,
      ),
    );
    expect(timings).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ duration: durations.exit }),
    );
    // The render that commits keeps the clock running, and nothing rested
    // or restarted it, which would have turned the ring back toward the
    // frame.
    expect(clocks).toHaveBeenLastCalledWith(durations.sheen, true, true);
    expect(repeats).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(durations.exit));
    expect(clocks).toHaveBeenLastCalledWith(durations.sheen, false, true);
    await act(async () => tree.unmount());
  });
});

// Reduce Motion, once read, holds for the rest of the file.
describe('under Reduce Motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  test('draws nothing', async () => {
    // The setting is read as the first caller mounts.
    const first = await mount(
      <ListeningPing side={SIDE} radius={CORNER} running />,
    );
    await act(async () => first.unmount());
    const tree = await mount(
      <ListeningPing side={SIDE} radius={CORNER} running />,
    );
    expect(tree.root.findAllByType(Rect)).toEqual([]);
    await act(async () => tree.unmount());
  });
});
