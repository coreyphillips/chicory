import type { HostInstance } from 'react-native';
import { announce, forgetSpoken } from '../src/design/announce';
import { focusAfterTransition } from '../src/motion/focus';
import {
  FOCUS_SETTLE_MS,
  announceSafety,
  forgetSafety,
} from '../src/motion/speech';

jest.mock('../src/design/announce', () => ({
  announce: jest.fn(),
  forgetSpoken: jest.fn(),
}));

/**
 * Safety messages (REDESIGN.md 9): held until the screen has settled, said
 * together in order, and never carried from one test into the next.
 */
const said = jest.mocked(announce);

beforeEach(() => {
  jest.useFakeTimers();
  forgetSafety();
  forgetSpoken();
  said.mockClear();
});
afterEach(() => {
  forgetSafety();
  jest.useRealTimers();
});

const settle = () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 50);

test('messages that begin together are said as one, in order of how much they matter', () => {
  announceSafety('Test network.', 'testNetwork');
  announceSafety('Payment status unknown.', 'held');
  expect(said).not.toHaveBeenCalled();
  settle();
  expect(said.mock.calls).toEqual([
    ['Payment status unknown. Test network.', { assertive: true }],
  ]);
});

test('a message withdrawn before it is heard is not said', () => {
  const withdraw = announceSafety('Balance not confirmed recently.', 'stale');
  withdraw();
  settle();
  expect(said).not.toHaveBeenCalled();
});

test('a message waiting on a focus move that waits on a timer never keeps a device from its timers', () => {
  // Idle callbacks as React Native runs them: back to back, and back to the
  // JavaScript thread's timers only once none is left. Jest has none, and a
  // timeout stands in (motion/idle), under which asking again at once still
  // lets every timer fire, so this runs them as a device would.
  const queue: (() => void)[] = [];
  Object.assign(globalThis, {
    requestIdleCallback: (callback: () => void) => queue.push(callback),
  });
  const drains = () => {
    for (let ran = 0; queue.length > 0; ran += 1) {
      if (ran > 1_000) return false;
      queue.shift()?.();
    }
    return true;
  };
  const moved = jest.fn();
  const node = {} as HostInstance;
  let move = () => {};
  try {
    move = focusAfterTransition(() => node, { delay: 300, then: moved });
    announceSafety('Payment held.', 'held');
    expect(drains()).toBe(true);
    jest.advanceTimersByTime(300);
    expect(drains()).toBe(true);
    expect(moved).toHaveBeenCalledTimes(1);
    expect(said).not.toHaveBeenCalled();
    // Heard once the move is made, as ever.
    jest.advanceTimersByTime(FOCUS_SETTLE_MS);
    expect(drains()).toBe(true);
    expect(said.mock.calls).toEqual([['Payment held.', { assertive: true }]]);
  } finally {
    move();
    delete (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback;
  }
});

test('forgetting drops what is waiting, and what comes next is said on its own', () => {
  announceSafety('Request expired.', 'expired');
  // A test that ends here, with its clock thrown away, leaves this unsaid.
  forgetSafety();
  settle();
  expect(said).not.toHaveBeenCalled();
  announceSafety('Address reused.', 'reused');
  settle();
  expect(said.mock.calls).toEqual([['Address reused.', { assertive: true }]]);
});
