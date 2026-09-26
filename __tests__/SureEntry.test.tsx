import React from 'react';
import { act, create } from 'react-test-renderer';
import type {
  EntryAnimationsValues,
  EntryExitAnimationFunction,
  LayoutAnimation,
} from 'react-native-reanimated';
import {
  ENTRY_GRACE_MS,
  endingWith,
  useSureEntry,
} from '../src/motion/sureEntry';
import type { Entrance } from '../src/motion/sureEntry';

/**
 * Entrances that cannot leave a view hidden (src/motion/sureEntry). On a
 * phone a stalled layout animation once left the activity sheet below the
 * screen and the status dot at nothing after a cold launch.
 */
// The grace is a timer; what the UI thread hands back comes as a microtask.
beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }));
afterEach(() => jest.useRealTimers());

const VALUES = {} as EntryAnimationsValues;
/** What the UI thread hands back reaches JavaScript a microtask later. */
const handedBack = () => Promise.resolve().then(() => undefined);
const run = (entering: Entrance | undefined) =>
  (entering as (values: EntryAnimationsValues) => LayoutAnimation)(VALUES);

/** An entrance with a callback of its own, as some presets have. */
function entrance(
  own?: (finished: boolean) => void,
): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0 },
      animations: { opacity: 1 },
      ...(own ? { callback: own } : {}),
    };
  };
}

test('an entrance that ends says so, after its own callback, and keeps its motion', async () => {
  const heard: string[] = [];
  const wrapped = endingWith(
    entrance(() => heard.push('own')),
    () => heard.push('ended'),
  );
  const animation = run(wrapped);
  expect(animation.initialValues).toEqual({ opacity: 0 });
  expect(animation.animations).toEqual({ opacity: 1 });
  animation.callback?.(true);
  await handedBack();
  expect(heard).toEqual(['own', 'ended']);
  // One cut short has ended too: the view is wherever it was left.
  run(endingWith(entrance(), () => heard.push('cut'))).callback?.(false);
  await handedBack();
  expect(heard).toContain('cut');
});

/** Renders a view's sure entry and hands back what it last returned. */
function probe(entering: Entrance | undefined, grace: number) {
  const seen: { current: ReturnType<typeof useSureEntry> | null } = {
    current: null,
  };
  function Probe() {
    seen.current = useSureEntry(entering, grace);
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return { seen };
}

test('an entrance that has not ended within its grace is dropped, and the view drawn again', () => {
  const { seen } = probe(entrance(), 1_000);
  expect(seen.current).toMatchObject({ key: 'entering', state: 'entering' });
  expect(seen.current?.entering).toBeDefined();
  act(() => jest.advanceTimersByTime(999));
  expect(seen.current?.state).toBe('entering');
  act(() => jest.advanceTimersByTime(1));
  expect(seen.current).toMatchObject({
    key: 'rested',
    state: 'stalled',
    entering: undefined,
  });
});

test('an entrance that ends in time keeps its view, however long it then waits', async () => {
  const { seen } = probe(entrance(), 1_000);
  await act(async () => {
    run(seen.current?.entering).callback?.(true);
    await handedBack();
  });
  expect(seen.current).toMatchObject({ key: 'entering', state: 'ended' });
  act(() => jest.advanceTimersByTime(10 * ENTRY_GRACE_MS));
  expect(seen.current).toMatchObject({ key: 'entering', state: 'ended' });
});

test('no entrance has nothing to wait for', () => {
  const { seen } = probe(undefined, 1_000);
  expect(seen.current).toMatchObject({
    key: 'entering',
    state: 'ended',
    entering: undefined,
  });
  act(() => jest.advanceTimersByTime(ENTRY_GRACE_MS));
  expect(seen.current?.key).toBe('entering');
});
