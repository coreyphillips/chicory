import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { usePanGesture } from 'react-native-gesture-handler';
import type { PanGestureConfig } from 'react-native-gesture-handler';
import * as Worklets from 'react-native-worklets';
import { useSheetDrag } from '../src/scenes/activity/useSheetDrag';
import { PanesProvider } from '../src/stage/panes/Pane';
import type { Panes } from '../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../src/stage/StageContext';

jest.mock('react-native-gesture-handler', () => ({
  usePanGesture: jest.fn(config => config),
}));
jest.mock('../src/motion/useMotionPrefs', () => ({
  useMotionPrefs: () => ({ reduced: false }),
}));
// Run the installed spring's actual frame calculations, without the native
// runtime or the normal Jest mock that jumps straight to the final value.
jest.mock('react-native-reanimated/src/animation/util', () => ({
  defineAnimation: (_value: unknown, factory: () => unknown) => factory(),
  getReduceMotionForAnimation: () => false,
}));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  withSpring: require('react-native-reanimated/src/animation/spring/spring')
    .withSpring,
}));

interface Running {
  current: number;
  velocity?: number;
  steadyInner?: Running;
  steadyClock?: number;
  onStart: (
    self: Running,
    value: number,
    now: number,
    before: Running | null,
  ) => void;
  onFrame: (self: Running, now: number) => boolean;
}

function pane(value: number, clock: () => number) {
  let current = value;
  let animation: Running | null = null;
  return {
    get: () => current,
    set: (next: number | Running) => {
      if (typeof next === 'number') {
        current = next;
        animation = null;
      } else {
        next.onStart(next, current, clock(), animation);
        animation = next;
      }
    },
    frame: () => {
      if (!animation) return;
      animation.onFrame(animation, clock());
      current = animation.current;
    },
    animation: () => animation!,
  };
}

afterEach(() => jest.restoreAllMocks());

test.each([
  {
    name: 'a short drag back home',
    translation: -100,
    velocity: 500,
    refused: false,
  },
  {
    name: 'a refused opening',
    translation: -200,
    velocity: -500,
    refused: true,
  },
])(
  '$name keeps its current spring when JavaScript catches up',
  async ({ translation, velocity, refused }) => {
    const pending: (() => void)[] = [];
    jest.spyOn(Worklets, 'scheduleOnRN').mockImplementation((fn, ...args) => {
      pending.push(() => fn(...args));
    });
    let now = 1000;
    const clock = () => now;
    const seam = pane(480, clock);
    const hero = pane(1, clock);
    const bar = pane(1, clock);
    const panes = {
      seam,
      hero,
      bar,
      stops: { compact: 120, home: 480 },
    } as unknown as Panes;
    function Drag() {
      useSheetDrag('home', true);
      return null;
    }
    function Host() {
      const stage = useStageStore();
      stage.panes.current = {
        moving: () => refused,
        follow: jest.fn(),
        realign: jest.fn(),
      };
      return (
        <StageProvider value={stage}>
          <PanesProvider value={panes}>
            <Drag />
          </PanesProvider>
        </StageProvider>
      );
    }
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Host />);
    });
    const config = jest
      .mocked(usePanGesture)
      .mock.calls.at(-1)![0] as PanGestureConfig;
    config.onBegin!({ y: 0 } as never);
    config.onActivate!({ translationY: 0 } as never);
    const update = config.onUpdate;
    if (typeof update !== 'function') throw new Error('Expected a drag callback');
    update({ translationY: translation } as never);
    config.onDeactivate!({ velocityY: velocity } as never);
    for (now = 1016; now <= 1096; now += 16) {
      seam.frame();
      hero.frame();
      bar.frame();
    }
    now = 1096;
    const before = seam.animation();
    const speed = before.velocity!;
    await act(async () => {
      pending.splice(0).forEach(run => run());
    });
    const after = seam.animation();
    expect(after.steadyClock).toBe(before.steadyClock);
    // Returning to the same target continues at the current speed. Reversing
    // a refused opening clips velocity pointing away from home to zero.
    expect(after.steadyInner!.velocity).toBeCloseTo(refused ? 0 : speed, 8);
    now = 1112;
    seam.frame();
    expect(seam.get()).toBeGreaterThan(before.current);
    await act(async () => tree.unmount());
  },
);
