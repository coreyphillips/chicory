import React from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { Button } from '../src/components/ui';
import { ActivityScreen, HomeScreen } from '../src/screens/Wallet';
import { SettingsScreen } from '../src/screens/Settings';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import { COVERED, HERO_MINI, SCENE_LAYOUT, stops } from '../src/stage/layout';
import type { CanvasSceneName } from '../src/stage/layout';
import { Pane } from '../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { field, pressableLabels } from '../test-support/query';

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

function OnCanvas({ banner = null }: { banner?: React.ReactNode }) {
  stage = useStageStore();
  const view = useCanvasView();
  return (
    <StageProvider value={stage}>
      <Canvas
        scene={stage.state.scene}
        overlay={stage.state.overlay}
        client={client}
        snapshot={snapshot}
        session={session}
        stale={false}
        banner={banner}
        view={view}
      />
    </StageProvider>
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
  };
const transformOf = (node: ReactTestInstance, key: string) =>
  flat(node).transform?.find(step => key in step)?.[key];

/** The panes in tree order: the canvas, the home pane and the sheet. */
function panes(tree: ReactTestRenderer) {
  const [canvas, home, sheet] = tree.root.findAllByType(Pane);
  return { canvas, home, sheet };
}

/** Where each stop is for the height the canvas has. */
const at = (height = Dimensions.get('window').height) =>
  stops(height, { top: 0 });

/** The slot regions and anything else that lets touches through itself. */
const passThrough = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.pointerEvents === 'box-none',
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

describe('the canvas', () => {
  test('each scene puts the seam at its stop and sets the hero and the action row', async () => {
    const tree = await render(<OnCanvas />);
    const expectPose = (name: CanvasSceneName) => {
      const pose = SCENE_LAYOUT[name];
      const { home, sheet } = panes(tree);
      expect(transformOf(sheet, 'translateY')).toBe(at()[pose.seam]);
      expect(flat(home).opacity).toBe(pose.bar);
      expect(transformOf(home, 'scale')).toBeCloseTo(
        HERO_MINI + (1 - HERO_MINI) * pose.hero,
      );
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
    const resting = passThrough(tree);
    expect(resting).toBeGreaterThanOrEqual(3);
    act(() => {
      stage.actions.openSend();
      stage.actions.back();
    });
    expect(stage.state.scene.name).toBe('send');
    expect(passThrough(tree)).toBe(resting - 3);
    await settle();
    expect(passThrough(tree)).toBe(resting);
    await act(async () => stage.actions.back());
    expect(stage.state.scene.name).toBe('home');
    await act(async () => tree.unmount());
  });

  test('a scene leaves the panes it does not use drawn, but out of reach', async () => {
    const tree = await render(<OnCanvas />);
    const atHome = pressableLabels(tree);
    for (const label of [
      'Send',
      'Receive',
      'View all activity',
      'Activity',
      ROW,
      'All',
    ]) {
      expect(atHome).toContain(label);
    }
    await act(async () => stage.actions.openSend());
    const inSend = pressableLabels(tree);
    for (const label of [
      'Receive',
      'View all activity',
      'Activity',
      ROW,
      'All',
      'Settings',
    ]) {
      expect(inSend).not.toContain(label);
    }
    expect(inSend).toContain('Close');
    expect(() => field(tree, 'Search activity')).toThrow();
    // Still drawn, so they can move and fade on their way out.
    expect(tree.root.findAllByType(HomeScreen)).toHaveLength(1);
    expect(tree.root.findAllByType(ActivityScreen)).toHaveLength(1);
    const { home, sheet } = panes(tree);
    for (const pane of [home, sheet]) {
      const host = pane.findAll(node => typeof node.type === 'string')[0];
      expect(host.props.pointerEvents).toBe('none');
      expect(host.props.accessibilityElementsHidden).toBe(true);
      expect(host.props.importantForAccessibility).toBe('no-hide-descendants');
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
    const save = jest.fn();
    const tree = await render(
      <OnCanvas banner={<Button label="Save phrase" onPress={save} />} />,
    );
    const places = () =>
      tree.root.findAll(
        node =>
          node.props.accessibilityLabel === 'Save phrase' &&
          typeof node.props.onPress === 'function',
      ).length;
    expect(places()).toBe(1);
    await act(async () => stage.actions.openActivity());
    expect(places()).toBe(1);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    expect(places()).toBe(1);
    await act(async () => stage.actions.back());
    await act(async () => stage.actions.openSend());
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
    const host = panes(tree).canvas.findAll(
      node => typeof node.type === 'string',
    )[0];
    expect(host.props.accessibilityElementsHidden).toBe(true);
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion the panes jump, nothing waits, and Settings only dims', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const tree = await render(<OnCanvas />);
    const resting = passThrough(tree);
    act(() => {
      stage.actions.openActivity();
      stage.actions.openDetail(payment);
    });
    expect(stage.state.scene.name).toBe('detail');
    expect(passThrough(tree)).toBe(resting);
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at().compact);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    const { canvas } = panes(tree);
    expect(flat(canvas).opacity).toBe(COVERED.opacity);
    expect(flat(canvas).transform).toBeUndefined();
    await act(async () => tree.unmount());
  });
});
