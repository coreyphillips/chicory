import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useMotionPrefs } from '../src/motion/useMotionPrefs';
import { motionReduced } from '../src/services/motion';

/**
 * Reduce Motion, read once for everything on screen (REDESIGN.md 8): a
 * keypad's twelve keys or a list's rings share one listener and one read of
 * the setting, and every one of them hears it change.
 */

const seen: boolean[] = [];
function Probe({ at }: { at: number }) {
  seen[at] = useMotionPrefs().reduced;
  return null;
}

function Many({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, at) => (
        <Probe key={at} at={at} />
      ))}
    </>
  );
}

const listeners = () =>
  jest
    .mocked(AccessibilityInfo.addEventListener)
    .mock.calls.filter(([name]) => name === 'reduceMotionChanged');

afterEach(() => jest.restoreAllMocks());

test('a screenful of callers shares one listener and one read', async () => {
  jest.mocked(AccessibilityInfo.addEventListener).mockClear();
  const asked = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  asked.mockClear();
  asked.mockResolvedValue(false);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Many count={12} />);
  });
  expect(listeners()).toHaveLength(1);
  expect(asked).toHaveBeenCalledTimes(1);

  // The setting changes, and every caller hears it from the one listener.
  const [[, heard]] = listeners();
  await act(async () => (heard as (on: boolean) => void)(true));
  expect(seen).toHaveLength(12);
  expect(seen.every(on => on)).toBe(true);
  expect(motionReduced()).toBe(true);
  await act(async () => (heard as (on: boolean) => void)(false));
  expect(seen.some(on => on)).toBe(false);

  const [{ value: subscription }] = jest.mocked(
    AccessibilityInfo.addEventListener,
  ).mock.results;
  await act(async () => tree.unmount());
  expect(subscription.remove).toHaveBeenCalledTimes(1);
});

test('a screen drawn later reads the setting again', async () => {
  const asked = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  asked.mockResolvedValue(true);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Many count={3} />);
  });
  expect(seen.slice(0, 3)).toEqual([true, true, true]);
  await act(async () => tree.unmount());
  asked.mockResolvedValue(false);
  await act(async () => {
    tree = create(<Many count={3} />);
  });
  expect(seen.slice(0, 3)).toEqual([false, false, false]);
  await act(async () => tree.unmount());
});
