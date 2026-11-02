import React from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { palette } from '../../../design/palette';
import * as tokens from '../../../motion/tokens';
import { durations, springs } from '../../../motion/tokens';
import { PANE_SETTLE_MS } from '../../../stage/layout';
import { mount } from '../../../../test-support/guard';
import {
  ARRIVE_MS,
  CHECK_LEAD,
  CLOSE_MS,
  FILL_MS,
  MARK,
  TRAVEL_FROM,
  arrivalBeats,
  travelPose,
  watchCentre,
} from '../arrival';
import type { Arrival } from '../arrival';
import { Comet } from '../Comet';
import { CONTROL } from '../Controls';
import { DrawnGlyph } from '../DrawnGlyph';
import { heldVisual, resultVisual } from '../model';
import { PLACE_LATEST, ResultMark } from '../ResultMark';

/**
 * A result growing out of the hold that sent it (REDESIGN.md 6, Send and 7,
 * T7): the pose on the way, the beats of a landing, the reading of where
 * the mark rests, and the mark itself setting out from the hold's centre
 * with the hold's look and comet before its face takes over.
 */
const FROM = { x: 201, y: 752 };
const REST = { x: 201, y: 400 };

/** The drawn instances of a memoized component, which carry its inner type. */
const drawnOf = (tree: ReactTestRenderer, component: object) =>
  tree.root.findAll(
    node => node.type === (component as { type: unknown }).type,
  );

/** The anchor the mark is measured against: it never moves. */
const anchorOf = (tree: ReactTestRenderer) =>
  tree.root.find(
    node =>
      node.type === View &&
      node.props.collapsable === false &&
      typeof node.props.onLayout === 'function',
  );

/** Tells the anchor where it rests, as the device would on its layout. */
async function placeAt(tree: ReactTestRenderer, at = REST) {
  const anchor = anchorOf(tree);
  jest
    .mocked(anchor.instance.measureInWindow)
    .mockImplementation(
      (done: (x: number, y: number, w: number, h: number) => void) =>
        done(at.x - MARK / 2, at.y - MARK / 2, MARK, MARK),
    );
  await act(async () => anchor.props.onLayout());
  return anchor;
}

beforeEach(() => {
  jest.useFakeTimers();
  // Shared values live as long as their component, as on a device.
  const made = Reanimated.useSharedValue;
  jest
    .spyOn(Reanimated, 'useSharedValue')
    .mockImplementation(init => React.useState(() => made(init))[0]);
});
/** Every view measures through one mock, which keeps what a test taught it. */
const unmeasured = () =>
  (
    View.prototype as unknown as { measureInWindow: jest.Mock }
  ).measureInWindow.mockReset();

afterEach(() => {
  jest.restoreAllMocks();
  unmeasured();
  jest.useRealTimers();
});

describe('the pose on the way', () => {
  test('starts at the hold, the hold size, and ends where the mark rests, whole', () => {
    expect(TRAVEL_FROM).toBe(CONTROL / MARK);
    const start = travelPose(0, FROM, REST);
    expect(start).toEqual({
      translateX: 0,
      translateY: FROM.y - REST.y,
      scale: TRAVEL_FROM,
    });
    const end = travelPose(1, FROM, REST);
    expect(end).toEqual({ translateX: 0, translateY: 0, scale: 1 });
    let last = start;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const pose = travelPose(t, FROM, REST);
      expect(Math.abs(pose.translateY)).toBeLessThan(Math.abs(last.translateY));
      expect(pose.scale).toBeGreaterThan(last.scale);
      last = pose;
    }
    // Past either end it stays put.
    expect(travelPose(1.4, FROM, REST)).toEqual(end);
    expect(travelPose(-0.3, FROM, REST)).toEqual(start);
  });
});

describe('the beats of a landing', () => {
  test('a payment that went through closes the ring, fills it, then draws its check', () => {
    expect(arrivalBeats(true)).toEqual({
      close: CLOSE_MS,
      fill: CLOSE_MS,
      check: CLOSE_MS + CHECK_LEAD,
      arrive: ARRIVE_MS,
      gone: CLOSE_MS + FILL_MS,
    });
    expect(CLOSE_MS).toBe(durations.move);
    expect(FILL_MS).toBe(durations.enter);
    expect(ARRIVE_MS).toBe(PANE_SETTLE_MS);
  });

  test("any other face takes over from the hold's look as the mark lands", () => {
    expect(arrivalBeats(false)).toEqual({
      close: 0,
      fill: 0,
      check: ARRIVE_MS,
      arrive: ARRIVE_MS,
      gone: ARRIVE_MS + durations.crossfade,
    });
  });
});

describe('reading where something rests', () => {
  test('follows it until two readings agree, then stops', async () => {
    const tops = [720, 714, 710, 708, 708, 708];
    const node = {
      measureInWindow: jest.fn(
        (done: (x: number, y: number, w: number, h: number) => void) =>
          done(157, tops.shift() ?? 708, 88, 88),
      ),
    };
    const read = jest.fn();
    const stop = watchCentre(() => node as never, read);
    for (let frame = 0; frame < 8; frame++) {
      await act(async () => jest.advanceTimersByTime(16));
    }
    expect(read.mock.calls.map(([at]) => at.y)).toEqual([764, 758, 754, 752]);
    expect(read).toHaveBeenLastCalledWith({ x: 201, y: 752 });
    // Two readings agreed, so it stopped reading.
    expect(node.measureInWindow).toHaveBeenCalledTimes(5);
    stop();
  });

  test('a reading without a size, or after it is cancelled, says nothing', () => {
    const empty = {
      measureInWindow: jest.fn(
        (done: (x: number, y: number, w: number, h: number) => void) =>
          done(0, 0, 0, 0),
      ),
    };
    const read = jest.fn();
    watchCentre(() => empty as never, read);
    expect(read).not.toHaveBeenCalled();
    let answer: ((x: number, y: number, w: number, h: number) => void) | null =
      null;
    const late = { measureInWindow: jest.fn(done => (answer = done)) };
    const stop = watchCentre(() => late as never, read);
    stop();
    answer!(0, 0, 88, 88);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the mark growing out of the hold', () => {
  function Growing({
    status,
    arrival,
    onArrived,
    resting,
  }: {
    status: 'completed' | 'failed' | 'pending' | 'uncertain';
    arrival: Arrival | null;
    onArrived?: () => void;
    resting?: boolean;
  }) {
    const visual = { ...resultVisual(status), resting };
    return (
      <ResultMark
        visual={visual}
        accessibilityLabel={visual.title}
        accessibilityValue=""
        accessibilityHint=""
        arrival={arrival}
        onArrived={onArrived}
      />
    );
  }

  /** An arrival from the hold, on a clock of the test's own. */
  function Arriving({
    status,
    onArrived,
    resting,
    warned = false,
  }: {
    status: 'completed' | 'failed' | 'pending' | 'uncertain';
    onArrived?: () => void;
    resting?: boolean;
    warned?: boolean;
  }) {
    const clock = Reanimated.useSharedValue(0.4);
    return (
      <Growing
        status={status}
        arrival={{ from: FROM, clock, warned }}
        onArrived={onArrived}
        resting={resting}
      />
    );
  }

  /** The travelling view's style, as the mark is drawn now. */
  const travelling = (tree: ReactTestRenderer) => {
    const drawn = (node: ReactTestInstance) =>
      StyleSheet.flatten(node.props.style) ?? {};
    const [view] = anchorOf(tree).findAll(
      node =>
        typeof node.type === 'string' &&
        'opacity' in drawn(node) &&
        'transform' in drawn(node),
    );
    return drawn(view);
  };

  test('is unseen until it knows where it rests, then sets out from the hold on the pane spring', async () => {
    const springs$ = jest.spyOn(Reanimated, 'withSpring');
    const tree = await mount(<Arriving status="completed" />);
    expect(travelling(tree).opacity).toBe(0);
    expect(springs$).not.toHaveBeenCalled();
    await placeAt(tree);
    expect(springs$).toHaveBeenCalledWith(1, springs.pane);
    // Drawn again, it is seen, where it rests.
    await act(async () => tree.update(<Arriving status="completed" />));
    expect(travelling(tree)).toMatchObject({
      opacity: 1,
      transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
    });
    await act(async () => tree.unmount());
  });

  test("sets out with the hold's look and its comet on the hold's clock, honey where the hold was warned", async () => {
    const tree = await mount(<Arriving status="completed" warned />);
    const [comet] = tree.root.findAllByType(Comet);
    expect(comet.props.clock.get()).toBe(0.4);
    expect(comet.props.closing).toBeDefined();
    const ground = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.style?.some?.(
          (part: { backgroundColor?: string }) =>
            part?.backgroundColor === palette.honeySoft,
        ),
    );
    expect(ground).toBeDefined();
    await act(async () => tree.unmount());
    const calm = await mount(<Arriving status="completed" />);
    expect(
      calm.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.style?.some?.(
            (part: { backgroundColor?: string }) =>
              part?.backgroundColor === palette.bloomSoft,
          ),
      ),
    ).toHaveLength(1);
    await act(async () => calm.unmount());
  });

  test('a payment that went through closes the ring and fills it, then its check draws', async () => {
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const tree = await mount(<Arriving status="completed" />);
    // Its face waits to be placed, so the check counts from the same moment
    // as the ring's closing and the cream.
    expect(drawnOf(tree, DrawnGlyph)).toHaveLength(0);
    timings.mockClear();
    delays.mockClear();
    await placeAt(tree);
    expect(drawnOf(tree, DrawnGlyph)[0].props.strokes).toEqual([
      { duration: durations.draw, delay: CLOSE_MS + CHECK_LEAD },
    ]);
    const started = timings.mock.calls.map(([to, config]) => ({
      to,
      duration: config?.duration,
    }));
    expect(started).toEqual(
      expect.arrayContaining([
        { to: 1, duration: CLOSE_MS },
        { to: 1, duration: FILL_MS },
      ]),
    );
    // The cream waits for the ring to close, and the check for the cream.
    expect(delays.mock.calls.map(([ms]) => ms)).toEqual([
      CLOSE_MS,
      CLOSE_MS + CHECK_LEAD,
    ]);
    await act(async () => tree.unmount());
  });

  test("any other face fades in over the hold's look as the mark lands, its glyph waiting for it", async () => {
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const tree = await mount(<Arriving status="failed" />);
    expect(drawnOf(tree, DrawnGlyph)).toHaveLength(0);
    delays.mockClear();
    await placeAt(tree);
    expect(drawnOf(tree, DrawnGlyph)[0].props.strokes).toEqual([
      { duration: 200, delay: ARRIVE_MS },
      { pop: { x: 12, y: 18.5 }, delay: 200 + ARRIVE_MS },
    ]);
    // The hold's look and the face crossfade as the mark lands, and the
    // bang's line and then its dot wait for the landing.
    const waited = delays.mock.calls.map(([ms]) => ms).sort((a, b) => a - b);
    expect(waited).toEqual([ARRIVE_MS, ARRIVE_MS, ARRIVE_MS, 200 + ARRIVE_MS]);
    await act(async () => tree.unmount());
  });

  test('a failure shakes only once the mark has landed', async () => {
    const shakes = jest.spyOn(tokens, 'shake');
    const tree = await mount(<Arriving status="failed" />);
    expect(shakes).not.toHaveBeenCalled();
    // Not yet placed, it has not landed, so nothing shakes.
    await act(async () => jest.advanceTimersByTime(200));
    await placeAt(tree);
    await act(async () => jest.advanceTimersByTime(ARRIVE_MS - 1));
    expect(shakes).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(shakes).toHaveBeenCalled();
    await act(async () => tree.unmount());
    // Popping in where it rests, it shakes at once.
    shakes.mockClear();
    const resting = await mount(<Growing status="failed" arrival={null} />);
    expect(shakes).toHaveBeenCalled();
    await act(async () => resting.unmount());
  });

  test("the hold's look goes once the mark is its own, and says so", async () => {
    const onArrived = jest.fn();
    const tree = await mount(
      <Arriving status="completed" onArrived={onArrived} />,
    );
    expect(tree.root.findAllByType(Comet)).toHaveLength(1);
    await placeAt(tree);
    await act(async () => jest.advanceTimersByTime(CLOSE_MS + FILL_MS - 1));
    expect(onArrived).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onArrived).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByType(Comet)).toHaveLength(0);
    // Said once: going later, it has nothing more to say.
    await act(async () => tree.unmount());
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  test('one clock: a mark placed late, or never, runs every beat from the moment it is placed', async () => {
    const onArrived = jest.fn();
    const late = await mount(
      <Arriving status="completed" onArrived={onArrived} />,
    );
    await act(async () => jest.advanceTimersByTime(200));
    await placeAt(late);
    await act(async () => jest.advanceTimersByTime(CLOSE_MS + FILL_MS - 1));
    expect(onArrived).not.toHaveBeenCalled();
    expect(late.root.findAllByType(Comet)).toHaveLength(1);
    await act(async () => jest.advanceTimersByTime(1));
    expect(onArrived).toHaveBeenCalledTimes(1);
    await act(async () => late.unmount());
    // Never placed, it is drawn where it rests at PLACE_LATEST, its face
    // with it, and its beats run from there.
    onArrived.mockClear();
    unmeasured();
    const unplaced = await mount(
      <Arriving status="completed" onArrived={onArrived} />,
    );
    expect(drawnOf(unplaced, DrawnGlyph)).toHaveLength(0);
    await act(async () => jest.advanceTimersByTime(PLACE_LATEST));
    expect(drawnOf(unplaced, DrawnGlyph)).toHaveLength(1);
    await act(async () => jest.advanceTimersByTime(CLOSE_MS + FILL_MS - 1));
    expect(onArrived).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onArrived).toHaveBeenCalledTimes(1);
    await act(async () => unplaced.unmount());
  });

  test("gone before the hold's look has given way, the mark says so as it goes", async () => {
    const onArrived = jest.fn();
    const tree = await mount(
      <Arriving status="failed" onArrived={onArrived} />,
    );
    await placeAt(tree);
    await act(async () => jest.advanceTimersByTime(100));
    await act(async () => tree.unmount());
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  test("a held ring that grew out of the hold keeps its lead as it resolves, and the disc's check takes its own", async () => {
    function HeldThenPaid({ paid }: { paid: boolean }) {
      const clock = Reanimated.useSharedValue(0);
      const visual = paid
        ? heldVisual('completed', true)
        : heldVisual('pending');
      return (
        <ResultMark
          visual={visual}
          accessibilityLabel={visual.title}
          accessibilityValue=""
          accessibilityHint=""
          arrival={{ from: FROM, clock, warned: false }}
        />
      );
    }
    const tree = await mount(<HeldThenPaid paid={false} />);
    await placeAt(tree);
    await act(async () =>
      jest.advanceTimersByTime(ARRIVE_MS + durations.crossfade),
    );
    await act(async () => tree.update(<HeldThenPaid paid />));
    const glyphs = drawnOf(tree, DrawnGlyph);
    const pause = glyphs.find(glyph => glyph.props.name === 'pause');
    const check = glyphs.find(glyph => glyph.props.name === 'check');
    expect(pause?.props.strokes).toEqual([
      { pop: { x: 9, y: 12 }, delay: ARRIVE_MS },
      { pop: { x: 15, y: 12 }, delay: 60 + ARRIVE_MS },
    ]);
    expect(check?.props.strokes).toEqual([
      { duration: durations.draw, delay: CHECK_LEAD },
    ]);
    await act(async () => tree.unmount());
  });

  test('never left unseen: a mark that cannot be placed is drawn where it rests', async () => {
    const springs$ = jest.spyOn(Reanimated, 'withSpring');
    const tree = await mount(<Arriving status="completed" />);
    await act(async () => jest.advanceTimersByTime(PLACE_LATEST));
    await act(async () => tree.update(<Arriving status="completed" />));
    expect(travelling(tree)).toMatchObject({ opacity: 1 });
    // Not sprung: it is simply there.
    expect(springs$).not.toHaveBeenCalledWith(1, springs.pane);
    await act(async () => tree.unmount());
  });

  test('a mark at rest, or one with nothing to grow out of, pops in where it rests', async () => {
    const paid = await mount(<Arriving status="completed" resting />);
    expect(paid.root.findAllByType(Comet)).toHaveLength(0);
    expect(travelling(paid).opacity).toBe(1);
    await act(async () => paid.unmount());
    const popped = await mount(<Growing status="completed" arrival={null} />);
    expect(popped.root.findAllByType(Comet)).toHaveLength(0);
    const anchor = anchorOf(popped);
    const [view] = anchor.findAll(
      node => typeof node.type !== 'string' && 'entering' in node.props,
    );
    expect(view.props.entering).toEqual(expect.any(Function));
    expect(drawnOf(popped, DrawnGlyph)[0].props.strokes).toEqual([
      { duration: durations.draw, delay: CHECK_LEAD },
    ]);
    await act(async () => popped.unmount());
  });

  test('the held ring grows out of the hold too, its pause waiting for the landing', async () => {
    const visual = heldVisual('pending');
    function HeldArriving() {
      const clock = Reanimated.useSharedValue(0);
      return (
        <ResultMark
          visual={visual}
          accessibilityLabel={visual.title}
          accessibilityValue=""
          accessibilityHint=""
          arrival={{ from: FROM, clock, warned: false }}
        />
      );
    }
    const tree = await mount(<HeldArriving />);
    expect(tree.root.findAllByType(Comet)).toHaveLength(1);
    await placeAt(tree);
    const pause = drawnOf(tree, DrawnGlyph).find(
      glyph => glyph.props.name === 'pause',
    );
    expect(pause?.props.strokes).toEqual([
      { pop: { x: 9, y: 12 }, delay: ARRIVE_MS },
      { pop: { x: 15, y: 12 }, delay: 60 + ARRIVE_MS },
    ]);
    await act(async () => tree.unmount());
  });
});

// Reduce Motion, once read, holds for the rest of the file.
describe('under Reduce Motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  test('nothing travels: the mark is simply there, with no comet', async () => {
    function Still() {
      const clock = Reanimated.useSharedValue(0);
      const visual = resultVisual('completed');
      return (
        <ResultMark
          visual={visual}
          accessibilityLabel={visual.title}
          accessibilityValue=""
          accessibilityHint=""
          arrival={{ from: FROM, clock, warned: false }}
        />
      );
    }
    // The setting is read as the first caller mounts, so one mark comes
    // and goes before the flag holds for the one under test.
    const first = await mount(<Still />);
    await act(async () => first.unmount());
    const tree = await mount(<Still />);
    expect(tree.root.findAllByType(Comet)).toHaveLength(0);
    expect(arrivalBeats(true)).toEqual({
      close: 0,
      fill: 0,
      check: 0,
      arrive: 0,
      gone: durations.crossfade,
    });
    await act(async () => tree.unmount());
  });
});
