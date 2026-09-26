import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
  afterTransition,
  beginTransition,
  isTransitioning,
} from '../src/motion/idle';
import { useTransitionLock } from '../src/motion/useTransitionLock';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  // Any transition a test left open ends on its safety timeout here, so the
  // registry starts every test idle.
  jest.runAllTimers();
  expect(isTransitioning()).toBe(false);
  jest.useRealTimers();
});

test('queued work waits for the transition, then for an idle moment', () => {
  const end = beginTransition(300);
  const work = jest.fn();
  afterTransition(work);
  jest.advanceTimersByTime(200);
  expect(isTransitioning()).toBe(true);
  expect(work).not.toHaveBeenCalled();

  end();
  expect(isTransitioning()).toBe(false);
  expect(work).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(work).toHaveBeenCalledTimes(1);
});

test('with nothing moving, work still waits for the next idle moment', () => {
  const work = jest.fn();
  afterTransition(work);
  expect(work).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(work).toHaveBeenCalledTimes(1);
});

test('work waits for every overlapping transition', () => {
  const first = beginTransition(300);
  const second = beginTransition(300);
  const work = jest.fn();
  afterTransition(work);
  first();
  jest.runOnlyPendingTimers();
  expect(work).not.toHaveBeenCalled();
  second();
  jest.runOnlyPendingTimers();
  expect(work).toHaveBeenCalledTimes(1);
});

test('a transition that starts before the idle moment holds the work again', () => {
  const work = jest.fn();
  afterTransition(work);
  const end = beginTransition(300);
  jest.runOnlyPendingTimers();
  expect(work).not.toHaveBeenCalled();
  end();
  jest.runOnlyPendingTimers();
  expect(work).toHaveBeenCalledTimes(1);
});

test('end is idempotent', () => {
  const onEnd = jest.fn();
  const first = beginTransition(300, onEnd);
  const second = beginTransition(300);
  first();
  first();
  expect(isTransitioning()).toBe(true);
  second();
  expect(isTransitioning()).toBe(false);
  jest.advanceTimersByTime(1000);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

test('the safety timeout ends a forgotten transition', () => {
  const onEnd = jest.fn();
  const work = jest.fn();
  beginTransition(300, onEnd);
  afterTransition(work);
  jest.advanceTimersByTime(419);
  expect(isTransitioning()).toBe(true);

  jest.advanceTimersByTime(1);
  expect(isTransitioning()).toBe(false);
  expect(onEnd).toHaveBeenCalledTimes(1);
  jest.runOnlyPendingTimers();
  expect(work).toHaveBeenCalledTimes(1);
});

test('cancelled work never runs', () => {
  const end = beginTransition(300);
  const work = jest.fn();
  const cancel = afterTransition(work);
  cancel();
  end();
  jest.runAllTimers();
  expect(work).not.toHaveBeenCalled();
});

test('the runtime idle callback is used when there is one, with a 500ms cap', () => {
  const idle = jest.fn((callback: () => void) => setTimeout(callback, 0));
  Object.assign(globalThis, { requestIdleCallback: idle });
  try {
    const work = jest.fn();
    afterTransition(work);
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
    jest.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(1);
  } finally {
    delete (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback;
  }
});

describe('useTransitionLock', () => {
  let lock!: ReturnType<typeof useTransitionLock>;
  let tree: ReactTestRenderer | null = null;
  function Probe() {
    lock = useTransitionLock();
    return null;
  }

  async function mount() {
    await act(async () => {
      tree = create(React.createElement(Probe));
    });
  }

  // Unmounted inside act, so a transition a test leaves open ends there and
  // not on a timer outside it.
  afterEach(async () => {
    const mounted = tree;
    tree = null;
    if (mounted) await act(async () => mounted.unmount());
  });

  test('blocks from begin until the last overlapping move ends', async () => {
    await mount();
    expect(lock.blocking).toBe(false);
    let first!: () => void;
    let second!: () => void;
    await act(async () => {
      first = lock.begin(320);
      second = lock.begin(320);
    });
    expect(lock.active.current).toBe(true);
    expect(lock.blocking).toBe(true);

    await act(async () => first());
    expect(lock.blocking).toBe(true);
    await act(async () => second());
    expect(lock.active.current).toBe(false);
    expect(lock.blocking).toBe(false);
  });

  test('the ref flips before React re-renders', async () => {
    await mount();
    let active = false;
    await act(async () => {
      lock.begin(320);
      active = lock.active.current;
    });
    expect(active).toBe(true);
  });

  test('releases on the safety timeout', async () => {
    await mount();
    await act(async () => {
      lock.begin(320);
    });
    await act(async () => {
      jest.advanceTimersByTime(440);
    });
    expect(lock.blocking).toBe(false);
    expect(isTransitioning()).toBe(false);
  });

  test('unmounting mid-move frees the registry at once', async () => {
    await mount();
    await act(async () => {
      lock.begin(320);
    });
    expect(isTransitioning()).toBe(true);
    const mounted = tree!;
    tree = null;
    await act(async () => mounted.unmount());
    expect(isTransitioning()).toBe(false);
  });
});
