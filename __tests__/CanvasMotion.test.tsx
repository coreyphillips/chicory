import React from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { haptics } from '../src/design/haptics';
import { Bloom } from '../src/glyphs/Bloom';
import { Odometer } from '../src/glyphs/Odometer';
import { ActionCircle } from '../src/scenes/home/ActionCircle';
import { Backdrop } from '../src/scenes/home/Backdrop';
import { HomePane } from '../src/scenes/home/HomePane';
import { StatusRow } from '../src/scenes/home/StatusRow';
import { SettingsLayer } from '../src/scenes/settings/SettingsLayer';
import { ActivityScreen, HomeScreen } from '../src/screens/Wallet';
import { SettingsScreen } from '../src/screens/Settings';
import { copy } from '../src/design/copy';
import { durations } from '../src/motion/tokens';
import { FOCUS_SETTLE_MS } from '../src/motion/speech';
import { FILTERS } from '../src/scenes/activity/model';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import type { Backup } from '../src/stage/Canvas';
import {
  COVERED,
  HERO_MINI,
  PANE_SETTLE_MS,
  SCANNING,
  SCENE_LAYOUT,
  STATUS_ROW,
  buildBeats,
  stops,
} from '../src/stage/layout';
import type { Arrival, CanvasSceneName } from '../src/stage/layout';
import { COG_TURN, CornerControl } from '../src/stage/panes/CornerControl';
import {
  EDGE,
  EdgeBack,
  FLING,
  swipeGoesBack,
} from '../src/stage/panes/EdgeBack';
import { Pane, PanesProvider } from '../src/stage/panes/Pane';
import type { Panes } from '../src/stage/panes/Pane';
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
  arrival,
}: {
  backup?: Backup | null;
  read?: WalletSnapshot;
  arrival?: Arrival;
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
          arrival={arrival}
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
 * action row under it, whose circles fade with `bar`: the parts of Home the
 * panes move, found by the test ids Home gives them and, for the circles,
 * by the view that poses each one.
 */
function homeParts(tree: ReactTestRenderer) {
  const home = tree.root.findByType(HomeScreen);
  const part = (testID: string) =>
    home.find(
      node => typeof node.type === 'string' && node.props.testID === testID,
    );
  const circles = home
    .findAllByType(ActionCircle)
    .map(circle => host(circle.parent!));
  return { hero: part('home-hero'), bar: part('home-bar'), circles };
}

/**
 * The balance's own figures. Home draws them twice: as the hero, and again
 * as the mini strip, which crossfades in as the hero lands.
 */
const heroFigures = (tree: ReactTestRenderer) =>
  tree.root
    .findByType(HomeScreen)
    .findAllByType(Odometer)
    .find(odometer => odometer.props.variant === 'hero')!;

/** The host views drawn with `testID`, in tree order. */
const byTestID = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  );

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

  test('a payment going out holds a tap in the same tick where it is', async () => {
    const tree = await render(<Bare />);
    const follow = jest.fn();
    stage.panes.current = { moving: () => false, follow };
    await act(async () => stage.actions.openSend());
    follow.mockClear();
    await act(async () => {
      stage.actions.setBusy(true);
      stage.actions.back();
      stage.actions.home();
    });
    expect(follow).not.toHaveBeenCalled();
    expect(stage.state.scene.name).toBe('send');
    expect(stage.state.busy).toBe(true);
    // Once it lands, the next tap in the same tick goes through.
    await act(async () => {
      stage.actions.setBusy(false);
      stage.actions.back();
    });
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0][0].scene.name).toBe('home');
    expect(stage.state.scene.name).toBe('home');
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

describe('the canvas arriving', () => {
  /** The view that rises and drops the sheet as the canvas comes and goes. */
  const sheetLayer = (tree: ReactTestRenderer) => byTestID(tree, 'sheet')[0];
  const figures = (tree: ReactTestRenderer) =>
    byTestID(tree, 'home-figures')[0];

  test('builds in on its beats: the hero, then the sheet, then the actions', async () => {
    const beats = buildBeats('unlock');
    expect(beats).toMatchObject({ hero: 600, sheet: 650, actions: 700 });
    expect(buildBeats('load').hero).toBeLessThan(beats.hero);
    const tree = await render(<OnCanvas arrival="unlock" />);
    expect(sheetLayer(tree).props.entering).toEqual(expect.any(Function));
    expect(figures(tree).props.entering).toEqual(expect.any(Function));
    const slots = byTestID(tree, 'home-slot');
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.props.entering).toEqual(expect.any(Function));
    }
    // Each circle its own entrance, one after the other.
    expect(new Set(slots.map(slot => slot.props.entering)).size).toBe(3);
    await act(async () => tree.unmount());

    // Drawn without an arrival, as a suite draws it, it is simply there.
    const still = await render(<OnCanvas />);
    expect(sheetLayer(still).props.entering).toBeUndefined();
    expect(figures(still).props.entering).toBeUndefined();
    for (const slot of byTestID(still, 'home-slot')) {
      expect(slot.props.entering).toBeUndefined();
    }
    await act(async () => still.unmount());
  });

  test('the hero counts up from 0 on its beat, and always says the balance', async () => {
    // Hold every beat, as a device would until it falls.
    const timing = Reanimated.withTiming;
    jest
      .spyOn(Reanimated, 'withTiming')
      .mockImplementation((to, config, done) =>
        config?.duration === 0 ? to : timing(to, config, done),
      );
    const tree = await render(<OnCanvas arrival="load" />);
    const hero = () => heroFigures(tree);
    expect(hero().props.sats).toBe(0);
    expect(hero().props.accessibilityLabel).toBe(
      copy.home.totalBalance(261_500, 'sats'),
    );
    await act(async () => tree.unmount());
    jest.restoreAllMocks();

    // Once the beat falls it rolls to the balance.
    const again = await render(<OnCanvas arrival="load" />);
    await settle();
    expect(heroFigures(again).props.sats).toBe(261_500);
    await act(async () => again.unmount());
  });

  test('a wallet back from offline bursts its mark with a success', async () => {
    const success = jest.spyOn(haptics, 'success');
    const tree = await render(<OnCanvas arrival="reconnect" />);
    await settle();
    expect(success).toHaveBeenCalledTimes(1);
    const mark = tree.root.findByType(StatusRow).findByType(Bloom);
    expect(mark.props.event?.kind).toBe('burst');
    await act(async () => tree.unmount());

    success.mockClear();
    const loaded = await render(<OnCanvas arrival="load" />);
    await settle();
    expect(success).not.toHaveBeenCalled();
    expect(
      loaded.root.findByType(StatusRow).findByType(Bloom).props.event,
    ).toBeUndefined();
    await act(async () => loaded.unmount());
  });

  test('leaving, the sheet drops away and the figures roll out', async () => {
    const tree = await render(<OnCanvas />);
    expect(sheetLayer(tree).props.exiting).toEqual(expect.any(Function));
    expect(figures(tree).props.exiting).toEqual(expect.any(Function));
    await act(async () => tree.unmount());
  });
});

describe('the canvas', () => {
  test('each scene puts the seam at its stop and sets the hero and the action row', async () => {
    const tree = await render(<OnCanvas />);
    const expectPose = async (name: CanvasSceneName) => {
      // Under the mock a style is read as its component draws, so Home is
      // drawn again once the scene has taken over from the circle.
      await act(async () => tree.update(<OnCanvas />));
      const pose = SCENE_LAYOUT[name];
      const { hero, bar, circles } = homeParts(tree);
      expect(transformOf(panes(tree).sheet, 'translateY')).toBe(
        at()[pose.seam],
      );
      expect(transformOf(hero, 'scale')).toBeCloseTo(
        HERO_MINI + (1 - HERO_MINI) * pose.hero,
      );
      expect(circles).toHaveLength(3);
      for (const circle of circles) {
        expect(flat(circle).opacity).toBe(pose.bar);
      }
      // Each value moves only its own part: the mini strip never fades
      // with the action row, and the row never shrinks with the balance.
      // Each circle fades on its own, so the row itself does neither.
      expect(flat(hero).opacity).toBeUndefined();
      expect(flat(bar).opacity).toBeUndefined();
      expect(flat(bar).transform).toBeUndefined();
      expect(flat(host(panes(tree).home)).opacity).toBeUndefined();
    };
    await expectPose('home');
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
      await expectPose(name);
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

  test('a payment’s detail takes the lock while its card grows out of the row', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await settle();
    expect(passThrough(tree)).toBe(SLOTS.length);
    act(() => stage.actions.openDetail(payment));
    // The panes stay where the list had them, but the card is on its way:
    // taps and back wait for it, as for any move.
    expect(passThrough(tree)).toBe(0);
    act(() => stage.actions.back());
    expect(stage.state.scene.name).toBe('detail');
    await settle();
    expect(passThrough(tree)).toBe(SLOTS.length);
    // Closing it is a move too.
    act(() => stage.actions.back());
    expect(stage.state.scene.name).toBe('activity');
    expect(passThrough(tree)).toBe(0);
    await settle();
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
    // Settings draws the backup itself, as its leading section, so a reveal
    // counts wherever one is drawn. The canvas draws no phrase: its shields,
    // the tile at home and the shelf on the open list, lead to Settings.
    const places = () =>
      tree.root.findAll(
        node =>
          node.props.accessibilityLabel === 'Reveal recovery phrase' &&
          typeof node.props.onPress === 'function',
      ).length + (pressableLabels(tree).has(copy.health.backupPending) ? 1 : 0);
    expect(places()).toBe(1);
    await act(async () => stage.actions.openActivity());
    expect(places()).toBe(1);
    // The shelf's Settings, over the list.
    await act(async () => stage.actions.openSettings());
    expect(stage.state.scene.name).toBe('settings');
    expect(places()).toBe(1);
    await act(async () => stage.actions.back());
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

  test('the cog spins out as the close spins in, and turns as Settings covers the canvas', async () => {
    const tree = await render(<OnCanvas />);
    // The canvas's own corner is the first drawn; the turn is on its root
    // and the glyph that spins sits in the keyed view inside it.
    const corner = () => tree.root.findAllByType(CornerControl)[0];
    const spinning = () =>
      corner().findAll(
        node => typeof node.type === 'string' && !!node.props.entering,
      )[0];
    const turnOf = (node: ReactTestInstance) =>
      transformOf(host(node), 'rotate');
    const cog = spinning();
    expect(cog.props.exiting).toBeDefined();
    expect(
      cog.findAll(node => node.props.accessibilityLabel === 'Settings'),
    ).not.toHaveLength(0);
    expect(turnOf(corner())).toBe('0deg');
    await act(async () => stage.actions.openSend());
    // A new control, not the cog with a new glyph, so each can spin.
    const close = spinning();
    expect(close).not.toBe(cog);
    expect(
      close.findAll(node => node.props.accessibilityLabel === 'Close'),
    ).not.toHaveLength(0);
    await settle();
    await act(async () => stage.actions.back());
    await settle();
    await act(async () => stage.actions.openSettings());
    // The canvas's cog turns 120 degrees under Settings; Settings' own
    // close stays upright.
    const [canvasCorner, settingsCorner] =
      tree.root.findAllByType(CornerControl);
    expect(turnOf(canvasCorner)).toBe(`${COG_TURN}deg`);
    expect(turnOf(settingsCorner)).toBe('0deg');
    await act(async () => tree.unmount());
  });

  test('a swipe in from the left edge takes Settings back, the canvas following the finger', async () => {
    const width = Dimensions.get('window').width;
    // The swipe on its own, over a canvas whose cover it writes.
    const covers: number[] = [];
    const cover = {
      get: () => covers[covers.length - 1] ?? 1,
      set: (value: number) => covers.push(value),
    } as unknown as Panes['cover'];
    function Swiped() {
      stage = useStageStore();
      const still = Reanimated.useSharedValue(0);
      return (
        <GestureHandlerRootView>
          <StageProvider value={stage}>
            <PanesProvider
              value={{
                seam: still,
                hero: still,
                bar: still,
                cover,
                scan: still,
                pull: still,
                stops: at(),
              }}
            >
              <EdgeBack />
            </PanesProvider>
          </StageProvider>
        </GestureHandlerRootView>
      );
    }
    const alone = await render(<Swiped />);
    await act(async () => stage.actions.openSettings());
    const swipe = () =>
      alone.root.findByType(EdgeBack).findByType(GestureDetector).props.gesture;
    expect(swipe().config.hitSlop).toEqual({ left: 0, width: EDGE });
    // Half way across, the canvas is half uncovered. Let go short of the
    // threshold, it springs back and Settings stays.
    await act(async () =>
      fireGestureHandler(swipe(), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationX: width / 2 },
        { state: State.ACTIVE, translationX: width * 0.3 },
        { state: State.END, translationX: width * 0.3, velocityX: 0 },
      ]),
    );
    expect(covers).toEqual(expect.arrayContaining([0.5]));
    expect(covers.at(-1)).toBe(1);
    expect(stage.state.scene.name).toBe('settings');
    // Let go past it, Settings goes back; a fling does too.
    await act(async () =>
      fireGestureHandler(swipe(), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationX: width / 2 },
        { state: State.END, translationX: width / 2, velocityX: 0 },
      ]),
    );
    expect(stage.state.scene.name).toBe('home');
    expect(swipeGoesBack(40, width, FLING + 1)).toBe(true);
    expect(swipeGoesBack(40, width, 0)).toBe(false);
    expect(swipeGoesBack(0, width, FLING + 1)).toBe(false);
    await act(async () => alone.unmount());

    // On the canvas, Settings takes it.
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openSettings());
    await settle();
    await act(async () =>
      fireGestureHandler(
        tree.root.findByType(EdgeBack).findByType(GestureDetector).props
          .gesture,
        [
          { state: State.BEGAN },
          { state: State.ACTIVE, translationX: width * 0.6 },
          { state: State.END, translationX: width * 0.6, velocityX: 0 },
        ],
      ),
    );
    expect(stage.state.scene.name).toBe('home');
    await act(async () => tree.unmount());
  });

  test('the scan overlay dims and shrinks the canvas under it, and lets it go as it closes', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openScan());
    await settle();
    expect(flat(panes(tree).canvas).opacity).toBe(SCANNING.opacity);
    expect(transformOf(panes(tree).canvas, 'scale')).toBe(SCANNING.scale);
    // Cancelled, it closes by the stage's own back.
    await act(async () => stage.dispatch({ type: 'back' }));
    await settle();
    expect(stage.state.overlay).toBeNull();
    expect(flat(panes(tree).canvas).opacity).toBe(1);
    expect(transformOf(panes(tree).canvas, 'scale')).toBe(1);
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion the scan overlay only dims the canvas', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openScan());
    expect(flat(panes(tree).canvas).opacity).toBe(SCANNING.opacity);
    expect(flat(panes(tree).canvas).transform).toBeUndefined();
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
    // Drawn in the status row, hung from an anchor under the home pane's
    // top edge (see the reading order test below).
    const [anchor] = byTestID(tree, 'corner');
    const corner = tree.root.findByType(CornerControl).parent!;
    expect(flat(corner).height).toBe(STATUS_ROW);
    expect(flat(anchor).top! + flat(corner).top!).toBe(insets.top);
    await act(async () => stage.actions.openActivity());
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(inset.compact);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    const settings = host(tree.root.findByType(SettingsLayer));
    expect(flat(settings).marginTop).toBe(insets.top);
    // Settings runs under the home indicator to the bottom edge, the inset
    // added to the end of what it scrolls rather than taken off the layer.
    expect(flat(settings).paddingBottom).toBeUndefined();
    const scroll = tree.root
      .findByType(SettingsLayer)
      .findAll(node => typeof node.type === 'string' && !!node.props.style)
      .filter(node => flat(node).paddingBottom === insets.bottom);
    expect(scroll.length).toBeGreaterThan(0);
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

    // VoiceOver orders what shares a container by where each part starts,
    // top to bottom, then left to right, whatever the tree says. So the
    // corner's anchor starts below the home pane's top edge and above the
    // sheet's, and the three circles' slots share one top and one height.
    const [anchor] = byTestID(tree, 'corner');
    const homeTop = flat(host(panes(tree).home)).top!;
    expect(flat(anchor).top).toBeGreaterThan(homeTop);
    expect(flat(anchor).top).toBeLessThan(
      transformOf(panes(tree).sheet, 'translateY')!,
    );
    const slots = byTestID(tree, 'home-slot').map(flat);
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map(slot => slot.height)).size).toBe(1);
    expect(slots[0].height).toBeGreaterThan(0);
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

  test('as each scene settles a screen reader lands on its primary element', async () => {
    const sent = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    sent.mockClear();
    // Under Jest a host ref holds the mocked component, props and all.
    const landed = () =>
      sent.mock.calls
        .filter(([, kind]) => kind === 'focus')
        .map(
          ([node]) =>
            (node as unknown as { props: { accessibilityLabel?: string } })
              .props.accessibilityLabel,
        );
    // Focus waits for the panes, then for an idle moment: the next tick here.
    const go = async (move: () => void) => {
      await act(async () => move());
      await settle();
      await act(async () => {
        await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
      });
      return landed().at(-1);
    };
    const balance = copy.home.totalBalance(261_500, 'sats');
    const tree = await render(<OnCanvas />);
    expect(await go(() => {})).toBe(balance);
    expect(await go(() => stage.actions.openSend())).toBe(copy.scene.send);
    expect(await go(() => stage.actions.back())).toBe(balance);
    expect(await go(() => stage.actions.openActivity())).toBe(
      copy.activity.filters[FILTERS[0].value],
    );
    expect(await go(() => stage.actions.openDetail(payment))).toBe(
      copy.scene.detail,
    );
    await go(() => stage.actions.home());
    expect(await go(() => stage.actions.openSettings())).toBe(
      copy.settings.title,
    );
    expect(await go(() => stage.actions.back())).toBe(balance);
    // An overlay holds the screen, and moves focus itself; closing it lands
    // back on the scene.
    const before = landed().length;
    await go(() => stage.actions.openScan());
    expect(landed().slice(before)).not.toContain(balance);
    expect(await go(() => stage.dispatch({ type: 'back' }))).toBe(balance);
    await act(async () => tree.unmount());
  });

  test('what the wallet opens with is said once focus has landed, not cut short by it', async () => {
    jest.useFakeTimers();
    // Past the window in which a message already spoken is not repeated.
    jest.advanceTimersByTime(2_001);
    const sent = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    const said = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    sent.mockClear();
    said.mockClear();
    const backup: Backup = {
      pending: true,
      loadPhrase: jest.fn(),
      onSaved: jest.fn(),
    };
    const tree = await render(<OnCanvas backup={backup} />);
    await act(async () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 500));
    const assertive = said.mock.calls.filter(
      ([, options]) => options?.queue === false,
    );
    // A regtest wallet with its phrase still to save: both, as one message,
    // the backup first, and only after focus moved to the balance.
    expect(assertive.map(([text]) => text)).toEqual([
      [copy.health.backupPending, copy.health.testNetwork('regtest')].join(' '),
    ]);
    const focused = sent.mock.calls.findIndex(([, kind]) => kind === 'focus');
    expect(focused).toBeGreaterThanOrEqual(0);
    const spoken = said.mock.calls.findIndex(
      ([, options]) => options?.queue === false,
    );
    expect(sent.mock.invocationCallOrder[focused]).toBeLessThan(
      said.mock.invocationCallOrder[spoken],
    );
    await act(async () => tree.unmount());
    jest.useRealTimers();
  });

  test('under Reduce Motion the panes jump, nothing waits, and Settings only dims', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const tree = await render(<OnCanvas />);
    act(() => {
      stage.actions.openActivity();
      stage.actions.openDetail(payment);
    });
    expect(stage.state.scene.name).toBe('detail');
    expect(passThrough(tree)).toBe(SLOTS.length);
    expect(transformOf(panes(tree).sheet, 'translateY')).toBe(at().compact);
    // Nothing travels: the sheet, the balance and the action row crossfade
    // within 160ms, jumping halfway through while they are unseen. The
    // detail's card leaves the panes where the list had them: nothing to
    // cover.
    const jumps = delays.mock.calls.filter(
      ([delay, , reduce]) =>
        delay === durations.crossfade / 2 &&
        reduce === Reanimated.ReduceMotion.Never,
    );
    expect(jumps.map(([, to]) => to)).toEqual([at().compact, 0, 0]);
    expect(flat(panes(tree).sheet).opacity).toBe(1);
    await act(async () => stage.actions.home());
    await act(async () => stage.actions.openSettings());
    const { canvas } = panes(tree);
    expect(flat(canvas).opacity).toBe(COVERED.opacity);
    expect(flat(canvas).transform).toBeUndefined();
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion the build still holds for its crossfade', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    // The setting is read once and kept, so the canvas builds knowing it.
    const first = await render(<OnCanvas />);
    await act(async () => first.unmount());
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const tree = await render(<OnCanvas arrival="load" />);
    // Focus, and what is said after it, wait for the build to land, which
    // Reduce Motion would otherwise skip straight past.
    const holds = delays.mock.calls
      .filter(([delay]) => delay === durations.crossfade)
      .map(([, , reduce]) => reduce);
    expect(holds).toEqual([Reanimated.ReduceMotion.Never]);
    await act(async () => tree.unmount());
  });
});
