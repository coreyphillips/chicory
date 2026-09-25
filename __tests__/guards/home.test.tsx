import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import { GestureDetector } from 'react-native-gesture-handler';
import { ReduceMotion, useSharedValue } from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../src/design/copy';
import { haptics } from '../../src/design/haptics';
import { gradients } from '../../src/design/palette';
import { ActionCircle } from '../../src/scenes/home/ActionCircle';
import { Backdrop, glowBleed } from '../../src/scenes/home/Backdrop';
import { HomePane } from '../../src/scenes/home/HomePane';
import {
  LAUNCH_DROP,
  PULL_TRIGGER,
  REFUSED,
  heroPose,
  launchPose,
  pullOffset,
  pullProgress,
  tintTiming,
  vesselOpacity,
} from '../../src/scenes/home/motion';
import type { Launch } from '../../src/scenes/home/motion';
import { StatusRow } from '../../src/scenes/home/StatusRow';
import {
  backdropVisual,
  healthText,
  markVisual,
  setupOf,
} from '../../src/scenes/home/visual';
import type { HealthInput } from '../../src/scenes/home/visual';
import { HomeScreen } from '../../src/screens/Wallet';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../src/services/diagnosticLog';
import { useCanvasView } from '../../src/stage/Canvas';
import type { Backup, CanvasSession } from '../../src/stage/Canvas';
import {
  HERO_MINI,
  STATUS_ROW,
  canvasScene,
  stops,
} from '../../src/stage/layout';
import type { CanvasSceneName } from '../../src/stage/layout';
import { Pane, PanesProvider } from '../../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../../src/stage/StageContext';
import type { StageStore } from '../../src/stage/StageContext';
import { arrivals, seenIn, useIncoming } from '../../src/stage/useIncoming';
import type { Unit } from '../../src/theme';
import {
  NOW,
  activityOf,
  guardData,
  requestOf,
  snapshotOf,
} from '../../test-support/fixtures';
import type { Lfbw } from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import {
  find,
  meaning,
  press,
  pressableLabels,
} from '../../test-support/query';

/**
 * Home under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): the status row, the balance, the vessel and the actions, in
 * each wallet health state, drawn from test-support/fixtures.ts with
 * `guardData` as its data.
 *
 * Below the guard are the tables Home draws from, as plain functions, and
 * the behaviour its glyphs stand in for words: the gate, the hero's
 * gestures, the pull, the shield tile, the arrival of money, and what a
 * safety state owes beyond the screen.
 */

const session = (over: Partial<CanvasSession> = {}): CanvasSession => ({
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
  ...over,
});

const pendingBackup = (): Backup => ({
  pending: true,
  loadPhrase: jest.fn(),
  onSaved: jest.fn(),
});

const client = new DemoWalletClient();
let stage!: StageStore;

interface Drawn {
  snapshot: WalletSnapshot;
  stale?: boolean;
  session?: CanvasSession;
  backup?: Backup | null;
  hidden?: boolean;
  unit?: Unit;
  shown?: CanvasSceneName;
}

/**
 * Home's regions as the canvas draws them at home: the backdrop, the status
 * row and the home pane, on a stage and with the panes at rest.
 */
function HomeRegions({
  snapshot,
  stale = false,
  session: live = session(),
  backup = null,
  hidden = false,
  unit = 'sats',
  shown = 'home',
}: Drawn) {
  stage = useStageStore();
  const view = { ...useCanvasView(), hidden, unit };
  const panes = {
    seam: useSharedValue(0),
    hero: useSharedValue(1),
    bar: useSharedValue(1),
    cover: useSharedValue(0),
    stops: stops(844, { top: 0 }),
  };
  const region = { snapshot, client, session: live, view, stale, backup };
  return (
    <StageProvider value={stage}>
      <PanesProvider value={panes}>
        <Backdrop {...region} />
        <StatusRow {...region} shown={shown} />
        <Pane active={canvasScene(stage.state) === 'home'}>
          <HomePane {...region} home={shown === 'home'} />
        </Pane>
      </PanesProvider>
    </StageProvider>
  );
}

const MAINNET = { network: 'mainnet' as const };

/** A state drawn from `snapshot`, with the fixture data it may show. */
const state = (
  name: string,
  drawn: Omit<Drawn, 'snapshot'> & { snapshot?: WalletSnapshot } = {},
): GuardedState => {
  const snapshot = drawn.snapshot ?? snapshotOf({ wallet: MAINNET });
  return {
    name,
    render: () => mount(<HomeRegions {...drawn} snapshot={snapshot} />),
    data: guardData(snapshot),
  };
};

const channelize = (
  action: NonNullable<Lfbw['lastChannelize']>['action'],
  reason?: string,
): Partial<Lfbw> => ({ lastChannelize: { action, at: NOW, reason } });
const splice = (to: 'conflicted' | 'reverted'): Partial<Lfbw> => ({
  lastSplice: { state: to, spliceTxid: null, conflictTxid: null, at: NOW },
});
const vessel = (name: string, lfbw: Partial<Lfbw>) =>
  state(`vessel: ${name}`, {
    snapshot: snapshotOf({ wallet: MAINNET, lfbw }),
  });

const GUARDED: GuardedState[] = [
  state('fresh'),
  state('reconnecting', {
    snapshot: snapshotOf({ wallet: MAINNET, primary: { connected: false } }),
  }),
  state('stale', { stale: true }),
  state('cached launch', {
    stale: true,
    session: session({ connecting: true }),
  }),
  state('manual refresh', { session: session({ refreshing: true }) }),
  state('setup pending', {
    snapshot: snapshotOf({ wallet: MAINNET, primary: { setup: 'pending' } }),
  }),
  state('setup failed', {
    snapshot: snapshotOf({
      wallet: MAINNET,
      primary: {
        setup: 'failed',
        setupError: 'Liquidity provider is unavailable.',
      },
    }),
  }),
  state('refresh failed', {
    session: session({ error: 'Electrum is offline.' }),
  }),
  state('hidden', { hidden: true }),
  state('btc', { unit: 'btc' }),
  state('test network', { snapshot: snapshotOf() }),
  state('backup pending', { backup: pendingBackup() }),
  state('an uncertain payment', {
    snapshot: snapshotOf({
      wallet: MAINNET,
      activity: [activityOf('sent', 'uncertain')],
    }),
  }),
  state('an offline request open', {
    snapshot: snapshotOf({
      wallet: MAINNET,
      activity: [
        activityOf('request', 'pending', {
          receiveRequest: requestOf({ offlineReceive: true }),
        }),
      ],
    }),
  }),
  state('an empty wallet', {
    snapshot: snapshotOf({
      wallet: MAINNET,
      balance: { totalSats: 0, availableSats: 0, pendingSats: 0 },
    }),
  }),
  state('vessel: settled', {
    snapshot: snapshotOf({
      wallet: MAINNET,
      balance: { totalSats: 250_000, pendingSats: 0 },
    }),
  }),
  vessel('in flight', {}),
  vessel('below the floor', channelize('wait', 'below-floor')),
  vessel('splice-in', channelize('splice-in')),
  vessel('open', channelize('open')),
  vessel('open-v2', channelize('open-v2')),
  vessel('fee too high', channelize('wait', 'fee-too-high')),
  vessel('failed', channelize('failed')),
  vessel('splicing', channelize('wait', 'splicing')),
  vessel('channel pending', channelize('wait', 'channel-pending')),
  vessel('unconfirmed', channelize('wait', 'unconfirmed')),
  vessel('splice conflicted', splice('conflicted')),
  vessel('splice reverted', splice('reverted')),
  vessel('unpaired funding', { unpairedFunding: { at: NOW } }),
  state('vessel: hidden', {
    hidden: true,
    snapshot: snapshotOf({ wallet: MAINNET, lfbw: channelize('failed') }),
  }),
];

guard('home', GUARDED);

async function draw(drawn: Drawn): Promise<ReactTestRenderer> {
  return mount(<HomeRegions {...drawn} />);
}

/** The first control labelled `label`, pressable or not. */
const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type !== 'string' && node.props.accessibilityLabel === label,
  )[0];

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) as {
    opacity?: number;
    transform?: Record<string, number>[];
  };
const scaleOf = (node: ReactTestInstance) =>
  flat(node).transform?.find(step => 'scale' in step)?.scale;

/** The views that pose each action circle in the row, in order. */
const circles = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ActionCircle).map(circle => circle.parent!);

afterEach(() => jest.restoreAllMocks());

describe('the mark', () => {
  const input = (over: Partial<HealthInput> = {}): HealthInput => ({
    snapshot: snapshotOf({ wallet: MAINNET }),
    stale: false,
    refreshing: false,
    connecting: false,
    error: '',
    backupPending: false,
    ...over,
  });

  test('a ready wallet is a full, still, live bloom with a live dot', () => {
    expect(markVisual(input())).toEqual({
      mode: 'still',
      open: 1,
      tone: 'live',
      halo: false,
      droop: false,
      flask: false,
      pulse: 'live',
    });
  });

  test.each<
    [string, Partial<HealthInput>, Partial<ReturnType<typeof markVisual>>]
  >([
    ['a refresh ratchets it', { refreshing: true }, { mode: 'ratchet' }],
    ['a cached launch ratchets it', { connecting: true }, { mode: 'ratchet' }],
    [
      'setup under way opens it to .6, breathing',
      {
        snapshot: snapshotOf({
          wallet: MAINNET,
          primary: { setup: 'pending' },
        }),
      },
      { mode: 'breathe', open: 0.6 },
    ],
    [
      'setup that failed droops it',
      {
        snapshot: snapshotOf({ wallet: MAINNET, primary: { setup: 'failed' } }),
      },
      { droop: true, open: 0.8 },
    ],
    ['an old balance makes it dormant', { stale: true }, { tone: 'dormant' }],
    [
      'a test network makes it slate, with a flask',
      { snapshot: snapshotOf() },
      { tone: 'test', flask: true },
    ],
    ['a backup to save haloes it', { backupPending: true }, { halo: true }],
    [
      'a failed refresh hollows the dot',
      { error: 'offline' },
      { pulse: 'failed' },
    ],
    [
      'a lost connection pulses the dot',
      {
        snapshot: snapshotOf({
          wallet: MAINNET,
          primary: { connected: false },
        }),
      },
      { pulse: 'reconnecting' },
    ],
  ])('%s', (_name, over, look) => {
    expect(markVisual(input(over))).toMatchObject(look);
  });

  test('a wallet without lightning-first funding has no setup to wait for', () => {
    expect(
      setupOf(
        snapshotOf({ lfbw: { enabled: false }, primary: { setup: 'pending' } }),
      ),
    ).toBe('ready');
    expect(
      setupOf(snapshotOf({ primary: { setup: 'pending', setupError: 'x' } })),
    ).toBe('failed');
  });

  test('says the connection, the network off mainnet and a backup to save', () => {
    expect(healthText(input())).toBe(copy.health.fresh);
    const text = healthText(
      input({ snapshot: snapshotOf(), backupPending: true }),
    );
    expect(text).toContain(copy.health.fresh);
    expect(text).toContain(copy.health.testNetwork('regtest'));
    expect(text).toContain('Save your recovery phrase.');
  });

  test('a failed refresh says what the notice said, with the reason', () => {
    expect(healthText(input({ error: 'Electrum is offline.' }))).toContain(
      'Could not refresh. Showing the last known state. Electrum is offline.',
    );
  });

  test('says how old the balance is, and why setup stopped', () => {
    expect(healthText(input({ stale: true }))).toContain(copy.health.stale);
    expect(healthText(input({ stale: true, connecting: true }))).toContain(
      copy.health.cached,
    );
    const failed = snapshotOf({
      wallet: MAINNET,
      primary: { setup: 'failed', setupError: 'Provider unavailable.' },
    });
    expect(healthText(input({ snapshot: failed }))).toContain(
      `${copy.health.setupFailed} Provider unavailable.`,
    );
  });
});

describe('the backdrop', () => {
  const look = (
    snapshot: WalletSnapshot,
    over: { stale?: boolean; backupPending?: boolean } = {},
  ) =>
    backdropVisual({
      snapshot,
      stale: false,
      backupPending: false,
      ...over,
    });

  test('a calm mainnet wallet has the bloom glow and no tint', () => {
    expect(look(snapshotOf({ wallet: MAINNET }))).toEqual({
      glow: 'bloom',
      dim: false,
      tint: null,
    });
  });

  test('honey for a backup or an unknown outcome, night for an open offline request', () => {
    expect(look(snapshotOf(), { backupPending: true }).tint).toBe('honey');
    expect(
      look(snapshotOf({ activity: [activityOf('sent', 'uncertain')] })).tint,
    ).toBe('honey');
    const offline = (expiresAt: number) =>
      snapshotOf({
        activity: [
          activityOf('request', 'pending', {
            receiveRequest: requestOf({ offlineReceive: true, expiresAt }),
          }),
        ],
      });
    expect(look(offline(NOW + 60_000)).tint).toBe('night');
    expect(look(offline(NOW - 1)).tint).toBeNull();
  });

  test('the drifting glows reach past every edge, however far they drift and turn', () => {
    const { x, y, rotate } = gradients.G1.drift;
    const turn = (rotate * Math.PI) / 180;
    const signs = [-1, 1];
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [1024, 1366],
    ]) {
      const bleed = glowBleed(width, height);
      // Each corner of the pane, seen from the layer, which has drifted and
      // turned about its own centre: it must still fall inside the layer.
      for (const [cornerX, cornerY, driftX, driftY, spin] of signs.flatMap(a =>
        signs.flatMap(b =>
          signs.flatMap(c =>
            signs.flatMap(d => signs.map(e => [a, b, c, d, e])),
          ),
        ),
      )) {
        const px = (cornerX * width) / 2 - driftX * x * width;
        const py = (cornerY * height) / 2 - driftY * y * height;
        const angle = spin * turn;
        const lx = px * Math.cos(angle) + py * Math.sin(angle);
        const ly = py * Math.cos(angle) - px * Math.sin(angle);
        expect(Math.abs(lx)).toBeLessThanOrEqual(width / 2 + bleed);
        expect(Math.abs(ly)).toBeLessThanOrEqual(height / 2 + bleed);
      }
    }
  });

  test('an old balance dims the glow, and a test network turns it slate', () => {
    expect(look(snapshotOf({ wallet: MAINNET }), { stale: true }).dim).toBe(
      true,
    );
    expect(look(snapshotOf()).glow).toBe('slate');
  });
});

describe('the motion', () => {
  test('the pull follows the finger at half, then gives less and less', () => {
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(40)).toBe(20);
    expect(pullOffset(PULL_TRIGGER)).toBe(PULL_TRIGGER / 2);
    expect(pullOffset(PULL_TRIGGER + 400)).toBeLessThan(PULL_TRIGGER / 2 + 28);
    expect(pullOffset(PULL_TRIGGER + 40)).toBeGreaterThan(
      pullOffset(PULL_TRIGGER),
    );
    expect(pullProgress(PULL_TRIGGER / 2)).toBe(0.5);
    expect(pullProgress(PULL_TRIGGER * 2)).toBe(1);
  });

  test('a tint plays under Reduce Motion, and a refused action tints for 400ms', () => {
    expect(tintTiming(600).reduceMotion).toBe(ReduceMotion.Never);
    expect(tintTiming(600).duration).toBe(600);
    expect(REFUSED.in + REFUSED.out).toBe(400);
  });

  test('the hero shrinks into the middle of the status row', () => {
    const frame = { y: 40, height: 80 };
    expect(heroPose(1, frame)).toEqual({ scale: 1, translateY: 0 });
    const mini = heroPose(0, frame);
    expect(mini.scale).toBeCloseTo(HERO_MINI);
    // Scaled from its top edge, the strip's centre lands on the row's.
    const centre = frame.y + mini.translateY + (mini.scale * frame.height) / 2;
    expect(centre).toBeCloseTo(-STATUS_ROW / 2);
  });

  test('the vessel is gone before the hero has shrunk far', () => {
    expect(vesselOpacity(1)).toBe(1);
    expect(vesselOpacity(0.85)).toBeCloseTo(0.5);
    expect(vesselOpacity(0.7)).toBe(0);
    expect(vesselOpacity(0)).toBe(0);
  });

  test('the tapped circle grows toward the 88pt control, and the rest shrink', () => {
    const rest = { scale: 1, translateX: 0, translateY: 0 };
    expect(launchPose(1, true, 'none', 120)).toEqual(rest);
    expect(launchPose(0, true, 'send', 120)).toEqual(rest);
    const tapped = launchPose(1, true, 'send', 120);
    expect(tapped.scale * 56).toBeCloseTo(88);
    expect(tapped.translateX).toBe(120);
    expect(tapped.translateY).toBe(LAUNCH_DROP);
    expect(launchPose(0.5, true, 'send', 120).translateX).toBe(60);
    expect(launchPose(0.5, false, 'send').scale).toBeCloseTo(0.8);
  });
});

describe('the actions', () => {
  test('are Send, Scan and Receive, in that order', async () => {
    const tree = await draw({ snapshot: snapshotOf({ wallet: MAINNET }) });
    const said = meaning(tree);
    const at = ['Send', 'Scan a payment request', 'Receive'].map(label =>
      said.indexOf(label),
    );
    expect(at.every(index => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    await act(async () => tree.unmount());
  });

  test('open their scenes, and Scan grows from where the circle is', async () => {
    const tree = await draw({ snapshot: snapshotOf({ wallet: MAINNET }) });
    const scan = jest.spyOn(stage.actions, 'openScan');
    const circle = find(tree, 'Scan a payment request')!;
    // Where the window says the circle is, as a device would answer.
    jest
      .mocked(circle.findByType(View).instance.measureInWindow)
      .mockImplementationOnce(
        (done: (x: number, y: number, w: number, h: number) => void) =>
          done(100, 600, 76, 76),
      );
    await act(async () => {
      circle.props.onPressIn();
      circle.props.onPress();
    });
    expect(scan).toHaveBeenCalledWith({ x: 138, y: 638 });
    expect(stage.state.overlay?.name).toBe('scan');
    await act(async () => tree.unmount());

    for (const [label, scene] of [
      ['Send', 'send'],
      ['Receive', 'receive'],
    ]) {
      const again = await draw({ snapshot: snapshotOf({ wallet: MAINNET }) });
      await press(again, label);
      expect(stage.state.scene.name).toBe(scene);
      await act(async () => again.unmount());
    }
  });

  test('when the balance is old, a tap refreshes instead, and nothing opens', async () => {
    const live = session();
    const warned = jest.spyOn(haptics, 'warning');
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      stale: true,
      session: live,
    });
    warned.mockClear();
    for (const circle of circles(tree)) {
      expect(scaleOf(circle)).toBeCloseTo(0.94);
    }
    for (const label of ['Send', 'Scan a payment request', 'Receive']) {
      expect(find(tree, label)!.props.accessibilityState.disabled).toBe(true);
      await press(tree, label);
    }
    expect(live.manualRefresh).toHaveBeenCalledTimes(3);
    expect(warned).toHaveBeenCalledTimes(3);
    expect(stage.state.scene.name).toBe('home');
    expect(stage.state.overlay).toBeNull();
    await act(async () => tree.unmount());
  });
});

describe('on the way to Send', () => {
  /** Home with the panes already on their way: the hero and the row gone. */
  function Leaving({ launching }: { launching: Launch }) {
    const hero = useSharedValue(0);
    const bar = useSharedValue(0);
    return (
      <HomeScreen
        snapshot={snapshotOf({ wallet: MAINNET })}
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
        progress={{ hero, bar }}
        launching={launching}
      />
    );
  }
  test('the balance is the mini strip, the row has faded and the Send circle grows', async () => {
    const tree = await mount(<Leaving launching="send" />);
    const part = (testID: string) =>
      tree.root.find(
        node => typeof node.type === 'string' && node.props.testID === testID,
      );
    expect(scaleOf(part('home-hero'))).toBeCloseTo(HERO_MINI);
    expect(flat(part('home-bar')).opacity).toBe(0);
    const [send, scan, receive] = circles(tree);
    expect(scaleOf(send)! * 56).toBeCloseTo(88);
    expect(scaleOf(scan)).toBeCloseTo(0.8);
    expect(scaleOf(receive)).toBeCloseTo(0.8);
    await act(async () => tree.unmount());
  });
});

describe('the hero', () => {
  async function hero(hidden = false) {
    const onToggleUnit = jest.fn();
    const onToggleHidden = jest.fn();
    const tree = await mount(
      <HomeScreen
        snapshot={snapshotOf({ wallet: MAINNET })}
        hidden={hidden}
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
        onToggleUnit={onToggleUnit}
        onToggleHidden={onToggleHidden}
      />,
    );
    const label = hidden ? 'Balance hidden' : 'Total balance 261,500 sats';
    return { tree, onToggleUnit, onToggleHidden, balance: find(tree, label)! };
  }

  test('a tap rolls the unit and a long press hides the balance', async () => {
    const { tree, onToggleUnit, onToggleHidden, balance } = await hero();
    await act(async () => balance.props.onPress());
    expect(onToggleUnit).toHaveBeenCalledTimes(1);
    await act(async () => balance.props.onLongPress());
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a screen reader has both as actions, named for what they do', async () => {
    for (const hidden of [false, true]) {
      const { tree, onToggleUnit, onToggleHidden, balance } = await hero(
        hidden,
      );
      expect(balance.props.accessibilityActions).toEqual([
        { name: 'unit', label: 'Switch unit' },
        { name: 'mask', label: hidden ? 'Show balance' : 'Hide balance' },
      ]);
      for (const actionName of ['unit', 'mask']) {
        await act(async () =>
          balance.props.onAccessibilityAction({ nativeEvent: { actionName } }),
        );
      }
      expect(onToggleUnit).toHaveBeenCalledTimes(1);
      expect(onToggleHidden).toHaveBeenCalledTimes(1);
      await act(async () => tree.unmount());
    }
  });

  test('reads in the unit on screen, and nothing but that it is hidden', async () => {
    let tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      unit: 'btc',
    });
    expect(meaning(tree)).toContain(copy.home.totalBalance(261_500, 'btc'));
    await act(async () => tree.unmount());
    tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      hidden: true,
    });
    const said = meaning(tree);
    expect(said).toContain('Balance hidden');
    for (const figure of ['261,500', '250,000', '11,500']) {
      expect(said).not.toContain(figure);
    }
    await act(async () => tree.unmount());
  });
});

describe('the pull', () => {
  const pan = (tree: ReactTestRenderer) =>
    tree.root.findByType(HomeScreen).findByType(GestureDetector).props.gesture;

  test('letting go once the bloom is fully open refreshes, and short of it does not', async () => {
    const live = session();
    const soft = jest.spyOn(haptics, 'soft');
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      session: live,
    });
    await act(async () =>
      fireGestureHandler(pan(tree), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 40 },
        { state: State.ACTIVE, translationY: PULL_TRIGGER - 1 },
        { state: State.END, translationY: PULL_TRIGGER - 1 },
      ]),
    );
    expect(live.manualRefresh).not.toHaveBeenCalled();
    await act(async () =>
      fireGestureHandler(pan(tree), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 40 },
        { state: State.ACTIVE, translationY: PULL_TRIGGER + 20 },
        { state: State.END, translationY: PULL_TRIGGER + 20 },
      ]),
    );
    expect(live.manualRefresh).toHaveBeenCalledTimes(1);
    expect(soft).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('is off away from home', async () => {
    const live = session();
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      session: live,
    });
    await act(async () => stage.actions.openActivity());
    const gesture = pan(tree);
    expect(gesture.config.enabled).toBe(false);
    await act(async () => tree.unmount());
  });
});

describe('the status row', () => {
  test('the mark refreshes, and a failed refresh is its value, not a notice', async () => {
    const live = session({ error: 'Electrum is offline.' });
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      session: live,
    });
    const mark = find(tree, 'Refresh wallet')!;
    expect(mark.props.accessibilityValue.text).toContain(
      copy.health.refreshFailedDetail('Electrum is offline.'),
    );
    expect(
      tree.root.findAll(node => node.props.accessibilityRole === 'alert'),
    ).toEqual([]);
    await press(tree, 'Refresh wallet');
    expect(live.manualRefresh).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('while a refresh runs the mark is busy', async () => {
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      session: session({ refreshing: true }),
    });
    expect(control(tree, 'Refresh wallet').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await act(async () => tree.unmount());
  });

  test('the wallet name and the network are not written on it', async () => {
    const tree = await draw({ snapshot: snapshotOf() });
    const row = tree.root.findByType(StatusRow);
    expect(row.findAllByType(Text)).toEqual([]);
    expect(meaning(tree)).not.toContain('Everyday');
    expect(meaning(tree)).toContain(copy.health.testNetwork('regtest'));
    await act(async () => tree.unmount());
  });

  test('a backup to save is a tile at home that opens Settings, and cannot be dismissed', async () => {
    const tree = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      backup: pendingBackup(),
    });
    expect(
      find(tree, 'Refresh wallet')!.props.accessibilityValue.text,
    ).toContain('Save your recovery phrase.');
    expect(pressableLabels(tree)).not.toContain('Reveal recovery phrase');
    await press(tree, 'Save your recovery phrase.');
    expect(stage.state.scene.name).toBe('settings');
    await act(async () => tree.unmount());

    const away = await draw({
      snapshot: snapshotOf({ wallet: MAINNET }),
      backup: pendingBackup(),
      shown: 'activity',
    });
    expect(find(away, 'Save your recovery phrase.')).toBeUndefined();
    await act(async () => away.unmount());
  });
});

describe('safety states', () => {
  const assertive = () =>
    jest
      .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
      .mock.calls.filter(([, options]) => options?.queue === false)
      .map(([text]) => text);

  test('each is felt, spoken assertively and logged as it begins', async () => {
    jest.useFakeTimers();
    // Past the window in which a message already spoken is not repeated.
    jest.advanceTimersByTime(2_001);
    jest
      .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
      .mockClear();
    clearDiagnostics();
    const warned = jest.spyOn(haptics, 'warning');
    const snapshot = snapshotOf({ wallet: { network: 'testnet' } });
    const tree = await draw({ snapshot, stale: true, backup: pendingBackup() });
    const said = [
      copy.health.stale,
      copy.health.backupPending,
      copy.health.testNetwork('testnet'),
    ];
    expect(assertive()).toEqual(expect.arrayContaining(said));
    expect(recentDiagnostics().map(entry => entry.message)).toEqual(
      expect.arrayContaining(said),
    );
    expect(warned).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
    jest.useRealTimers();
  });
});

describe('money arriving', () => {
  const received = (
    status: Activity['status'],
    over: Partial<Activity> & { seed?: number } = {},
  ) => activityOf('received', status, { seed: 1, ...over });

  test('counts a received payment that completes, and a new one that arrives complete', () => {
    const before = seenIn([received('pending')]);
    expect(arrivals(before, [received('completed')])).toHaveLength(1);
    expect(arrivals(seenIn([]), [received('completed')])).toHaveLength(1);
    // A request paid becomes a received payment under the same id.
    const request = activityOf('request', 'pending', { seed: 2 });
    expect(
      arrivals(seenIn([request]), [
        { ...request, kind: 'received', status: 'completed' },
      ]),
    ).toHaveLength(1);
  });

  test('counts nothing already there, sent, or still on its way', () => {
    const done = received('completed');
    expect(arrivals(seenIn([done]), [done])).toEqual([]);
    expect(
      arrivals(seenIn([]), [activityOf('sent', 'completed', { seed: 3 })]),
    ).toEqual([]);
    expect(arrivals(seenIn([]), [received('pending')])).toEqual([]);
  });

  /** Reports what `useIncoming` counts for the snapshot it is given. */
  function Watch({
    snapshot,
    seen,
  }: {
    snapshot: WalletSnapshot;
    seen: number[];
  }) {
    seen.push(useIncoming(snapshot));
    return null;
  }

  test('is felt once, and never on the first read or an ordinary poll', async () => {
    const felt = jest.spyOn(haptics, 'incoming');
    const seen: number[] = [];
    const first = snapshotOf({
      activity: [received('completed', { seed: 7 })],
    });
    const tree = await mount(
      <>
        <Watch snapshot={first} seen={seen} />
        <Watch snapshot={first} seen={[]} />
      </>,
    );
    const next = (snapshot: WalletSnapshot) =>
      act(async () =>
        tree.update(
          <>
            <Watch snapshot={snapshot} seen={seen} />
            <Watch snapshot={snapshot} seen={[]} />
          </>,
        ),
      );
    // An ordinary poll: a new read of the same history.
    await next({ ...first, updatedAt: NOW + 12_000 });
    expect(felt).not.toHaveBeenCalled();
    const pending = received('pending', { seed: 8 });
    await next(snapshotOf({ activity: [pending, ...first.activity] }));
    expect(felt).not.toHaveBeenCalled();
    await next(
      snapshotOf({
        activity: [{ ...pending, status: 'completed' }, ...first.activity],
      }),
    );
    // Two watchers saw it, and it was felt once.
    expect(felt).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toBe(1);
    await act(async () => tree.unmount());
  });

  test('is not felt for what completed while the app was away', async () => {
    const felt = jest.spyOn(haptics, 'incoming');
    const listeners: ((state: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_, listener) => {
        listeners.push(listener as (state: string) => void);
        return { remove: jest.fn() } as never;
      });
    const pending = received('pending', { seed: 9 });
    const seen: number[] = [];
    const tree = await mount(
      <Watch snapshot={snapshotOf({ activity: [pending] })} seen={seen} />,
    );
    await act(async () =>
      listeners.forEach(listener => listener('background')),
    );
    await act(async () =>
      tree.update(
        <Watch
          snapshot={snapshotOf({
            activity: [{ ...pending, status: 'completed' }],
          })}
          seen={seen}
        />,
      ),
    );
    expect(felt).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(0);
    await act(async () => tree.unmount());
  });
});
