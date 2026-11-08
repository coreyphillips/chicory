import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import type { PanGestureConfig } from 'react-native-gesture-handler';
import * as Worklets from 'react-native-worklets';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { radius, space } from '../../../theme';
import { primaryOf, snapshotOf } from '../../../../test-support/fixtures';
import { find, press } from '../../../../test-support/query';
import { PrimariesPanel } from '../PrimariesPanel';

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({ children }: { children: unknown }) => children,
    usePanGesture: jest.fn((config: unknown) => config),
  };
});
jest.mock('../fieldScan', () => ({
  useFieldScan: () => ({
    into: { current: null },
    from: { current: null },
    camera: null,
    landOn: null,
    open: jest.fn(),
    land: jest.fn(),
  }),
}));

/**
 * Settings > Primary nodes (REDESIGN.md 6, Settings): the nodes in rank
 * order, each with a bar of how full it is, dragged by their grips and
 * opened for their address and the way to remove one; the fill target the
 * list shares once there are two; and the add form.
 */

const s = copy.settings.primaries;
const HEIGHT = 90;

type Props = Parameters<typeof PrimariesPanel>[0];

const three = () => [
  primaryOf(1, { connected: false, isReceiveTarget: false }),
  primaryOf(2, { isReceiveTarget: true }),
  primaryOf(3, { isReceiveTarget: false, channelCount: 0, balanceSat: 0 }),
];

const props = (over: Partial<Props> = {}): Props => ({
  snapshot: snapshotOf({ primaries: three(), primariesThresholdSat: 250_000 }),
  busy: false,
  onAdd: jest.fn().mockResolvedValue(undefined),
  onRemove: jest.fn().mockResolvedValue(undefined),
  onReorder: jest.fn().mockResolvedValue(true),
  onThreshold: jest.fn().mockResolvedValue(undefined),
  onRetry: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const trees: ReactTestRenderer[] = [];
async function draw(given: Props) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PrimariesPanel {...given} />);
  });
  trees.push(tree);
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => node.type === Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'string');

/** The rows a screen reader reaches, in drawn order. */
const rows = (tree: ReactTestRenderer) => {
  const seen = new Set<string>();
  return tree.root
    .findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        /^Rank \d,/.test(node.props.accessibilityLabel) &&
        typeof node.props.onPress === 'function',
    )
    .filter(node => {
      if (seen.has(node.props.accessibilityLabel)) return false;
      seen.add(node.props.accessibilityLabel);
      return true;
    });
};
const ranks = (tree: ReactTestRenderer) =>
  rows(tree).map(row => row.props.accessibilityLabel.slice(0, 6));

/** Each row's frame, in drawn order: the view the row is measured by. */
const frames = (tree: ReactTestRenderer) =>
  tree.root.findAll(node => {
    if (typeof node.type !== 'string' || typeof node.props.onLayout !== 'function') {
      return false;
    }
    const style = StyleSheet.flatten(node.props.style) ?? {};
    return style.marginHorizontal === -space.xs && style.borderRadius === radius.md;
  });
const laidOut = (tree: ReactTestRenderer) =>
  act(async () => {
    for (const frame of frames(tree)) {
      frame.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 280, height: HEIGHT } },
      });
    }
  });

/** The fill bars, in drawn order, as how far each is scaled. */
const levels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => {
      if (typeof node.type !== 'string') return false;
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return style.transformOrigin === '0% 50%';
    })
    .map(node => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      const scale = (style.transform as { scaleX?: number }[]).find(
        part => 'scaleX' in part,
      );
      return { level: scale?.scaleX, colour: style.backgroundColor };
    });

/** The drag of the row drawn at `index`: its gesture's callbacks, as last given. */
function panOf(index: number, count: number) {
  const calls = jest.mocked(usePanGesture).mock.calls;
  return calls.slice(-count)[index][0] as PanGestureConfig;
}
const callback = <K extends keyof PanGestureConfig>(
  pan: PanGestureConfig,
  name: K,
) => {
  const fn = pan[name];
  if (typeof fn !== 'function') throw new Error(`Expected ${String(name)}`);
  return fn as (...args: unknown[]) => void;
};
const field = (tree: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === 'function',
  )[0];

let tap: jest.SpyInstance;
let tick: jest.SpyInstance;
let soft: jest.SpyInstance;

beforeEach(() => {
  jest
    .spyOn(Worklets, 'scheduleOnRN')
    .mockImplementation((fn: (...args: unknown[]) => void, ...args: unknown[]) =>
      fn(...args),
    );
  tap = jest.spyOn(haptics, 'tap');
  tick = jest.spyOn(haptics, 'tick');
  soft = jest.spyOn(haptics, 'soft');
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test('lists the nodes in rank order, each one line to a screen reader, the receive target with its bolt, and a bar of how full each is against the fill target', async () => {
  const tree = await draw(props());
  expect(ranks(tree)).toEqual(['Rank 1', 'Rank 2', 'Rank 3']);
  const [first, second, third] = rows(tree).map(
    row => row.props.accessibilityLabel as string,
  );
  expect(first).toBe(
    `Rank 1, 127.0.0.1:19846, ${copy.settings.primary.connecting}, 100,000 sats of 250,000 sats`,
  );
  expect(second).toContain(copy.settings.primary.connected);
  expect(second).toContain(s.receiveTarget);
  expect(third).toContain('0 sats of 250,000 sats');
  // The host is drawn, the key is not; the figures under each bar.
  const drawn = texts(tree);
  expect(drawn).toContain('127.0.0.1:19847');
  expect(drawn.some(text => text.includes('0202 0202'))).toBe(false);
  expect(drawn).toContain('200,000 sats');
  expect(drawn.filter(text => text === s.of('250,000 sats'))).toHaveLength(3);
  // 100,000, 200,000 and 0 of 250,000; none full.
  expect(levels(tree)).toEqual([
    { level: 0.4, colour: palette.bloom },
    { level: 0.8, colour: palette.bloom },
    { level: 0, colour: palette.bloom },
  ]);
  // The bolt is drawn once, beside the receive target.
  expect(
    tree.root.findAll(
      node => node.props.name === 'bolt' && node.props.color === palette.bloom,
    ),
  ).toHaveLength(1);
  expect(find(tree, s.retryAll)).toBeDefined();
  expect(find(tree, s.add)).toBeDefined();
});

test('a node that has reached the fill target draws its bar full in sage', async () => {
  const tree = await draw(
    props({
      snapshot: snapshotOf({
        primaries: [primaryOf(1, { balanceSat: 300_000 }), primaryOf(2, { isReceiveTarget: false })],
        primariesThresholdSat: 250_000,
      }),
    }),
  );
  expect(levels(tree)[0]).toEqual({ level: 1, colour: palette.sage });
  expect(levels(tree)[1]).toEqual({ level: 0.8, colour: palette.bloom });
});

test('with one node the bar is the channel as the wallet knows it, there is no bolt, no fill target and no move, and a node without a channel says so', async () => {
  const tree = await draw(
    props({ snapshot: snapshotOf({ primaries: [primaryOf(1)] }) }),
  );
  // 100,000 held, 100,000 of room to receive.
  expect(levels(tree)).toEqual([{ level: 0.5, colour: palette.bloom }]);
  expect(texts(tree)).toContain(s.of('200,000 sats'));
  const [row] = rows(tree);
  expect(row.props.accessibilityLabel).not.toContain(s.receiveTarget);
  expect(row.props.accessibilityActions).toEqual([]);
  expect(tree.root.findAll(node => node.props.name === 'bolt')).toHaveLength(0);
  expect(field(tree, s.threshold)).toBeUndefined();
  expect(find(tree, s.retryAll)).toBeUndefined();
  const bare = await draw(
    props({
      snapshot: snapshotOf({
        primaries: [primaryOf(1, { channelCount: 0, balanceSat: 0 })],
      }),
    }),
  );
  expect(texts(bare)).toContain(s.noChannel);
  expect(rows(bare)[0].props.accessibilityLabel).toContain(s.noChannel);
});

test('a drag by the grip lifts the row with a tap, ticks each slot it passes, lands with a soft and asks for the whole order', async () => {
  const given = props();
  const tree = await draw(given);
  await laidOut(tree);
  const pan = panOf(0, 3);
  expect(pan.enabled).toBe(true);
  expect(pan.activeOffsetY).toEqual([-4, 4]);
  await act(async () => callback(pan, 'onActivate')());
  expect(tap).toHaveBeenCalledTimes(1);
  await act(async () => callback(pan, 'onUpdate')({ translationY: 40 }));
  expect(tick).not.toHaveBeenCalled();
  await act(async () => callback(pan, 'onUpdate')({ translationY: 100 }));
  expect(tick).toHaveBeenCalledTimes(1);
  await act(async () => callback(pan, 'onUpdate')({ translationY: 200 }));
  expect(tick).toHaveBeenCalledTimes(2);
  await act(async () => callback(pan, 'onFinalize')());
  expect(soft).toHaveBeenCalledTimes(1);
  expect(given.onReorder).toHaveBeenCalledWith([
    primaryOf(2).pubkey,
    primaryOf(3).pubkey,
    primaryOf(1).pubkey,
  ]);
  // Drawn in the order asked for.
  expect(ranks(tree)).toEqual(['Rank 2', 'Rank 3', 'Rank 1']);
});

test('a drop back where it started asks for nothing, and an order the engine refuses springs back', async () => {
  const given = props({ onReorder: jest.fn().mockResolvedValue(false) });
  const tree = await draw(given);
  await laidOut(tree);
  const pan = panOf(1, 3);
  await act(async () => callback(pan, 'onActivate')());
  await act(async () => callback(pan, 'onUpdate')({ translationY: 30 }));
  await act(async () => callback(pan, 'onFinalize')());
  expect(given.onReorder).not.toHaveBeenCalled();
  expect(ranks(tree)).toEqual(['Rank 1', 'Rank 2', 'Rank 3']);
  await act(async () => callback(pan, 'onActivate')());
  await act(async () => callback(pan, 'onUpdate')({ translationY: -100 }));
  await act(async () => callback(pan, 'onFinalize')());
  expect(given.onReorder).toHaveBeenCalledWith([
    primaryOf(2).pubkey,
    primaryOf(1).pubkey,
    primaryOf(3).pubkey,
  ]);
  await act(async () => {
    await Promise.resolve();
  });
  expect(ranks(tree)).toEqual(['Rank 1', 'Rank 2', 'Rank 3']);
});

test('the drag is off while a change is under way, and a screen reader moves a row with an action', async () => {
  const busy = await draw(props({ busy: true }));
  expect(panOf(0, 3).enabled).toBe(false);
  expect(rows(busy)[1].props.accessibilityActions).toBeUndefined();
  const given = props();
  const tree = await draw(given);
  const [first, second, third] = rows(tree);
  expect(first.props.accessibilityActions).toEqual([
    { name: 'moveDown', label: s.moveDown },
  ]);
  expect(second.props.accessibilityActions).toEqual([
    { name: 'moveUp', label: s.moveUp },
    { name: 'moveDown', label: s.moveDown },
  ]);
  expect(third.props.accessibilityActions).toEqual([
    { name: 'moveUp', label: s.moveUp },
  ]);
  await act(async () =>
    third.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } }),
  );
  expect(given.onReorder).toHaveBeenCalledWith([
    primaryOf(1).pubkey,
    primaryOf(3).pubkey,
    primaryOf(2).pubkey,
  ]);
  expect(tick).toHaveBeenCalledTimes(1);
});

test('a tap opens a node for its address, setup and channels, and removing asks once more', async () => {
  const given = props();
  const tree = await draw(given);
  expect(find(tree, copy.settings.primary.copy)).toBeUndefined();
  await act(async () => rows(tree)[2].props.onPress());
  expect(rows(tree)[2].props.accessibilityState).toMatchObject({ expanded: true });
  expect(find(tree, copy.settings.primary.copy)).toBeDefined();
  const drawn = texts(tree);
  expect(drawn).toContain(copy.settings.primary.setupReady);
  expect(drawn).toContain(s.channelsLabel);
  expect(drawn).toContain(s.noChannel);
  await press(tree, s.remove);
  expect(given.onRemove).not.toHaveBeenCalled();
  expect(texts(tree)).toContain(s.removeKeeps);
  await press(tree, copy.settings.primary.cancel);
  expect(texts(tree)).not.toContain(s.removeKeeps);
  await press(tree, s.remove);
  await press(tree, s.confirmRemove);
  expect(given.onRemove).toHaveBeenCalledWith(primaryOf(3).pubkey);
  // A second tap closes it.
  await act(async () => rows(tree)[2].props.onPress());
  expect(find(tree, copy.settings.primary.copy)).toBeUndefined();
});

test("a node's setup error is drawn under its bar without opening it", async () => {
  const tree = await draw(
    props({
      snapshot: snapshotOf({
        primaries: [
          primaryOf(1),
          primaryOf(2, { isReceiveTarget: false, connected: false, setup: 'failed', setupError: 'Could not reach the node.' }),
        ],
      }),
    }),
  );
  expect(texts(tree)).toContain('Could not reach the node.');
});

test('the fill target shows the saved amount, saves a changed one, offers no save for a blank or a zero, and is prefilled with the default when none was saved', async () => {
  const given = props();
  const tree = await draw(given);
  expect(field(tree, s.threshold)!.props.value).toBe('250000');
  expect(find(tree, s.saveThreshold)).toBeUndefined();
  await act(async () => field(tree, s.threshold)!.props.onChangeText(''));
  expect(find(tree, s.saveThreshold)).toBeUndefined();
  await act(async () => field(tree, s.threshold)!.props.onChangeText('0'));
  expect(find(tree, s.saveThreshold)).toBeUndefined();
  await act(async () => field(tree, s.threshold)!.props.onChangeText('300000'));
  await press(tree, s.saveThreshold);
  expect(given.onThreshold).toHaveBeenCalledWith(300_000);
  expect(texts(tree)).toContain(s.thresholdHint);
  const unsaved = await draw(
    props({ snapshot: snapshotOf({ primaries: three(), primariesThresholdSat: null }) }),
  );
  expect(field(unsaved, s.threshold)!.props.value).toBe('1000000');
  expect(find(unsaved, s.saveThreshold)).toBeDefined();
});

test('adding keeps the one-primary form, names the node and closes', async () => {
  const given = props();
  const tree = await draw(given);
  await press(tree, s.add);
  const uri = `03${'f'.repeat(64)}@fourth.example:9735`;
  await act(async () =>
    field(tree, copy.settings.primary.address)!.props.onChangeText(uri),
  );
  expect(texts(tree)).toContain(s.addHint);
  await press(tree, copy.settings.primary.save);
  expect(given.onAdd).toHaveBeenCalledWith(uri, expect.any(Function), undefined);
});
