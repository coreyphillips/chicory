import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import * as Reanimated from 'react-native-reanimated';
import { ReduceMotion } from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { Circle, Path } from 'react-native-svg';
import { palette } from '../../../design/palette';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { HoldButton } from '../../../glyphs/HoldButton';
import { durations } from '../../../motion/tokens';
import { mount } from '../../../../test-support/guard';
import { activate } from '../../../../test-support/query';
import { GLYPHS } from '../../../design/glyphs';
import { QuoteRefresh } from '../Controls';
import { BANG, DrawnGlyph } from '../DrawnGlyph';
import { Orbit } from '../Orbit';
import { Unplugged, WaitingClock } from '../LoopingGlyphs';
import {
  BOLT_DRAW_MS,
  CHAIN_SLIDE,
  ClosingChain,
  FlashingBolt,
} from '../ErrorGlyphs';
import { FailureMark } from '../FailureMark';
import { sendFailure } from '../model';

/**
 * The hold and the countdown around it (REDESIGN.md 5, HoldButton and
 * ExpiryRing), beyond the contract the shared suite holds them to: the ramp
 * of haptics a hold is felt through, the stages a countdown runs down, the
 * glyphs that move in parts, and what Reduce Motion keeps of each.
 */
const LABEL = 'Send 4,200 sats';

/** The drawn instances of a memoized component, which carry its inner type. */
const drawnOf = (tree: ReactTestRenderer, component: object) =>
  tree.root.findAll(
    node => node.type === (component as { type: unknown }).type,
  );

/** The failure the engine's `code` is drawn as, beside the control. */
const failureFor = (code: string) =>
  sendFailure(Object.assign(new Error(code), { code }), {
    message: code,
    amountSats: null,
  });

const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

/** The hold's long press, as the gesture handler times it. */
const hold = (tree: ReactTestRenderer) =>
  tree.root.findByType(GestureDetector).props.gesture;

/** Each step of a hold, as the gesture handler reports it. */
const press = {
  in: (tree: ReactTestRenderer) =>
    act(async () => hold(tree).config.onBegin({})),
  complete: (tree: ReactTestRenderer) =>
    act(async () => hold(tree).config.onActivate({})),
  out: (tree: ReactTestRenderer) =>
    act(async () => hold(tree).config.onFinalize({ canceled: false })),
};

/** A hold on the canvas, where the gesture handler's root is. */
const onCanvas = (element: React.ReactElement) =>
  mount(<GestureHandlerRootView>{element}</GestureHandlerRootView>);

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
  // A hold's gesture runs on the UI thread and hands back to this one on a
  // microtask, which the fake clock would otherwise hold back.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  jest.mocked(HapticFeedback.trigger).mockClear();
});
afterEach(() => jest.useRealTimers());

describe('HoldButton', () => {
  test('a hold is felt at each quarter and lands with a thud', async () => {
    const onCommit = jest.fn();
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    await press.in(tree);
    expect(felt()).toEqual(['impactLight']);
    await act(async () => jest.advanceTimersByTime(525));
    expect(felt()).toEqual([
      'impactLight',
      'selection',
      'selection',
      'selection',
    ]);
    await press.complete(tree);
    expect(felt().at(-1)).toBe('impactMedium');
    expect(onCommit).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('let go early, nothing commits and the ramp stops', async () => {
    const onCommit = jest.fn();
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} warning />,
    );
    await press.in(tree);
    await act(async () => jest.advanceTimersByTime(300));
    await press.out(tree);
    await act(async () => jest.advanceTimersByTime(2000));
    // With warnings the quarters are 250ms apart: one had passed.
    expect(felt()).toEqual(['impactLight', 'selection']);
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('the long press that times the hold commits it, and nothing commits it twice', async () => {
    const onCommit = jest.fn();
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    // Timed by the gesture handler, where the fill runs, not by a timer on
    // the JavaScript thread.
    expect(hold(tree).config.minDurationMs).toBe(durations.hold);
    await act(async () =>
      fireGestureHandler(hold(tree), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]),
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
    // A screen reader's activate on a hold that has committed adds nothing.
    await activate(tree, LABEL);
    await press.complete(tree);
    expect(onCommit).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('complete, its arrow launches up and to the right', async () => {
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} />,
    );
    expect(arrowSteps(tree)).toEqual(['translateX', 'translateY']);
    await act(async () => tree.unmount());
  });

  test('sending, an orbit runs round the ring', async () => {
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} busy />,
    );
    expect(tree.root.findAllByType(Orbit)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('sending after a warned hold, the orbit is bloom against the honey it held with', async () => {
    const tree = await onCanvas(
      <HoldButton
        accessibilityLabel={LABEL}
        onCommit={jest.fn()}
        warning
        busy
      />,
    );
    expect(tree.root.findByType(Orbit).props.color).toBe(palette.bloom);
    await act(async () => tree.unmount());
  });

  test('while sending, or out of use, the long press is off', async () => {
    for (const busy of [true, false]) {
      const tree = await onCanvas(
        <HoldButton
          accessibilityLabel={LABEL}
          onCommit={jest.fn()}
          busy={busy}
        />,
      );
      expect(hold(tree).config.enabled).toBe(!busy);
      await act(async () => tree.unmount());
    }
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

  test("no route's bolt draws in over 240ms, then flashes", async () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const delay = jest.spyOn(Reanimated, 'withDelay');
    const tree = await mount(<FailureMark failure={failureFor('NO_ROUTE')} />);
    expect(drawnOf(tree, FlashingBolt)).toHaveLength(1);
    const [bolt] = drawnOf(tree, DrawnGlyph);
    expect(bolt.props).toMatchObject({
      name: 'bolt',
      strokes: [{ duration: BOLT_DRAW_MS }],
    });
    // Once drawn, it dims and brightens twice.
    expect(delay).toHaveBeenCalledWith(BOLT_DRAW_MS, expect.anything());
    expect(sequence.mock.calls.some(steps => steps.length === 4)).toBe(true);
    await act(async () => tree.unmount());
    sequence.mockRestore();
    delay.mockRestore();
  });

  test("an unconfirmed funding's chain slides its halves together", async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const tree = await mount(
      <FailureMark failure={failureFor('FUNDING_UNCONFIRMED')} />,
    );
    expect(drawnOf(tree, ClosingChain)).toHaveLength(1);
    const [upper, lower] = GLYPHS.chain;
    const halves = layers(tree, moves('translateY'));
    expect(halves).toEqual([[upper.d], [lower.d]]);
    expect(timing).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ duration: 200 }),
    );
    // They arrive half the slide apart each, along the chain's diagonal, the
    // upper half up and right and the lower down and left, and close to 0.
    const step = CHAIN_SLIDE / 2 / Math.SQRT2;
    const arriving = tree.root
      .findAll(
        node =>
          typeof node.type === 'string' &&
          [node.props.style]
            .flat(3)
            .some(style => !!style && moves('translateY')(style)),
      )
      .map(node => StyleSheet.flatten(node.props.style).transform);
    expect(arriving).toEqual([
      [{ translateX: step }, { translateY: -step }],
      [{ translateX: -step }, { translateY: step }],
    ]);
    await act(async () => tree.unmount());
    timing.mockRestore();
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
    const tree = await onCanvas(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    expect(arrowSteps(tree)).toEqual([]);
    await press.in(tree);
    await act(async () => jest.advanceTimersByTime(525));
    expect(felt()).toEqual([
      'impactLight',
      'selection',
      'selection',
      'selection',
    ]);
    await press.complete(tree);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(felt().at(-1)).toBe('impactMedium');
    await act(async () => tree.unmount());
  });

  /** The timings started while `run` runs, and where each was headed. */
  async function timed(run: () => Promise<void>) {
    const timings = jest.spyOn(Reanimated, 'withTiming');
    await run();
    const started = timings.mock.calls.map(([to, config]) => ({
      to,
      duration: config?.duration,
      reduceMotion: config?.reduceMotion,
    }));
    timings.mockRestore();
    return started;
  }

  test('a send that comes back without a result fades its arrow back', async () => {
    const element = (busy: boolean) => (
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} busy={busy} />
    );
    // The commit's own fades are held to it in hold.test.ts.
    const tree = await onCanvas(element(false));
    await press.complete(tree);
    await act(async () =>
      tree.update(
        <GestureHandlerRootView>{element(true)}</GestureHandlerRootView>,
      ),
    );
    const returning = await timed(() =>
      act(async () =>
        tree.update(
          <GestureHandlerRootView>{element(false)}</GestureHandlerRootView>,
        ),
      ),
    );
    expect(returning).toEqual([
      {
        to: 0,
        duration: durations.crossfade,
        reduceMotion: ReduceMotion.Never,
      },
    ]);
    await act(async () => tree.unmount());
  });

  test("a quote's arrow crossfades to the refresh rather than cutting", async () => {
    let tree!: ReactTestRenderer;
    const mounting = await timed(async () => {
      tree = await mount(
        <GestureHandlerRootView>
          <QuoteRefresh onPress={jest.fn()} busy={false} />
        </GestureHandlerRootView>,
      );
    });
    const fades = mounting.filter(
      timing => timing.duration === durations.crossfade,
    );
    expect(fades.length).toBeGreaterThan(0);
    for (const fade of fades) {
      expect(fade.reduceMotion).toBe(ReduceMotion.Never);
    }
    await act(async () => tree.unmount());
  });
});
