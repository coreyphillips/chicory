import React from 'react';
import { AccessibilityInfo, Platform, Vibration } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { forgetPendingHaptics, haptics } from '../src/design/haptics';
import { useMotionPrefs } from '../src/motion/useMotionPrefs';
import { motionReduced } from '../src/services/motion';

const trigger = jest.mocked(HapticFeedback.trigger);
const played = () => trigger.mock.calls.map(([type]) => type);

beforeEach(() => {
  jest.useFakeTimers();
  trigger.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each([
  ['tick', 'selection'],
  ['tap', 'impactLight'],
  ['thud', 'impactMedium'],
  ['rigid', 'rigid'],
  ['soft', 'soft'],
  ['success', 'notificationSuccess'],
  ['warning', 'notificationWarning'],
  ['error', 'notificationError'],
] as const)('%s plays %s', (name, type) => {
  haptics[name]();
  expect(played()).toEqual([type]);
});

test('incoming is a success, then light taps at 120 and 240ms', () => {
  haptics.incoming();
  expect(played()).toEqual(['notificationSuccess']);
  jest.advanceTimersByTime(119);
  expect(played()).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(played()).toEqual(['notificationSuccess', 'impactLight']);
  jest.advanceTimersByTime(120);
  expect(played()).toEqual([
    'notificationSuccess',
    'impactLight',
    'impactLight',
  ]);
});

test('held is a warning, repeated at 300ms', () => {
  haptics.held();
  jest.advanceTimersByTime(299);
  expect(played()).toEqual(['notificationWarning']);
  jest.advanceTimersByTime(1);
  expect(played()).toEqual(['notificationWarning', 'notificationWarning']);
});

test('a held payment seen to complete is a success', () => {
  haptics.held();
  jest.advanceTimersByTime(1_000);
  trigger.mockClear();
  haptics.resolved();
  expect(played()).toEqual(['notificationSuccess']);
  jest.advanceTimersByTime(1_000);
  expect(played()).toEqual(['notificationSuccess']);
});

test('completing while its held pattern still plays, the success takes the beat of its second warning', () => {
  // A warning after the news would say it was held again, and a success
  // straight after the first warning would crowd into its beat.
  haptics.held();
  jest.advanceTimersByTime(100);
  haptics.resolved();
  expect(played()).toEqual(['notificationWarning']);
  jest.advanceTimersByTime(199);
  expect(played()).toEqual(['notificationWarning']);
  jest.advanceTimersByTime(1);
  expect(played()).toEqual(['notificationWarning', 'notificationSuccess']);
  jest.advanceTimersByTime(1_000);
  expect(played()).toEqual(['notificationWarning', 'notificationSuccess']);
});

test('a pattern still playing can be forgotten, so it is not felt later', () => {
  haptics.held();
  haptics.incoming();
  forgetPendingHaptics();
  jest.advanceTimersByTime(1_000);
  expect(played()).toEqual(['notificationWarning', 'notificationSuccess']);
});

test('the hold ramp ticks each quarter and thuds at the end', () => {
  [1, 2, 3, 4].forEach(step => haptics.holdRamp(step));
  expect(played()).toEqual([
    'selection',
    'selection',
    'selection',
    'impactMedium',
  ]);
});

test('Android falls back to short vibrations for the new kinds', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  trigger.mockImplementation(() => {
    throw new Error('No taptic engine.');
  });
  try {
    haptics.rigid();
    haptics.soft();
  } finally {
    trigger.mockReset();
  }
  expect(vibrate.mock.calls).toEqual([[14], [6]]);
});

test('haptics stay on with Reduce Motion on', async () => {
  jest
    .mocked(AccessibilityInfo.isReduceMotionEnabled)
    .mockResolvedValueOnce(true);
  let prefs = { reduced: false };
  function Probe() {
    prefs = useMotionPrefs();
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(Probe));
  });
  expect(prefs.reduced).toBe(true);
  expect(motionReduced()).toBe(true);

  haptics.tick();
  haptics.incoming();
  jest.advanceTimersByTime(240);
  expect(played()).toEqual([
    'selection',
    'notificationSuccess',
    'impactLight',
    'impactLight',
  ]);
  // One listener serves every caller, so the next test's listener is its
  // own only once nothing here still listens.
  await act(async () => tree.unmount());
});

test('turning Reduce Motion on mid-session leaves haptics on too', async () => {
  const listeners: Array<(value: boolean) => void> = [];
  jest
    .mocked(AccessibilityInfo.addEventListener)
    .mockImplementationOnce((_event, listener) => {
      listeners.push(listener as (value: boolean) => void);
      return { remove: jest.fn() } as never;
    });
  let prefs = { reduced: true };
  function Probe() {
    prefs = useMotionPrefs();
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(Probe));
  });
  expect(prefs.reduced).toBe(false);

  await act(async () => listeners.forEach(listener => listener(true)));
  expect(prefs.reduced).toBe(true);
  haptics.warning();
  expect(played()).toEqual(['notificationWarning']);
  await act(async () => tree.unmount());
});
