import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { Circle, Path } from 'react-native-svg';
import { palette } from '../../../design/palette';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { HoldButton } from '../../../glyphs/HoldButton';
import { mount } from '../../../../test-support/guard';
import { GLYPHS } from '../../../design/glyphs';
import { BANG, DrawnGlyph } from '../DrawnGlyph';
import { Orbit } from '../Orbit';
import { Unplugged, WaitingClock } from '../LoopingGlyphs';

/**
 * The hold and the countdown around it (REDESIGN.md 5, HoldButton and
 * ExpiryRing), beyond the contract the shared suite holds them to: the ramp
 * of haptics a hold is felt through, the stages a countdown runs down, the
 * glyphs that move in parts, and what Reduce Motion keeps of each.
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

/** The steps of the transform on the view that moves the hold's arrow. */
function arrowSteps(tree: ReactTestRenderer): string[] {
  const [arrow] = GLYPHS.send;
  let at: ReactTestInstance | null = tree.root
    .findAllByType(Path)
    .find(path => path.props.d === arrow.d)!;
  while (at && !StyleSheet.flatten(at.props.style)?.transform) at = at.parent;
  const { transform } = StyleSheet.flatten(at?.props.style);
  return transform.flatMap((step: object) => Object.keys(step));
}

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

  test('complete, its arrow launches up and to the right', async () => {
    const tree = await mount(
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} />,
    );
    expect(arrowSteps(tree)).toEqual(['translateX', 'translateY']);
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

/**
 * The paths on each layer whose own style passes `test`, in order, as the
 * moving parts of a glyph are found.
 */
const layers = (
  tree: ReactTestRenderer,
  test: (style: Record<string, unknown>) => boolean,
) =>
  tree.root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        [node.props.style].flat(3).some(style => !!style && test(style)),
    )
    .map(node => node.findAllByType(Path).map(path => path.props.d));

/** Whether a style moves by a transform step named `name`. */
const moves = (name: string) => (style: Record<string, unknown>) =>
  Array.isArray(style.transform) &&
  style.transform.some((step: object) => name in step);

describe('a glyph that moves in parts', () => {
  test('the bang draws its line, then pops its dot from where it sits', async () => {
    const tree = await mount(
      <DrawnGlyph
        name="bang"
        size={48}
        color={palette.radish}
        strokes={BANG}
      />,
    );
    const [line, dot] = GLYPHS.bang;
    expect(tree.root.findAllByType(Path).map(path => path.props.d)).toEqual([
      line.d,
      dot.d,
    ]);
    // The dot sits on a layer of its own, which scales about the dot.
    const popped = layers(
      tree,
      style => style.transformOrigin === `50% ${(18.5 / 24) * 100}%`,
    );
    expect(popped).toEqual([[dot.d]]);
    await act(async () => tree.unmount());
  });

  test('the waiting clock turns only its minute hand, on a layer of its own', async () => {
    const tree = await mount(<WaitingClock size={16} color={palette.honey} />);
    const [face, minute, hour] = GLYPHS.clock;
    expect(layers(tree, moves('rotate'))).toEqual([[minute.d]]);
    expect(tree.root.findAllByType(Path).map(path => path.props.d)).toEqual([
      face.d,
      hour.d,
      minute.d,
    ]);
    await act(async () => tree.unmount());
  });

  test('the unplug drifts its halves apart round a still spark', async () => {
    const tree = await mount(<Unplugged size={22} color={palette.honey} />);
    const [left, right, spark] = GLYPHS.unplug;
    expect(layers(tree, moves('translateX'))).toEqual([[left.d], [right.d]]);
    expect(tree.root.findAllByType(Path)[0].props.d).toBe(spark.d);
    await act(async () => tree.unmount());
  });
});

// Last in the file: Reduce Motion, once read, holds for the rest of it.
describe('under Reduce Motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  test('the hold is still felt and still commits, but its arrow only fades', async () => {
    const onCommit = jest.fn();
    const tree = await mount(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    expect(arrowSteps(tree)).toEqual([]);
    await act(async () => hold(tree).props.onPressIn());
    await act(async () => jest.advanceTimersByTime(525));
    expect(felt()).toEqual([
      'impactLight',
      'selection',
      'selection',
      'selection',
    ]);
    await act(async () => hold(tree).props.onLongPress());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(felt().at(-1)).toBe('impactMedium');
    await act(async () => tree.unmount());
  });
});
