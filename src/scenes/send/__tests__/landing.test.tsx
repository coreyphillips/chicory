import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import type { HostInstance } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { announce } from '../../../design/announce';
import { focusPending } from '../../../motion/focus';
import {
  FOCUS_SETTLE_MS,
  announceSafety,
  forgetSafety,
} from '../../../motion/speech';
import { stepInMs, useLanding } from '../useLanding';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * Send's landings (REDESIGN.md 9): a screen reader is moved only once the
 * step has risen into view, what waits for it is said after it, and a Send
 * that goes first moves nothing but still says what waited.
 */
const said = jest.mocked(announce);
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(
      ([node]) =>
        (node as unknown as ReactTestInstance).props.accessibilityLabel,
    );

function Step({ then }: { then?: string }) {
  const { land, say } = useLanding();
  const target = useRef<HostInstance>(null);
  useEffect(() => {
    land(target);
    if (then) say(then, true);
  }, [land, say, then]);
  return <View ref={target} accessible accessibilityLabel="primary" />;
}

let tree: ReactTestRenderer;
beforeEach(async () => {
  jest.useFakeTimers();
  forgetSafety();
  said.mockClear();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
});

/**
 * Idle callbacks as React Native runs them: back to back, and back to the
 * JavaScript thread's timers only once none is left (the runtime
 * scheduler's event loop). Jest has none, and motion/idle puts a timeout in
 * their place, under which a callback that keeps asking for another still
 * lets every timer fire. `idle()` runs what is queued as a device would,
 * and is false when it would never stop.
 */
function nativeIdle() {
  const queue: (() => void)[] = [];
  Object.assign(globalThis, {
    requestIdleCallback: (callback: () => void) => queue.push(callback),
  });
  return {
    idle: async () => {
      let stopped = true;
      await act(async () => {
        for (let ran = 0; queue.length > 0; ran += 1) {
          if (ran > 1_000) {
            stopped = false;
            queue.length = 0;
            return;
          }
          queue.shift()?.();
        }
      });
      return stopped;
    },
  };
}

const draw = async (then?: string) => {
  await act(async () => {
    tree = create(<Step then={then} />);
  });
};
const wait = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

test('moves a screen reader once the step is in view, then says what waited', async () => {
  await draw('Payment status unknown.');
  await wait(stepInMs() - 1);
  expect(focused()).toEqual([]);
  expect(said).not.toHaveBeenCalled();
  // In view, it still waits for an idle moment.
  await wait(50);
  expect(focused()).toEqual(['primary']);
  expect(said).toHaveBeenCalledWith('Payment status unknown.', {
    assertive: true,
  });
  const moved = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock
    .invocationCallOrder[0];
  expect(said.mock.invocationCallOrder[0]).toBeGreaterThan(moved);
  await act(async () => tree.unmount());
});

test('going before it lands moves nothing, and still says what waited', async () => {
  await draw('Payment status unknown.');
  await act(async () => tree.unmount());
  expect(said).toHaveBeenCalledWith('Payment status unknown.', {
    assertive: true,
  });
  await wait(stepInMs() * 2);
  expect(focused()).toEqual([]);
});

test('counts as a focus move on its way from the moment it is asked for', async () => {
  // A safety message waits for every move on its way (motion/speech), so a
  // landing still rising into view must count as one.
  await draw();
  expect(focusPending()).toBe(true);
  await wait(stepInMs() + 50);
  expect(focused()).toEqual(['primary']);
  expect(focusPending()).toBe(false);
  await act(async () => tree.unmount());
});

test('going before it lands leaves no move on its way', async () => {
  await draw();
  expect(focusPending()).toBe(true);
  await act(async () => tree.unmount());
  expect(focusPending()).toBe(false);
});

test('a safety message waiting for the landing never keeps a device from its timers', async () => {
  // The landing waited on a timer of its own, and the message asked again
  // at every idle moment until it was made. On a device idle callbacks run
  // back to back, so no timer fired, the landing's own included, and the
  // held haptic's second warning never played (P14).
  const device = nativeIdle();
  function Held() {
    const { land } = useLanding();
    const target = useRef<HostInstance>(null);
    useEffect(() => {
      land(target);
      return announceSafety('Payment held.', 'held');
    }, [land]);
    return <View ref={target} accessible accessibilityLabel="primary" />;
  }
  await act(async () => {
    tree = create(<Held />);
  });
  expect(await device.idle()).toBe(true);
  await wait(stepInMs());
  expect(await device.idle()).toBe(true);
  expect(focused()).toEqual(['primary']);
  // Heard once the move has had its time to settle.
  await wait(FOCUS_SETTLE_MS);
  expect(await device.idle()).toBe(true);
  expect(said).toHaveBeenCalledWith('Payment held.', { assertive: true });
  await act(async () => tree.unmount());
});
