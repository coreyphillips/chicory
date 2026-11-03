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
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { useMotionPrefs } from '../../../motion/useMotionPrefs';
import { Pane } from '../../../stage/panes/Pane';
import { ShareSlider } from '../ShareSlider';
import type { ShareSliderProps } from '../ShareSlider';
import {
  positionOfShare,
  shareAt,
  shareAtX,
  shareCentre,
  shareTravel,
  stepShare,
} from '../shareTrack';
import { SettingsNetwork } from '../ui';

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
 * Auto-pay's limit slider (REDESIGN.md 5, ShareSlider): 0 to 100% in
 * detents of 5%, each felt as it is crossed, a soft at a mark or an end,
 * saved once as it is let go, and stepped a detent at a time by a screen
 * reader.
 */
const WIDTH = 288;
const words = copy.settings.phone;

const props = (over: Partial<ShareSliderProps> = {}): ShareSliderProps => ({
  share: 50,
  spoken: share => words.autoPaySpoken(share, share * 1_000),
  onPreview: jest.fn(),
  onChoose: jest.fn(),
  ...over,
});

const element = (
  given: ShareSliderProps,
  wrap: (slider: React.ReactElement) => React.ReactElement = slider => slider,
) => (
  <GestureHandlerRootView>
    {wrap(<ShareSlider {...given} />)}
  </GestureHandlerRootView>
);

const trees: ReactTestRenderer[] = [];
async function draw(
  given: ShareSliderProps,
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

/** The thumb: the one 28pt disc. */
const thumb = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.type === 'string')
    .find(node => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return style.width === 28 && style.height === 28;
    })!;

/** Every colour anything in the tree is drawn with. */
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

const laidOut = (tree: ReactTestRenderer) =>
  act(async () => {
    adjustable(tree).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 48 } },
    });
  });

const latestPan = () =>
  jest.mocked(usePanGesture).mock.calls.at(-1)![0] as PanGestureConfig;
function updateOf(pan: PanGestureConfig) {
  const update = pan.onUpdate;
  if (typeof update !== 'function') throw new Error('Expected a drag callback');
  return update;
}
const latestTap = () =>
  jest.mocked(useTapGesture).mock.calls.at(-1)![0] as TapGestureConfig;

/** How far the finger moved from the thumb at 50% to put it at `share`. */
const dragTo = (share: number) =>
  (positionOfShare(share) - positionOfShare(50)) * shareTravel(WIDTH);

let pending: (() => void)[] = [];
const run = () => pending.splice(0).forEach(fn => fn());
let tap: jest.SpyInstance;
let tick: jest.SpyInstance;
let soft: jest.SpyInstance;

beforeEach(() => {
  pending = [];
  jest
    .spyOn(Worklets, 'scheduleOnRN')
    .mockImplementation(
      (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
        pending.push(() => fn(...args));
      },
    );
  tap = jest.spyOn(haptics, 'tap');
  tick = jest.spyOn(haptics, 'tick');
  soft = jest.spyOn(haptics, 'soft');
  jest.mocked(useMotionPrefs).mockReturnValue({ reduced: false });
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

describe('the track', () => {
  it.each([
    [0, 0],
    [0.5, 50],
    [1, 100],
    [0.51, 50],
    [0.53, 55],
    [-0.2, 0],
    [1.3, 100],
  ])('at %d it is %d%%', (position, share) => {
    expect(shareAt(position)).toBe(share);
  });

  it('starts at the row edge, and a touch reads back where the thumb is', () => {
    expect(shareCentre(0, WIDTH)).toBe(14);
    expect(shareCentre(1, WIDTH)).toBe(WIDTH - 14);
    expect(shareAtX(shareCentre(0.75, WIDTH), WIDTH)).toBeCloseTo(0.75);
    expect(shareAtX(-30, WIDTH)).toBe(0);
  });

  it('steps a detent at a time, held to 0 and 100', () => {
    expect(stepShare(50, 1)).toBe(55);
    expect(stepShare(50, -1)).toBe(45);
    expect(stepShare(100, 1)).toBe(100);
    expect(stepShare(0, -1)).toBe(0);
  });
});

test('is an adjustable control that says its share and what it allows, with a step each way', async () => {
  const tree = await draw(props());
  const host = adjustable(tree);
  expect(host.props.accessibilityLabel).toBe(words.autoPayLimit);
  expect(host.props.accessibilityHint).toBe(words.autoPayLimitHint);
  expect(host.props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: 50,
    text: words.autoPaySpoken(50, 50_000),
  });
  expect(host.props.accessibilityActions).toEqual([
    { name: 'increment' },
    { name: 'decrement' },
  ]);
  // Nothing on it is written: the readout above it says the share.
  expect(
    tree.root.findAll(node => typeof node.children[0] === 'string'),
  ).toEqual([]);
});

test("a screen reader's step chooses the next detent, felt as a tick, and nothing past an end", async () => {
  const given = props();
  const tree = await draw(given);
  await act(async () =>
    adjustable(tree).props.onAccessibilityAction(action('increment')),
  );
  expect(given.onChoose).toHaveBeenCalledWith(55);
  expect(tick).toHaveBeenCalledTimes(1);
  await act(async () =>
    adjustable(tree).props.onAccessibilityAction(action('decrement')),
  );
  expect(given.onChoose).toHaveBeenLastCalledWith(45);
  const top = props({ share: 100 });
  const atTop = await draw(top);
  await act(async () =>
    adjustable(atTop).props.onAccessibilityAction(action('increment')),
  );
  expect(top.onChoose).not.toHaveBeenCalled();
  expect(tick).toHaveBeenCalledTimes(2);
});

test('is an accent disc carrying an ink bolt over an accent fill, slate on a test network', async () => {
  const tree = await draw(props());
  const disc = StyleSheet.flatten(thumb(tree).props.style);
  expect(disc.backgroundColor).toBe(palette.bloom);
  expect(
    tree.root.findAll(node => node.props.stroke === palette.ink).length,
  ).toBeGreaterThan(0);
  const test = await draw(props(), slider => (
    <SettingsNetwork network="regtest">{slider}</SettingsNetwork>
  ));
  const drawn = colours(test);
  expect(drawn.has(palette.bloom)).toBe(false);
  expect(drawn.has(palette.slate)).toBe(true);
});

test('in a pane out of use it keeps its role and drops its step and its gestures', async () => {
  const tree = await draw(props(), slider => (
    <Pane active={false}>{slider}</Pane>
  ));
  const host = adjustable(tree);
  expect(host.props.accessibilityRole).toBe('adjustable');
  expect(host.props.onAccessibilityAction).toBeUndefined();
  expect(latestPan().enabled).toBe(false);
  expect(latestTap().enabled).toBe(false);
});

test('a drag takes the thumb with a tap, says each detent with a tick, a soft at a mark or an end, and saves once on release', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const pan = latestPan();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  pan.onBegin!({ x: shareCentre(0.5, WIDTH) } as never);
  run();
  expect(tap).toHaveBeenCalledTimes(1);
  pan.onActivate!({} as never);
  run();
  const update = updateOf(pan);
  update({ translationX: dragTo(55) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(55);
  expect(tick).toHaveBeenCalledTimes(1);
  // Another detent in the same frame is said, but not felt again.
  update({ translationX: dragTo(60) } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(60);
  expect(tick).toHaveBeenCalledTimes(1);
  // Within the same detent, nothing.
  now.mockReturnValue(1_100);
  update({ translationX: dragTo(60) + 2 } as never);
  run();
  expect(given.onPreview).toHaveBeenCalledTimes(2);
  // Crossing three quarters is a soft, not a tick.
  update({ translationX: dragTo(75) } as never);
  run();
  expect(soft).toHaveBeenCalledTimes(1);
  expect(tick).toHaveBeenCalledTimes(1);
  // So is reaching the end, past which it is held to 100%.
  now.mockReturnValue(1_200);
  update({ translationX: dragTo(100) + 40 } as never);
  run();
  expect(given.onPreview).toHaveBeenLastCalledWith(100);
  expect(soft).toHaveBeenCalledTimes(2);
  expect(given.onChoose).not.toHaveBeenCalled();
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).toHaveBeenCalledTimes(1);
  expect(given.onChoose).toHaveBeenCalledWith(100);
});

test('a drag that began beside the thumb takes it from where it is, and a pan that never activated saves nothing', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const pan = latestPan();
  pan.onBegin!({ x: shareCentre(0.9, WIDTH) } as never);
  run();
  expect(tap).not.toHaveBeenCalled();
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).not.toHaveBeenCalled();
  pan.onBegin!({ x: shareCentre(0.9, WIDTH) } as never);
  pan.onActivate!({} as never);
  run();
  expect(tap).toHaveBeenCalledTimes(1);
  updateOf(pan)({ translationX: dragTo(40) } as never);
  run();
  pan.onFinalize!({} as never);
  run();
  expect(given.onChoose).toHaveBeenCalledWith(40);
});

test('a tap on the track moves the thumb there and saves its detent, and a tap on the thumb does nothing', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const tapGesture = latestTap();
  const x = shareCentre(0.2, WIDTH);
  tapGesture.onActivate!({ x } as never);
  run();
  expect(given.onChoose).toHaveBeenCalledWith(20);
  expect(tick).toHaveBeenCalledTimes(1);
  tapGesture.onActivate!({ x } as never);
  run();
  expect(given.onChoose).toHaveBeenCalledTimes(1);
});

test('switched on, it lands soft as it grows out; resting, it is simply there', async () => {
  jest.useFakeTimers();
  try {
    await draw(props({ wake: true }));
    expect(soft).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(soft).toHaveBeenCalledTimes(1);
    await draw(props());
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(soft).toHaveBeenCalledTimes(1);
    // Under Reduce Motion nothing grows, so nothing lands.
    jest.mocked(useMotionPrefs).mockReturnValue({ reduced: true });
    await draw(props({ wake: true }));
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(soft).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('its row reaches the least touch target', async () => {
  const tree = await draw(props());
  expect(StyleSheet.flatten(adjustable(tree).props.style).height).toBe(48);
});
