import React from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { haptics } from '../src/design/haptics';
import { Backdrop } from '../src/scenes/home/Backdrop';
import { HomePane } from '../src/scenes/home/HomePane';
import { StatusRow } from '../src/scenes/home/StatusRow';
import { SettingsLayer } from '../src/scenes/settings/SettingsLayer';
import { BackupBanner } from '../src/scenes/shared/BackupBanner';
import { ActivityScreen, HomeScreen } from '../src/screens/Wallet';
import { SettingsScreen } from '../src/screens/Settings';
import { copy } from '../src/design/copy';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import type { Backup } from '../src/stage/Canvas';
import {
  COVERED,
  HERO_MINI,
  PANE_SETTLE_MS,
  SCENE_LAYOUT,
  STATUS_ROW,
  stops,
} from '../src/stage/layout';
import type { CanvasSceneName } from '../src/stage/layout';
import { CornerControl } from '../src/stage/panes/CornerControl';
import { Pane } from '../src/stage/panes/Pane';
import {
  StageProvider,
  useHoldTint,
  useStageStore,
} from '../src/stage/StageContext';
import type { HeldTint, StageStore } from '../src/stage/StageContext';
import { a11yText, field, pressableLabels } from '../test-support/query';

/**
 * The canvas's motion (REDESIGN.md 2.3). Under Jest a spring lands on its
 * target at once and reports settling a microtask later, so a pane is caught
 * mid-move by acting synchronously and released by the next awaited act.
 */
const payment: Activity = {
  id: 'a',
  kind: 'sent',
  title: 'Coffee',
  description: '',
  amountSats: 4200,
  feeSats: 1,
  status: 'completed',
  timestamp: Date.parse('2026-06-06T12:00:00Z'),
  reference: 'lnbcrt1reference',
};
const ROW = 'Coffee, 4,200 sats, Completed';

const snapshot: WalletSnapshot = {
  wallet: { id: 'w', name: 'Everyday', network: 'regtest', status: 'running' },
  balance: {
    totalSats: 261_500,
    availableSats: 250_000,
    pendingSats: 11_500,
    receivableSats: 100_000,
  },
  activity: [payment],
  primary: { uri: 'node', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: Date.now(),
  demo: false,
};

const session: React.ComponentProps<typeof Canvas>['session'] = {
  error: '',
  switchError: '',
  refreshing: false,
  connecting: false,
  refresh: jest.fn(),
  manualRefresh: jest.fn(),
  disconnect: jest.fn(),
  chooseWallet: jest.fn(),
  switchNetwork: jest.fn(),
  eraseDevice: jest.fn(),
};

let stage!: StageStore;
const client = new DemoWalletClient();

function OnCanvas({
  backup = null,
  read = snapshot,
}: {
  backup?: Backup | null;
  read?: WalletSnapshot;
}) {
  stage = useStageStore();
  const view = useCanvasView();
  return (
    <GestureHandlerRootView>
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={client}
          snapshot={read}
          session={session}
          stale={false}
          backup={backup}
          view={view}
        />
      </StageProvider>
    </GestureHandlerRootView>
  );
}

/** The store alone, for the rules the canvas relies on. */
function Bare() {
  stage = useStageStore();
  return null;
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** Lets the springs report that they have settled, which lifts the lock. */
const settle = () => act(async () => {});

type Transform = Record<string, number>[];
const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) as {
    opacity?: number;
    transform?: Transform;
    top?: number;
    height?: number;
    marginTop?: number;
    paddingTop?: number;
    paddingBottom?: number;
  };
const transformOf = (node: ReactTestInstance, key: string) =>
  flat(node).transform?.find(step => key in step)?.[key];

/** The panes in tree order: the canvas, the home pane and the sheet. */
function panes(tree: ReactTestRenderer) {
  const [canvas, home, sheet] = tree.root.findAllByType(Pane);
  return { canvas, home, sheet };
}

/** The first host view a component draws, where its style lands. */
const host = (node: ReactTestInstance) =>
  node.findAll(inner => typeof inner.type === 'string')[0];

/**
 * The balance, which shrinks toward the mini strip with `hero`, and the
 * action row under it, which fades with `bar`: the two parts of Home the
 * panes move, found by the test ids Home gives them.
 */
function homeParts(tree: ReactTestRenderer) {
  const part = (testID: string) =>
    tree.root
      .findByType(HomeScreen)
      .find(
        node => typeof node.type === 'string' && node.props.testID === testID,
      );
  return { hero: part('home-hero'), bar: part('home-bar') };
}

/** Where each stop is for the height the canvas has. */
const at = (height = Dimensions.get('window').height) =>
  stops(height, { top: 0 });

/**
 * The canvas's own slots, found by their test ids, that let touches through
 * to what they hold. Anything a scene draws inside them is not counted, such
 * as the view a gesture detector adds.
 */
const SLOTS = ['slot-top', 'slot-detail', 'slot-settings'];
const passThrough = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      SLOTS.includes(node.props.testID) &&
      node.props.pointerEvents === 'box-none',
  ).length;

afterEach(() => jest.restoreAllMocks());

describe('the stage store', () => {
  test('a tap starts the panes toward where it leads, before the render', async () => {
    const tree = await render(<Bare />);
    const follow = jest.fn();
    stage.panes.current = { moving: () => false, follow };
    await act(async () => stage.actions.openActivity());
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0][0].scene.name).toBe('activity');
    // A refused tap leads nowhere, so nothing moves.
    await act(async () => stage.actions.openReceive());
    expect(stage.state.scene.name).toBe('activity');
    expect(follow).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a sheet let go hands its speed to the move, and a press hands none', async () => {
    const tree = await render(<Bare />);
    const follow = jest.fn();
    stage.panes.current = { moving: () => false, follow };
    await act(async () => stage.actions.openActivity({ velocity: -1200 }));
    expect(follow.mock.calls[0][1]).toEqual({ velocity: -1200 });
    // A control that passes the handler straight to onPress calls it with its
    // press event, which is no fling.
    await act(async () => stage.actions.home({ nativeEvent: {} } as never));
    expect(stage.state.scene.name).toBe('home');
    expect(follow.mock.calls[1][1]).toBeUndefined();
    await act(async () => tree.unmount());
  });

  test('two taps in one tick each start from where the one before led', async () => {
    const tree = await render(<Bare />);
    const follow = jest.fn();
    stage.panes.current = { moving: () => false, follow };
    await act(async () => {
      stage.actions.openActivity();
      stage.actions.openDetail(payment);
    });
    expect(follow.mock.calls.map(([next]) => next.scene.name)).toEqual([
      'activity',
      'detail',
    ]);
    expect(stage.state.scene.name).toBe('detail');
    await act(async () => tree.unmount());
  });

  test('while a pane moves, taps are refused and the session and screens are not', async () => {
    const tree = await render(<Bare />);
    const follow = jest.fn();
    stage.panes.current = { moving: () => true, follow };
    await act(async () => stage.actions.openSettings());
    expect(stage.state.scene.name).toBe('home');
    await act(async () => stage.dispatch({ type: 'tab', tab: 'Activity' }));
    expect(stage.state.scene.name).toBe('activity');
    await act(async () => stage.actions.setBusy(true));
    expect(stage.state.busy).toBe(true);
    expect(follow).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('the tint channel', () => {
  function Holding({ tint }: { tint: HeldTint | null }) {
    useHoldTint(tint);
    return null;
  }
  function OnStage({ tints }: { tints: (HeldTint | null)[] }) {
    stage = useStageStore();
    return (
      <StageProvider value={stage}>
        {tints.map((tint, index) => (
          <Holding key={index} tint={tint} />
        ))}
      </StageProvider>
    );
  }

  test('a scene holds a tint while it is set and drawn, and honey wins', async () => {
    const tree = await render(<OnStage tints={['night']} />);
    expect(stage.tint.read().held).toBe('night');
    await act(async () => tree.update(<OnStage tints={['night', 'honey']} />));
    expect(stage.tint.read().held).toBe('honey');
    await act(async () => tree.update(<OnStage tints={['night', null]} />));
    expect(stage.tint.read().held).toBe('night');
    await act(async () => tree.update(<OnStage tints={[]} />));
    expect(stage.tint.read().held).toBeNull();
    await act(async () => tree.unmount());
  });

  test('each flash is keyed, so the ground plays it once', async () => {
    const tree = await render(<OnStage tints={[]} />);
    expect(stage.tint.read().flash).toBeNull();
    await act(async () => stage.tint.flash('sage'));
    await act(async () => stage.tint.flash('radish'));
    expect(stage.tint.read().flash).toEqual({ tint: 'radish', key: 2 });
    await act(async () => tree.unmount());
  });
});

describe('the canvas', () => {
  test('each scene puts the seam at its stop and sets the hero and the action row', async () => {
    const tree = await render(<OnCanvas />);
    const expectPose = (name: CanvasSceneName) => {
      const pose = SCENE_LAYOUT[name];
      const { hero, bar } = homeParts(tree);
      expect(transformOf(panes(tree).sheet, 'translateY')).toBe(
        at()[pose.seam],
      );
      expect(transformOf(hero, 'scale')).toBeCloseTo(
        HERO_MINI + (1 - HERO_MINI) * pose.hero,
      );
      expect(flat(bar).opacity).toBe(pose.bar);
      // Each value moves only its own part: the mini strip never fades
      // with the action row, and the row never shrinks with the balance.
      expect(flat(hero).opacity).toBeUndefined();
      expect(flat(bar).transform).toBeUndefined();
      expect(flat(host(panes(tree).home)).opacity).toBeUndefined();
    };
    expectPose('home');
    const steps: [() => void, CanvasSceneName][] = [
      [() => stage.actions.openActivity(), 'activity'],
      [() => stage.actions.openDetail(payment), 'detail'],
      [() => stage.actions.back(), 'activity'],
      [() => stage.actions.back(), 'home'],
      [() => stage.actions.openSend(), 'send'],
      [() => stage.actions.back(), 'home'],
      [() => stage.actions.openReceive(), 'receive'],
      [() => stage.actions.home(), 'home'],
    ];
    for (const [tap, name] of steps) {
      await act(async () => tap());
      expect(stage.state.scene.name).toBe(name);
      expectPose(name);
    }
    await act(async () => tree.unmount());
  });

  test('taps wait while a pane moves, and the slots take no touches', async () => {
    const tree = await render(<OnCanvas />);
    expect(passThrough(tree)).toBe(SLOTS.length);
    act(() => {
      stage.actions.openSend();
      stage.actions.back();
    });
    expect(stage.state.scene.name).toBe('send');
    expect(passThrough(tree)).toBe(0);
    await settle();
    expect(passThrough(tree)).toBe(SLOTS.length);
    await act(async () => stage.actions.back());
    expect(stage.state.scene.name).toBe('home');
    await act(async () => tree.unmount());
  });

  test('the lock lifts when the panes look settled, not when the springs come to rest', async () => {
    const springs = jest.spyOn(Reanimated, 'withSpring');
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const tree = await render(<OnCanvas />);
    act(() => stage.actions.openSend());
    expect(springs).toHaveBeenCalled();
    for (const [, , done] of springs.mock.calls) expect(done).toBeUndefined();
    const clocks = timings.mock.calls.filter(
      ([, config]) => config?.duration === PANE_SETTLE_MS,
    );
    expect(clocks).toHaveLength(1);
    expect(clocks[0][2]).toEqual(expect.any(Function));
    await settle();
    await act(async () => stage.actions.back());
    expect(stage.state.scene.name).toBe('home');
    await act(async () => tree.unmount());
  });

  test('a scene leaves the panes it does not use drawn, but out of reach', async () => {
    const tree = await render(<OnCanvas />);
    const atHome = pressableLabels(tree);
    for (const label of ['Send', 'Receive', 'Activity', ROW]) {
      expect(atHome).toContain(label);
    }
    await act(async () => stage.actions.openSend());
    const inSend = pressableLabels(tree);
    for (const label of ['Receive', 'Activity', ROW, 'Sent', 'Settings']) {
      expect(inSend).not.toContain(label);
    }
    expect(inSend).toContain('Close');
    expect(() => field(tree, 'Search activity')).toThrow();
    // Still drawn, so they can move and fade on their way out.
    expect(tree.root.findAllByType(HomeScreen)).toHaveLength(1);
    expect(tree.root.findAllByType(ActivityScreen)).toHaveLength(1);
    const { home, sheet } = panes(tree);
    for (const pane of [home, sheet]) {
      const { props } = host(pane);
      expect(props.pointerEvents).toBe('none');
      expect(props.accessibilityElementsHidden).toBe(true);
      expect(props.importantForAccessibility).toBe('no-hide-descendants');
    }
    await act(async () => tree.unmount());
  });

  test('a payment’s detail covers the list, which stays out of reach under it', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    expect(pressableLabels(tree)).toContain(ROW);
    await act(async () => stage.actions.openDetail(payment));
    expect(pressableLabels(tree)).not.toContain(ROW);
    expect(pressableLabels(tree)).toContain('Copy reference');
    await act(async () => tree.unmount());
  });

  test('the backup is pressable in exactly one place, wherever it shows', async () => {
    const backup: Backup = {
      pending: true,
      loadPhrase: jest.fn(),
      onSaved: jest.fn(),
    };
    const tree = await render(<OnCanvas backup={backup} />);
    // Settings draws the backup itself, as its leading section, so its
    // reveal counts there, and a banner's counts wherever one is drawn.
    // Home has no banner: its shield tile leads to Settings.
    const places = () =>
      [
        ...tree.root.findAllByType(BackupBanner),
        ...tree.root.findAllByType(SettingsLayer),
      ].flatMap(place =>
        place.findAll(
          node =>
            node.props.accessibilityLabel === 'Reveal recovery phrase' &&
            typeof node.props.onPress === 'function',
        ),
      ).length + (pressableLabels(tree).has(copy.health.backupPending) ? 1 : 0);
    expect(places()).toBe(1);
    await act(async () => stage.actions.openActivity());
    expect(places()).toBe(1);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    expect(places()).toBe(1);
    await act(async () => stage.actions.back());
    await act(async () => stage.actions.openSend());
    expect(places()).toBe(0);
    // Once it is saved, it shows nowhere.
    await act(async () => stage.actions.back());
    await act(async () =>
      tree.update(<OnCanvas backup={{ ...backup, pending: false }} />),
    );
    expect(places()).toBe(0);
    await act(async () => tree.unmount());
  });

  test('Settings slides over a canvas that stays as it was', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openSettings());
    const { canvas, sheet } = panes(tree);
    expect(transformOf(sheet, 'translateY')).toBe(at().home);
    expect(flat(canvas).opacity).toBe(COVERED.opacity);
    expect(transformOf(canvas, 'scale')).toBe(COVERED.scale);
    expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(1);
    const labels = pressableLabels(tree);
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Send');
    expect(labels).toContain('Close');
    await act(async () => stage.actions.back());
    expect(stage.state.scene.name).toBe('home');
    expect(flat(panes(tree).canvas).opacity).toBe(1);
    expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test('the session moves the panes too, without a tap', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.dispatch({ type: 'tab', tab: 'Activity' }));
    await settle();
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at().compact);
    await act(async () => stage.dispatch({ type: 'reset' }));
    await settle();
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at().home);
    await act(async () => tree.unmount());
  });

  test('the canvas runs under the status bar, and keeps its content below it', async () => {
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    const tree = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets,
        }}
      >
        <OnCanvas />
      </SafeAreaProvider>,
    );
    const inset = stops(Dimensions.get('window').height, insets);
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(inset.home);
    const row = host(tree.root.findByType(StatusRow));
    expect(flat(row)).toMatchObject({
      paddingTop: insets.top,
      height: insets.top + STATUS_ROW,
    });
    expect(flat(host(panes(tree).home)).top).toBe(insets.top + STATUS_ROW);
    const corner = tree.root.findByType(CornerControl).parent!;
    expect(flat(corner)).toMatchObject({
      top: insets.top,
      height: STATUS_ROW,
    });
    await act(async () => stage.actions.openActivity());
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(inset.compact);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    const settings = host(tree.root.findByType(SettingsLayer));
    expect(flat(settings)).toMatchObject({
      marginTop: insets.top,
      paddingBottom: insets.bottom,
    });
    await act(async () => tree.unmount());
  });

  test('at home a screen reader reaches the corner after the actions and before the sheet', async () => {
    // REDESIGN.md 9: mark, hero, vessel, Send, Scan, Receive, cog, sheet.
    const tree = await render(<OnCanvas />);
    const spoken = a11yText(tree);
    const place = (label: string) => {
      expect(spoken).toContain(label);
      return spoken.indexOf(label);
    };
    const actions = ['Send', copy.send.scan, 'Receive'].map(place);
    const corner = place(copy.home.settings);
    expect(corner).toBeGreaterThan(Math.max(...actions));
    expect(corner).toBeLessThan(place(copy.home.activity));
    await act(async () => tree.unmount());
  });

  test('a new canvas size moves the resting seam with it', async () => {
    const tree = await render(<OnCanvas />);
    const root = tree.root
      .findByType(Canvas)
      .findAll(node => typeof node.type === 'string')[0];
    await act(async () =>
      root.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 900 } },
      }),
    );
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at(900).home);
    await act(async () => tree.unmount());
  });

  test('an overlay leaves nothing on the canvas to press', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openCreate(false));
    expect(pressableLabels(tree).size).toBe(0);
    expect(host(panes(tree).canvas).props.accessibilityElementsHidden).toBe(
      true,
    );
    await act(async () => tree.unmount());
  });

  test('money arriving is counted once for the canvas, and every region hears it', async () => {
    const felt = jest.spyOn(haptics, 'incoming');
    const tree = await render(<OnCanvas />);
    const regions = () =>
      [Backdrop, StatusRow, HomePane].map(
        type => tree.root.findByType(type).props.arrived,
      );
    expect(regions()).toEqual([0, 0, 0]);
    const salary: Activity = {
      ...payment,
      id: 'salary',
      kind: 'received',
      title: 'Salary',
    };
    await act(async () =>
      tree.update(
        <OnCanvas read={{ ...snapshot, activity: [salary, payment] }} />,
      ),
    );
    expect(felt).toHaveBeenCalledTimes(1);
    expect(regions()).toEqual([1, 1, 1]);
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion the panes jump, nothing waits, and Settings only dims', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const tree = await render(<OnCanvas />);
    act(() => {
      stage.actions.openActivity();
      stage.actions.openDetail(payment);
    });
    expect(stage.state.scene.name).toBe('detail');
    expect(passThrough(tree)).toBe(SLOTS.length);
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at().compact);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    const { canvas } = panes(tree);
    expect(flat(canvas).opacity).toBe(COVERED.opacity);
    expect(flat(canvas).transform).toBeUndefined();
    await act(async () => tree.unmount());
  });
});
