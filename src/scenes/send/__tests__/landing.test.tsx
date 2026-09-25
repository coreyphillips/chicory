import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import type { HostInstance } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { announce } from '../../../design/announce';
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
  said.mockClear();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

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
