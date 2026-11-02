import React from 'react';
import { StyleSheet } from 'react-native';
import {
  GestureHandlerRootView,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import type {
  PanGestureConfig,
  TapGestureConfig,
} from 'react-native-gesture-handler';
import * as Worklets from 'react-native-worklets';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { FeeRates } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { useMotionPrefs } from '../../../motion/useMotionPrefs';
import { Pane } from '../../../stage/panes/Pane';
import { whispers } from '../../../../test-support/query';
import { FeeSlider } from '../FeeSlider';
import type { FeeSliderProps } from '../FeeSlider';
import {
  QUIET_RING,
  feeAnchors,
  feeSpoken,
  positionOf,
  rateAt,
  positionAtX,
  thumbCentre,
  travelOf,
} from '../feeTrack';
import { TestNetwork } from '../tone';

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({ children }: { children: unknown }) => children,
    usePanGesture: jest.fn((config: unknown) => config),
    useTapGesture: jest.fn((config: unknown) => config),
    useCompetingGestures: jest.fn((...gestures: unknown[]) => gestures),
  };
});
jest.mock('../../../motion/useMotionPrefs', () => ({
  useMotionPrefs: jest.fn(() => ({ reduced: false })),
}));

/**
 * The fee rate slider (REDESIGN.md 6, Send): a control with no words on it
 * that a screen reader adjusts and a finger drags, each whole rate felt, and
 * that is held back, quiet, when nothing can be chosen.
 */
const RATES: FeeRates = { fast: 20, normal: 12, slow: 8, minimum: 1 };
const ANCHORS = feeAnchors(RATES, 1, 40);
const WIDTH = 236;

const props = (over: Partial<FeeSliderProps> = {}): FeeSliderProps => ({
  rate: 12,
  rates: RATES,
  min: 1,
  max: 40,
  feeSats: 1_680,
  refused: 0,
  onPreview: jest.fn(),
  onChoose: jest.fn(),
  ...over,
});

const element = (
  given: FeeSliderProps,
  wrap: (slider: React.ReactElement) => React.ReactElement = slider => slider,
) => (
  <GestureHandlerRootView>{wrap(<FeeSlider {...given} />)}</GestureHandlerRootView>
);

async function draw(
  given: FeeSliderProps,
  wrap?: (slider: React.ReactElement) => React.ReactElement,
) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element(given, wrap));
  });
  trees.push(tree);
  return tree;
}

const adjustable = (tree: ReactTestRenderer) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityRole === 'adjustable',
  );

const action = (name: string) => ({ nativeEvent: { actionName: name } });

/** The thumb: the one disc the needle's gauge sits in. */
const thumb = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.type === 'string')
    .find(node => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return style.width === 28 && style.height === 28;
    })!;

/** Every colour anything in the tree is drawn with, as it was given. */
function colours(tree: ReactTestRenderer): Set<string> {
  const found = new Set<string>();
  for (const node of tree.root.findAll(() => true)) {
    for (const key of ['color', 'stroke', 'fill']) {
      if (typeof node.props[key] === 'string') found.add(node.props[key]);
    }
    const style = StyleSheet.flatten(node.props.style) ?? {};
    for (const key of ['backgroundColor', 'borderColor'] as const) {
      const value = (style as Record<string, unknown>)[key];
      if (typeof value === 'string') found.add(value);
    }
  }
  return found;
}

/** Lays the row out `WIDTH` wide, as the sum would. */
const laidOut = (tree: ReactTestRenderer) =>
  act(async () => {
    adjustable(tree).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 48 } },
    });
  });

const latestPan = () =>
  jest.mocked(usePanGesture).mock.calls.at(-1)![0] as PanGestureConfig;
/** The pan's drag callback, which its type says may be an animated event. */
function updateOf(pan: PanGestureConfig) {
  const update = pan.onUpdate;
  if (typeof update !== 'function') throw new Error('Expected a drag callback');
  return update;
}
const latestTap = () =>
  jest.mocked(useTapGesture).mock.calls.at(-1)![0] as TapGestureConfig;

/** How far the finger moved from the thumb at 12 sat/vB to put it at `rate`. */
const dragTo = (rate: number) =>
  (positionOf(rate, ANCHORS) - positionOf(12, ANCHORS)) * travelOf(WIDTH);

const trees: ReactTestRenderer[] = [];
let pending: (() => void)[] = [];
/** Runs what the UI thread handed back to JavaScript. */
const run = () => pending.splice(0).forEach(fn => fn());
let tap: jest.SpyInstance;
let tick: jest.SpyInstance;
let soft: jest.SpyInstance;
let rigid: jest.SpyInstance;

beforeEach(() => {
  pending = [];
  jest
    .spyOn(Worklets, 'scheduleOnRN')
    .mockImplementation((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      pending.push(() => fn(...args));
    });
  tap = jest.spyOn(haptics, 'tap');
  tick = jest.spyOn(haptics, 'tick');
  soft = jest.spyOn(haptics, 'soft');
  rigid = jest.spyOn(haptics, 'rigid');
  jest.mocked(useMotionPrefs).mockReturnValue({ reduced: false });
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test('is an adjustable control that says its rate, its zone and its fee, with a step each way', async () => {
  const tree = await draw(props());
  const host = adjustable(tree);
  expect(host.props.accessibilityLabel).toBe(copy.send.feeRate);
  expect(host.props.accessibilityValue).toEqual({
    min: 1,
    max: 40,
    now: 12,
    text: feeSpoken(12, 1_680, RATES),
  });
  expect(host.props.accessibilityHint).toBe(copy.send.feeRateHint);
  expect(host.props.accessibilityState).toEqual({ disabled: false });
  expect(host.props.accessibilityActions).toEqual([
    { name: 'increment' },
    { name: 'decrement' },
  ]);
  expect(whispers(tree)).toEqual([{ label: copy.send.feeRateFixed, on: false }]);
  // Nothing on it is written.
  expect(tree.root.findAll(node => typeof node.children[0] === 'string')).toEqual([]);
});

test("a screen reader's step chooses the next rate, felt as a tick, and nothing past an end", async () => {
  const given = props();
  const tree = await draw(given);
  await act(async () => adjustable(tree).props.onAccessibilityAction(action('increment')));
  expect(given.onChoose).toHaveBeenCalledWith(13);
  expect(tick).toHaveBeenCalledTimes(1);
  await act(async () => adjustable(tree).props.onAccessibilityAction(action('decrement')));
  expect(given.onChoose).toHaveBeenLastCalledWith(11);
  expect(given.onPreview).not.toHaveBeenCalled();
  const top = props({ rate: 40 });
  const atTop = await draw(top);
  await act(async () => adjustable(atTop).props.onAccessibilityAction(action('increment')));
  expect(top.onChoose).not.toHaveBeenCalled();
  expect(tick).toHaveBeenCalledTimes(2);
});

test('held back, it is a mocha disc in a husk ring with a dust gauge, takes no step, and whispers why', async () => {
  const given = props({ disabled: true, hint: copy.send.quoteExpired });
  const tree = await draw(given);
  const host = adjustable(tree);
  expect(host.props.accessibilityState).toEqual({ disabled: true });
  expect(host.props.accessibilityHint).toBe(copy.send.quoteExpired);
  expect(host.props.onAccessibilityAction).toBeUndefined();
  expect(whispers(tree)).toEqual([{ label: copy.send.quoteExpired, on: true }]);
  const disc = StyleSheet.flatten(thumb(tree).props.style);
  expect(disc.backgroundColor).toBe(palette.mocha);
  expect(disc.borderWidth).toBe(QUIET_RING);
  expect(disc.borderColor).toBe(palette.husk);
  expect(tree.root.findAll(node => node.props.stroke === palette.dust).length).toBeGreaterThan(0);
  expect(colours(tree).has(palette.bloom)).toBe(false);
  // Without a hint it says the fee rate cannot change now.
  const bare = await draw(props({ disabled: true }));
  expect(adjustable(bare).props.accessibilityHint).toBe(copy.send.feeRateFixed);
  // A range with no room holds it back the same way.
  const flat = await draw(props({ min: 12, max: 12 }));
  expect(adjustable(flat).props.accessibilityState).toEqual({ disabled: true });
  expect(adjustable(flat).props.onAccessibilityAction).toBeUndefined();
});

test('live, it is a bloom disc with an ink gauge over a bloom fill, slate on a test network', async () => {
  const tree = await draw(props());
  const disc = StyleSheet.flatten(thumb(tree).props.style);
  expect(disc.backgroundColor).toBe(palette.bloom);
  expect(disc.borderWidth).toBeUndefined();
  expect(tree.root.findAll(node => node.props.stroke === palette.ink).length).toBeGreaterThan(0);
  const test = await draw(props(), slider => (
    <TestNetwork.Provider value={true}>{slider}</TestNetwork.Provider>
  ));
  const drawn = colours(test);
  expect(drawn.has(palette.bloom)).toBe(false);
  expect(drawn.has(palette.slate)).toBe(true);
});

test('in a pane out of use it keeps its role and drops its step', async () => {
  const tree = await draw(props(), slider => <Pane active={false}>{slider}</Pane>);
  const host = adjustable(tree);
  expect(host.props.accessibilityRole).toBe('adjustable');
  expect(host.props.onAccessibilityAction).toBeUndefined();
});

test('a refused rate is felt as a refused key, once for each refusal', async () => {
  const given = props();
  const tree = await draw(given);
  expect(rigid).not.toHaveBeenCalled();
  await act(async () => tree.update(element(props({ refused: 1 }))));
  expect(rigid).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(element(props({ refused: 1 }))));
  expect(rigid).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(element(props({ refused: 2 }))));
  expect(rigid).toHaveBeenCalledTimes(2);
  // Under Reduce Motion as well: haptics are not motion.
  jest.mocked(useMotionPrefs).mockReturnValue({ reduced: true });
  await act(async () => tree.update(element(props({ refused: 3 }))));
  expect(rigid).toHaveBeenCalledTimes(3);
});

test('a drag takes the thumb with a tap, says each whole rate with a tick, a soft at a mark, and chooses once on release', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const pan = latestPan();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  pan.onBegin!({ x: thumbCentre(0.5, WIDTH) } as never);
  run();
  expect(tap).toHaveBeenCalledTimes(1);
  pan.onActivate!({} as never);
  run();
  const update = updateOf(pan);
  update({ translationX: dragTo(13) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(13);
  expect(tick).toHaveBeenCalledTimes(1);
  // Another whole rate in the same frame is said, but not felt again.
  update({ translationX: dragTo(14) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(14);
  expect(tick).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_100);
  update({ translationX: dragTo(15) } as never);
  run();
  expect(tick).toHaveBeenCalledTimes(2);
  // The same rate again says nothing.
  update({ translationX: dragTo(15) + 1 } as never);
  run();
  expect(given.onPreview).toHaveBeenCalledTimes(3);
  // Crossing the fast mark is a soft, not a tick.
  now.mockReturnValue(1_200);
  update({ translationX: dragTo(20) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(20);
  expect(soft).toHaveBeenCalledTimes(1);
  expect(tick).toHaveBeenCalledTimes(2);
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).toHaveBeenCalledTimes(1);
  expect(given.onChoose).toHaveBeenCalledWith(20);
});

test('a drag that began beside the thumb takes it from where it is, and a pan that never activated chooses nothing', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const pan = latestPan();
  pan.onBegin!({ x: thumbCentre(0.9, WIDTH) } as never);
  run();
  expect(tap).not.toHaveBeenCalled();
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).not.toHaveBeenCalled();
  pan.onBegin!({ x: thumbCentre(0.9, WIDTH) } as never);
  pan.onActivate!({} as never);
  run();
  expect(tap).toHaveBeenCalledTimes(1);
  updateOf(pan)({ translationX: dragTo(13) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(13);
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).toHaveBeenCalledWith(13);
});

test('a tap on the track moves the thumb there and chooses the rate, and a tap on the thumb does nothing', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const tapGesture = latestTap();
  const x = thumbCentre(0.75, WIDTH);
  tapGesture.onActivate!({ x } as never);
  run();
  expect(given.onChoose).toHaveBeenCalledWith(rateAt(positionAtX(x, WIDTH), ANCHORS));
  expect(given.onChoose).toHaveBeenCalledWith(20);
  expect(tick).toHaveBeenCalledTimes(1);
  // The thumb moved there, so a tap on it now is a tap on the thumb.
  tapGesture.onActivate!({ x } as never);
  run();
  expect(given.onChoose).toHaveBeenCalledTimes(1);
});

test('its row reaches the least touch target and stretches with the sum', async () => {
  const tree = await draw(props());
  const style = StyleSheet.flatten(adjustable(tree).props.style);
  expect(style.height).toBe(48);
  expect(style.minWidth).toBeGreaterThanOrEqual(48);
});

test('the gesture is live only while it can choose', async () => {
  await draw(props());
  expect(latestPan().enabled).toBe(true);
  expect(latestTap().enabled).toBe(true);
  await draw(props({ disabled: true }));
  expect(latestPan().enabled).toBe(false);
  expect(latestTap().enabled).toBe(false);
});
