import React from 'react';
import { AppState, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Circle, G } from 'react-native-svg';
import { palette } from '../../../design/palette';
import { durations } from '../../../motion/tokens';
import { mount } from '../../../../test-support/guard';
import { COMET, Comet, behindHead, cometTail } from '../Comet';

/**
 * The comet (REDESIGN.md 5, Comet): the head and the tail that stand in for
 * the orbit's plain arc while money is on its way, one still drawing that
 * only turns, on a clock of its own or the one it is handed.
 */
beforeEach(() => {
  AppState.currentState = 'active';
});
afterEach(() => jest.restoreAllMocks());

/** The views whose transform turns, with the comet's single rotate. */
const turning = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      (StyleSheet.flatten(node.props.style)?.transform ?? []).some(
        (step: object) => 'rotate' in step,
      ),
  );

const C = 44;
const R = C - 2;

test('its tail covers the ring behind the head in arcs that fade away', () => {
  const tail = cometTail();
  expect(tail).toHaveLength(COMET.segments);
  expect(tail[0].from).toBe(0);
  expect(tail[tail.length - 1].to).toBeCloseTo(COMET.tail);
  for (let i = 1; i < tail.length; i++) {
    expect(tail[i].from).toBeCloseTo(tail[i - 1].to);
    expect(tail[i].opacity).toBeLessThan(tail[i - 1].opacity);
  }
  expect(tail[0].opacity).toBeLessThanOrEqual(1);
  expect(tail[tail.length - 1].opacity).toBeGreaterThan(0);
});

test('a dash set behind the head starts at twelve and runs the other way round', () => {
  expect(behindHead(C)).toBe('translate(88 0) scale(-1 1) rotate(-90 44 44)');
});

test('one still drawing turns, set off from the arrow heading, passed over by a screen reader', async () => {
  const tree = await mount(
    <Comet size={2 * C} stroke={4} color={palette.bloom} />,
  );
  const turns = turning(tree);
  expect(turns).toHaveLength(1);
  expect(turns[0].props.pointerEvents).toBe('none');
  expect(turns[0].props.importantForAccessibility).toBe('no-hide-descendants');
  const heading = tree.root
    .findAllByType(G)
    .find(g => g.props.transform === `rotate(${COMET.heading} ${C} ${C})`);
  expect(heading).toBeDefined();
  const head = tree.root
    .findAllByType(Circle)
    .find(circle => circle.props.fill === palette.bloom);
  expect(head?.props).toMatchObject({ cx: C, cy: C - R, r: COMET.head / 2 });
  // The tail's arcs each sit behind the head, going the other way round.
  const arcs = tree.root
    .findAllByType(Circle)
    .filter(circle => circle.props.strokeDashoffset !== undefined);
  expect(arcs).toHaveLength(COMET.segments);
  for (const arc of arcs) {
    expect(arc.props.transform).toBe(behindHead(C));
    expect(arc.props.strokeDashoffset).toBeLessThanOrEqual(0);
  }
  // Nothing of the ring has closed, so the closing arc shows nothing.
  const closing = tree.root
    .findAllByType(Circle)
    .find(circle => circle.props.animatedProps?.strokeOpacity !== undefined);
  expect(closing?.props.animatedProps.strokeOpacity).toBe(0);
  await act(async () => tree.unmount());
});

test('on a clock of its own it turns once an orbit; handed one, it starts none', async () => {
  const repeats = jest.spyOn(Reanimated, 'withRepeat');
  const timings = jest.spyOn(Reanimated, 'withTiming');
  const own = await mount(<Comet size={88} stroke={4} color={palette.bloom} />);
  expect(repeats).toHaveBeenCalledTimes(1);
  expect(timings).toHaveBeenCalledWith(
    expect.any(Number),
    expect.objectContaining({ duration: durations.orbit }),
  );
  await act(async () => own.unmount());

  repeats.mockClear();
  function Handed() {
    const clock = Reanimated.useSharedValue(0.25);
    return <Comet size={88} stroke={4} color={palette.slate} clock={clock} />;
  }
  const handed = await mount(<Handed />);
  expect(repeats).not.toHaveBeenCalled();
  // A quarter of a turn in, it is a quarter of the way round.
  expect(StyleSheet.flatten(turning(handed)[0].props.style).transform).toEqual([
    { rotate: '90deg' },
  ]);
  await act(async () => handed.unmount());
});

test('closing, the tail gives way to one arc that grows back from the head', async () => {
  function Closing({ to }: { to: number }) {
    const closing = Reanimated.useSharedValue(to);
    return (
      <Comet size={88} stroke={4} color={palette.bloom} closing={closing} />
    );
  }
  const tree = await mount(<Closing to={0.5} />);
  const around = 2 * Math.PI * R;
  const tail = tree.root
    .findAllByType(G)
    .find(group => group.props.animatedProps?.opacity !== undefined);
  expect(tail?.props.animatedProps.opacity).toBeCloseTo(0.5);
  const arc = tree.root
    .findAllByType(Circle)
    .find(circle => circle.props.animatedProps?.strokeOpacity !== undefined);
  expect(arc?.props.animatedProps).toEqual({
    strokeDashoffset: around * 0.5,
    strokeOpacity: 1,
  });
  await act(async () => tree.unmount());
});
