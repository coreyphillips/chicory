import React from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as loops from '../../../motion/loops';
import { durations } from '../../../motion/tokens';
import { Pulse, Rock, Spin } from '../loops';
import { mount } from '../../../../test-support/guard';

/**
 * Receive's endless motions (REDESIGN.md 10.4): the busy orbit, the offline
 * moon and the caret waiting for digits each read the one loop clock, which
 * eases to rest where a loop stops and shares a single AppState subscription
 * however many loops are on screen.
 */
beforeEach(() => {
  AppState.currentState = 'active';
});
afterEach(() => jest.restoreAllMocks());

const still = <View />;

/** The transform or opacity the view around `children` is drawn with. */
const pose = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.type === 'string' && !!node.props?.style)
    .map(node => StyleSheet.flatten(node.props.style))
    .filter(style => style.transform || style.opacity !== undefined);

test('the orbit, the moon and the caret each run on the one loop clock', async () => {
  const clocks = jest.spyOn(loops, 'useLoop');
  const tree = await mount(
    <>
      <Spin>{still}</Spin>
      <Rock>{still}</Rock>
      <Pulse period={1000} low={0}>
        {still}
      </Pulse>
    </>,
  );
  const periods = clocks.mock.calls.map(([period]) => period);
  expect(periods).toEqual(
    expect.arrayContaining([durations.orbit, durations.breathe, 1000]),
  );
  await act(async () => tree.unmount());
});

test('however many loop, they listen for the app going to the background once', async () => {
  // Jest's AppState hands each listener a subscription of its own to remove.
  const listen = jest.mocked(AppState.addEventListener);
  listen.mockClear();
  const live = () =>
    listen.mock.results.filter(
      ({ value }) => jest.mocked(value.remove).mock.calls.length === 0,
    ).length;
  const tree = await mount(
    <>
      {[0, 1, 2].map(i => (
        <Spin key={i}>{still}</Spin>
      ))}
      <Rock>{still}</Rock>
      <Pulse>{still}</Pulse>
    </>,
  );
  expect(live()).toBe(1);
  await act(async () => tree.unmount());
});

test('at rest the orbit is square, the moon level and the caret whole', async () => {
  const tree = await mount(
    <>
      <Spin>{still}</Spin>
      <Rock>{still}</Rock>
      <Pulse low={0}>{still}</Pulse>
    </>,
  );
  const [spin, rock, pulse] = pose(tree);
  expect(spin.transform).toEqual([{ rotate: '0deg' }]);
  expect(rock.transform).toEqual([{ rotate: '0deg' }]);
  expect(pulse.opacity).toBe(1);
  await act(async () => tree.unmount());
});
