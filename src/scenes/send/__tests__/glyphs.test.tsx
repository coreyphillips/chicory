import React from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { Circle } from 'react-native-svg';
import { palette } from '../../../design/palette';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { HoldButton } from '../../../glyphs/HoldButton';
import { mount } from '../../../../test-support/guard';
import { Orbit } from '../Orbit';

/**
 * The hold and the countdown around it (REDESIGN.md 5, HoldButton and
 * ExpiryRing), beyond the contract the shared suite holds them to: the ramp
 * of haptics a hold is felt through, and the stages a countdown runs down.
 */
const LABEL = 'Send 4,200 sats';

const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

const hold = (tree: ReactTestRenderer) =>
  tree.root.find(
    node =>
      node.props.accessibilityLabel === LABEL &&
      typeof node.props.onPressIn === 'function',
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(HapticFeedback.trigger).mockClear();
});
afterEach(() => jest.useRealTimers());

describe('HoldButton', () => {
  test('a hold is felt at each quarter and lands with a thud', async () => {
    const onCommit = jest.fn();
    const tree = await mount(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    await act(async () => hold(tree).props.onPressIn());
    expect(felt()).toEqual(['impactLight']);
    await act(async () => jest.advanceTimersByTime(525));
    expect(felt()).toEqual([
      'impactLight',
      'selection',
      'selection',
      'selection',
    ]);
    await act(async () => hold(tree).props.onLongPress());
    expect(felt().at(-1)).toBe('impactMedium');
    expect(onCommit).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('let go early, nothing commits and the ramp stops', async () => {
    const onCommit = jest.fn();
    const tree = await mount(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} warning />,
    );
    await act(async () => hold(tree).props.onPressIn());
    await act(async () => jest.advanceTimersByTime(300));
    await act(async () => hold(tree).props.onPressOut());
    await act(async () => jest.advanceTimersByTime(2000));
    // With warnings the quarters are 250ms apart: one had passed.
    expect(felt()).toEqual(['impactLight', 'selection']);
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('sending, an orbit runs round the ring', async () => {
    const tree = await mount(
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} busy />,
    );
    expect(tree.root.findAllByType(Orbit)).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});

describe('ExpiryRing', () => {
  const stroke = (tree: ReactTestRenderer) =>
    tree.root.findByType(Circle).props.stroke;

  test('runs bloom, turns honey in its last 10 seconds, and expires once', async () => {
    const onExpired = jest.fn();
    const tree = await mount(
      <ExpiryRing
        size={108}
        expiresAt={Date.now() + 30_000}
        onExpired={onExpired}
      />,
    );
    expect(stroke(tree)).toBe(palette.bloom);
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(stroke(tree)).toBe(palette.honey);
    expect(onExpired).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a deadline already past is told at once', async () => {
    const onExpired = jest.fn();
    const tree = await mount(
      <ExpiryRing
        size={108}
        expiresAt={Date.now() - 1}
        onExpired={onExpired}
      />,
    );
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
});
