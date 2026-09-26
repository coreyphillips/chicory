import React from 'react';
import { Dimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import { sceneIn, sceneOut } from '../src/motion/presets';
import { FRAME_CAP_MS, steady, steadyClock } from '../src/motion/steady';
import { durations } from '../src/motion/tokens';
import * as motion from '../src/services/motion';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import { stops } from '../src/stage/layout';
import { beganAt, buildLanded } from '../src/stage/panes/Build';
import type { Build } from '../src/stage/panes/Build';
import { veilNeeded } from '../src/stage/panes/usePaneMotion';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { snapshotOf } from '../test-support/fixtures';
import { mount } from '../test-support/guard';

/**
 * Motion that is seen whole (REDESIGN.md 2.3 and 3.5). On the simulator the
 * frame that mounted a scene took 100 to 300ms to paint, and every move
 * counted by the frames' clock was most of the way through by the first
 * frame anyone saw. Jest sees no frame, so the steady clock is held to its
 * arithmetic, and the panes to when they are asked to move.
 */

afterEach(() => jest.restoreAllMocks());

describe('the steady clock', () => {
  /** An animation as Reanimated runs it, reduced to what the tests read. */
  interface Running {
    onStart: (a: Running, v: unknown, now: number, p: unknown) => void;
    onFrame: (a: Running, now: number) => boolean;
    callback?: (finished?: boolean) => void;
    startTime?: number;
    steadyClock?: number;
  }
  /** An animation that writes down the time it is given at each frame. */
  const recording = () => {
    const seen: number[] = [];
    const inner: Running = {
      onStart: (a, _value, now) => {
        a.startTime = now;
      },
      onFrame: (a, now) => {
        seen.push(now - (a.startTime ?? 0));
        return false;
      },
      callback: jest.fn(),
    };
    return { seen, inner };
  };

  test('moves with each frame, but no further than two frames for any one', () => {
    expect(steadyClock(0, 0, 16)).toBe(16);
    expect(steadyClock(16, 16, 266)).toBe(16 + FRAME_CAP_MS);
    expect(steadyClock(10, 20, 15)).toBe(10);
  });

  test('a move is first seen from where it started, however long the first frame', () => {
    const { seen, inner } = recording();
    const move = steady(inner) as unknown as Running;
    move.onStart(move, 0, 1_000, null);
    move.onFrame(move, 1_000);
    // The frame that mounts a scene takes 250ms to paint.
    move.onFrame(move, 1_250);
    move.onFrame(move, 1_266);
    expect(seen).toEqual([0, FRAME_CAP_MS, FRAME_CAP_MS + 16]);
    move.callback?.(true);
    expect(inner.callback).toHaveBeenCalledWith(true);
  });

  test('one that takes over from another carries on from its clock', () => {
    const first = steady(recording().inner) as unknown as Running;
    first.onStart(first, 0, 1_000, null);
    first.onFrame(first, 1_300);
    const { seen, inner } = recording();
    const next = steady(inner) as unknown as Running;
    next.onStart(next, 0, 1_300, first);
    expect(inner.startTime).toBe(first.steadyClock);
    next.onFrame(next, 1_316);
    expect(seen).toEqual([16]);
  });

  test('a value that is already final passes through, as under Jest', () => {
    expect(steady(5)).toBe(5);
    expect(steady('0deg')).toBe('0deg');
  });
});

describe('the canvas build', () => {
  test('begins with its first painted frame, so a slow one makes no part late', () => {
    const build: Build = {
      arrival: 'load',
      beats: {
        hero: 80,
        sheet: 130,
        actions: 180,
        actionStep: 50,
        rows: 230,
        rowStep: 30,
        done: 630,
      },
      began: 1_000,
    };
    // Mounted at 1000, its first frame painted at 1330.
    beganAt(build, 1_330);
    expect(buildLanded(build, 1_700)).toBe(false);
    expect(buildLanded(build, 1_330 + 631)).toBe(true);
  });
});

const client = new DemoWalletClient();
const session: React.ComponentProps<typeof Canvas>['session'] = {
  error: '',
  switchError: '',
  refreshing: false,
  connecting: false,
  refresh: jest.fn(),
  manualRefresh: jest.fn(),
  disconnect: jest.fn(),
  chooseWallet: jest.fn(),
  switchNetwork: jest.fn(),
  eraseDevice: jest.fn(),
};

let stage!: StageStore;

function OnCanvas() {
  stage = useStageStore();
  const view = useCanvasView();
  return (
    <GestureHandlerRootView>
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={client}
          snapshot={snapshotOf()}
          session={session}
          stale={false}
          backup={null}
          view={view}
        />
      </StageProvider>
    </GestureHandlerRootView>
  );
}

describe('the panes', () => {
  test('a tap takes the lock at once, and the panes move once its scene is drawn', async () => {
    const springs = jest.spyOn(Reanimated, 'withSpring');
    const tree = await mount(<OnCanvas />);
    springs.mockClear();
    await act(async () => {
      stage.actions.openSend();
      // Asked for and locked, but nothing moves until the frame that draws
      // Send, which can be long to paint, has been drawn.
      expect(stage.panes.current?.moving()).toBe(true);
      expect(springs).not.toHaveBeenCalled();
    });
    expect(springs).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a flung sheet carries on from the finger in the fling’s own tick', async () => {
    const springs = jest.spyOn(Reanimated, 'withSpring');
    const tree = await mount(<OnCanvas />);
    springs.mockClear();
    await act(async () => {
      stage.actions.openActivity({ velocity: -1_200 });
      expect(springs).toHaveBeenCalledWith(
        stops(Dimensions.get('window').height, { top: 0 }).compact,
        expect.objectContaining({ velocity: -1_200 }),
      );
    });
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion a pane a gesture already carried needs no veil', () => {
    expect(veilNeeded({ seam: 72, hero: 0 }, { seam: 72, hero: 0 })).toBe(
      false,
    );
    expect(veilNeeded({ seam: 72.2, hero: 0.001 }, { seam: 72, hero: 0 })).toBe(
      false,
    );
    expect(veilNeeded({ seam: 440, hero: 1 }, { seam: 72, hero: 0 })).toBe(
      true,
    );
  });

  test('under Reduce Motion a scene hands over as the panes do: out, then in', () => {
    jest.spyOn(motion, 'motionReduced').mockReturnValue(true);
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const values = {} as never;
    sceneOut()(values);
    expect(timings.mock.calls.map(([, config]) => config?.duration)).toEqual([
      durations.crossfade / 2,
      durations.crossfade / 2,
      durations.crossfade / 2,
    ]);
    timings.mockClear();
    delays.mockClear();
    sceneIn()(values);
    for (const [, config] of timings.mock.calls) {
      expect(config?.duration).toBe(durations.crossfade / 2);
    }
    for (const [delay] of delays.mock.calls) {
      expect(delay).toBe(durations.crossfade / 2);
    }
  });
});
