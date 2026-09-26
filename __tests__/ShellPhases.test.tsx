import React from 'react';
import {
  AppState,
  Dimensions,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../src/design/copy';
import { palette } from '../src/design/palette';
import { Bloom } from '../src/glyphs/Bloom';
import { WhisperProvider } from '../src/glyphs/Whisper';
import { OpeningWallet } from '../src/scenes/phases/Loading';
import { Opening } from '../src/scenes/phases/Opening';
import { Picker } from '../src/scenes/phases/Picker';
import { TONE_WAIT_MS, openingNetwork } from '../src/scenes/phases/visual';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../src/services/diagnosticLog';
import { defaultProfile } from '../src/services/networks';
import type { useWalletSession } from '../src/services/useWalletSession';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import { HOME, STATUS_ROW, heroBox, stops } from '../src/stage/layout';
import { Pane } from '../src/stage/panes/Pane';
import type { Phase } from '../src/stage/phase';
import { Stage, coverAfter } from '../src/stage/Stage';
import * as systemPrompt from '../src/stage/systemPrompt';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { snapshotOf, walletOf } from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { pressableLabels } from '../test-support/query';

/**
 * The stage and the shell phases as a device showed them (the P7 walk on the
 * iOS simulator), each held to what REDESIGN.md asks.
 */

type Transform = Record<string, number | string>[];
const flat = (node: ReactTestInstance) =>
  (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown> & {
    transform?: Transform;
  };
const transformOf = (node: ReactTestInstance, key: string) =>
  flat(node).transform?.find(step => key in step)?.[key];
/** The first host view a component draws, where its style lands. */
const host = (node: ReactTestInstance) =>
  node.findAll(inner => typeof inner.type === 'string')[0];
const byTestID = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  );

afterEach(() => jest.restoreAllMocks());

/*
 * The canvas, as the stage draws it.
 */

const client = new DemoWalletClient();
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

function OnCanvas({
  read = snapshotOf(),
  live = session,
}: {
  read?: WalletSnapshot;
  live?: React.ComponentProps<typeof Canvas>['session'];
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
          session={live}
          stale={false}
          backup={null}
          view={view}
        />
      </StageProvider>
    </GestureHandlerRootView>
  );
}

/*
 * The shell phases and the stage.
 */

type Session = ReturnType<typeof useWalletSession>;
const wallet = walletOf();

function sessionOf(over: Partial<Session> = {}): Session {
  const values: Partial<Session> = {
    snapshot: null,
    client: client as unknown as Session['client'],
    wallets: [wallet],
    walletId: wallet.id,
    error: '',
    switchError: '',
    closing: false,
    switching: false,
    erasing: false,
    switchTarget: null,
    connecting: false,
    selecting: false,
    refreshing: false,
    initializing: false,
    networkEditor: false,
    deviceVisible: false,
    deviceHint: true,
    activeProfile: defaultProfile(wallet.network),
    rememberedSession: null,
    ...over,
  };
  const calls = new Map<PropertyKey, jest.Mock>();
  return new Proxy(values, {
    get: (target, key) => {
      if (key in target) return target[key as keyof Session];
      if (!calls.has(key)) calls.set(key, jest.fn());
      return calls.get(key);
    },
  }) as Session;
}

function Staged({ phase, live }: { phase: Phase; live: Session }) {
  stage = useStageStore();
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView>
        <StageProvider value={stage}>
          <Stage phase={phase} session={live} onUnlock={jest.fn()} />
        </StageProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

describe('a wallet read that keeps failing', () => {
  // The canvas keeps the last figures and only draws them as old, so the
  // reason was nowhere to be read (a phone showed a stale history for many
  // minutes with no word of why).
  test('is logged once for each reason, for Diagnostics to show', async () => {
    clearDiagnostics();
    const live = sessionOf({ snapshot: snapshotOf() });
    const at = (error: string) => (
      <Staged phase={{ kind: 'wallet', error }} live={live} />
    );
    const failures = () =>
      recentDiagnostics().filter(entry => entry.code === 'REFRESH_FAILED');
    const tree = await mount(at(''));
    expect(failures()).toEqual([]);
    const reason = 'The wallet returned an incomplete snapshot.';
    await act(async () => tree.update(at(reason)));
    await act(async () => tree.update(at(reason)));
    expect(failures().map(entry => entry.message)).toEqual([reason]);
    expect(failures()[0].phase).toBe('ui');
    // Another reason is logged too, and the same one again once it has
    // cleared and come back.
    await act(async () => tree.update(at('Request timed out.')));
    await act(async () => tree.update(at('')));
    await act(async () => tree.update(at(reason)));
    expect(failures().map(entry => entry.message)).toEqual([
      reason,
      'Request timed out.',
      reason,
    ]);
    await act(async () => tree.unmount());
  });
});

describe('the app switcher', () => {
  /**
   * The cover after each of `steps`, a change of the app's state and
   * whether a prompt the app raised was up as it came, from the front.
   */
  const through = (
    steps: Array<[string | null, boolean?]>,
    from = false,
  ): boolean[] => {
    const seen: boolean[] = [];
    steps.reduce((covered, [state, prompting = false]) => {
      const next = coverAfter(covered, state, prompting);
      seen.push(next);
      return next;
    }, from);
    return seen;
  };

  test('covers in the background always, and inactive unless a prompt the app raised is up', () => {
    for (const from of [false, true]) {
      expect(coverAfter(from, 'background', false)).toBe(true);
      expect(coverAfter(from, 'background', true)).toBe(true);
      expect(coverAfter(from, 'inactive', false)).toBe(true);
      expect(coverAfter(from, 'active', false)).toBe(false);
      expect(coverAfter(from, 'active', true)).toBe(false);
    }
    // The paste permission over Send, or the camera's over the scan.
    expect(coverAfter(false, 'inactive', true)).toBe(false);
    // In front, or unknown from the front, nothing covers.
    expect(coverAfter(false, 'unknown', false)).toBe(false);
    expect(coverAfter(false, null, false)).toBe(false);
  });

  test('once up it stays up, whatever comes, until the app is in front again', () => {
    // The device pass (P12): switching to another app, the cover showed
    // for three frames and then the wallet was drawn again in the outgoing
    // card for about 300ms of the system's zoom.
    // Leaving for another app: up with the first step out, and held.
    expect(through([['inactive'], ['background'], ['active']])).toEqual([
      true,
      true,
      false,
    ]);
    // A prompt's window that opens on the way out lowers nothing.
    expect(through([['inactive'], ['inactive', true], ['background']])).toEqual(
      [true, true, true],
    );
    // Nor one still open as the app comes back through inactive.
    expect(through([['background'], ['inactive', true], ['active']])).toEqual([
      true,
      true,
      false,
    ]);
    // Nor a state the app cannot name.
    expect(through([['inactive'], ['unknown'], [null]])).toEqual([
      true,
      true,
      true,
    ]);
    // Behind a prompt the app raised the screen stays, and leaving from
    // behind it covers all the same.
    expect(
      through([
        ['inactive', true],
        ['active'],
        ['inactive', true],
        ['background'],
      ]),
    ).toEqual([false, false, false, true]);
  });

  test('leaves the screen in place behind a prompt the app raised', async () => {
    const heard = new Set<(state: AppStateStatus) => void>();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((kind, handler) => {
        const listener = handler as (state: AppStateStatus) => void;
        if (kind === 'change') heard.add(listener);
        return { remove: () => heard.delete(listener) } as never;
      });
    const change = (state: AppStateStatus) => {
      for (const listener of [...heard]) listener(state);
    };
    const live = sessionOf({ snapshot: snapshotOf() });
    const tree = await mount(
      <Staged phase={{ kind: 'wallet', error: '' }} live={live} />,
    );
    // Inactive with no prompt of the app's up is the switcher.
    await act(async () => change('inactive'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(1);
    await act(async () => change('active'));
    // A paste asks the system, which puts its prompt over the app: the span
    // `duringSystemPrompt` marks.
    const prompting = jest
      .spyOn(systemPrompt, 'systemPromptOpen')
      .mockReturnValue(true);
    await act(async () => change('inactive'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    await act(async () => change('active'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    // Going to the background covers, prompt or not.
    await act(async () => change('inactive'));
    await act(async () => change('background'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(1);
    await act(async () => change('active'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    // Once the prompt has settled, inactive is the switcher again.
    prompting.mockReturnValue(false);
    await act(async () => change('inactive'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('sees roast and the mark, never the balance, while the app is not in front', async () => {
    // Every listener the app sets up hears the same changes.
    const heard = new Set<(state: AppStateStatus) => void>();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((kind, handler) => {
        const listener = handler as (state: AppStateStatus) => void;
        if (kind === 'change') heard.add(listener);
        return { remove: () => heard.delete(listener) } as never;
      });
    const change = (state: AppStateStatus) => {
      for (const listener of [...heard]) listener(state);
    };
    const live = sessionOf({ snapshot: snapshotOf() });
    const tree = await mount(
      <Staged phase={{ kind: 'wallet', error: '' }} live={live} />,
    );
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    await act(async () => change('inactive'));
    const [cover] = byTestID(tree, 'privacy-cover');
    expect(flat(cover)).toMatchObject({ backgroundColor: palette.roast });
    // Plain on iOS, as the native cover the switcher keeps is; the mark
    // elsewhere.
    expect(cover.findAllByType(Bloom)).toHaveLength(
      Platform.OS === 'ios' ? 0 : 1,
    );
    // Up at once: nothing fades that the switcher could catch half drawn,
    // and nothing of it, the mark's petals included, fades as it goes.
    expect(cover.props.entering).toBeUndefined();
    // The host view, the View drawing it, and the config around that.
    const config = cover.parent!.parent!;
    expect(config.type).toBe(LayoutAnimationConfig);
    expect(config.props).toMatchObject({
      skipEntering: true,
      skipExiting: true,
    });
    await act(async () => change('active'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    // The lock hides the wallet itself, and its bud stays in view.
    await act(async () =>
      tree.update(
        <Staged
          phase={{ kind: 'locked', prompting: true, error: '' }}
          live={live}
        />,
      ),
    );
    await act(async () => change('inactive'));
    expect(byTestID(tree, 'privacy-cover')).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});

describe('the opening loader', () => {
  test('knows the network it opens on from the saved session, or the profile the restore settles on', () => {
    const first = defaultProfile('mainnet');
    // Nothing read yet: the session's profile is a stand-in.
    expect(openingNetwork(null, first, first)).toBeNull();
    // The saved session is read first, and names it.
    expect(openingNetwork({ network: 'regtest' }, first, first)).toBe(
      'regtest',
    );
    // With none saved, the profile the restore settles on does.
    expect(openingNetwork(null, defaultProfile('regtest'), first)).toBe(
      'regtest',
    );
    expect(openingNetwork(null, defaultProfile('mainnet'), first)).toBe(
      'mainnet',
    );
  });

  test('holds back until it knows the network, so a test network never chases in bloom', async () => {
    // The device pass (P12): on a regtest wallet the chase was bloom blue
    // until the saved profile was read, then turned slate mid-chase.
    jest.useFakeTimers();
    try {
      const first = defaultProfile('mainnet');
      const staged = (over: Partial<Session>) => (
        <Staged
          phase={{ kind: 'opening' }}
          live={sessionOf({
            client: null,
            initializing: true,
            activeProfile: first,
            ...over,
          })}
        />
      );
      const tree = await mount(staged({}));
      const blooms = () => tree.root.findAllByType(Bloom);
      expect(blooms()).toEqual([]);
      // The saved session is read, and it chases in slate from its first
      // frame.
      await act(async () =>
        tree.update(
          staged({
            rememberedSession: {
              mode: 'device',
              network: 'regtest',
              locked: false,
            },
          }),
        ),
      );
      expect(blooms().map(bloom => bloom.props.tone)).toEqual(['test']);
      await act(async () => tree.unmount());
      // A network never known holds it back only so long.
      const slow = await mount(staged({}));
      await act(async () => jest.advanceTimersByTime(TONE_WAIT_MS - 1));
      expect(slow.root.findAllByType(Bloom)).toEqual([]);
      await act(async () => jest.advanceTimersByTime(1));
      expect(
        slow.root.findAllByType(Bloom).map(bloom => bloom.props.tone),
      ).toEqual(['live']);
      await act(async () => slow.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  test('chases in the network’s tone, slate off mainnet', async () => {
    const tree = await mount(
      <GestureHandlerRootView>
        <WhisperProvider>
          <Opening network="regtest" />
        </WhisperProvider>
      </GestureHandlerRootView>,
    );
    expect(tree.root.findByType(Bloom).props.tone).toBe('test');
    await act(async () => tree.unmount());
  });
});

describe('the picker', () => {
  const picker = (wallets = [wallet]) =>
    mount(
      <GestureHandlerRootView>
        <Phased>
          <Picker
            wallets={wallets}
            activeProfile={defaultProfile('regtest')}
            error=""
            switchError=""
            networkEditor={false}
            selecting={false}
            switchNetwork={jest.fn(async () => {})}
            setNetworkEditor={jest.fn()}
            selectWallet={jest.fn(async () => {})}
            createDefaultWallet={jest.fn(async () => {})}
            disconnect={jest.fn(async () => {})}
            onCreateWallet={jest.fn()}
          />
        </Phased>
      </GestureHandlerRootView>,
    );

  test('always offers the sprout row, after the saved wallets, and the tools at the foot', async () => {
    const tree = await picker();
    expect([...pressableLabels(tree)]).toEqual([
      copy.phase.openWallet(wallet.name),
      copy.phase.createWallet,
      copy.phase.restore,
      copy.phase.networkSettings,
      copy.phase.lockDevice,
    ]);
    // The rows fill the middle of the page, so the tools sit at its foot.
    const root = host(tree.root.findByType(Picker));
    expect(flat(root).justifyContent).toBe('space-between');
    const [middle, tools] = root.children as ReactTestInstance[];
    expect(flat(middle).flexGrow).toBe(1);
    expect(
      tools.findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          node.props.accessibilityLabel === copy.phase.lockDevice,
      ).length,
    ).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });
});

/** A stage of its own, for a phase drawn alone. */
function Phased({ children }: { children: React.ReactNode }) {
  const own = useStageStore();
  return <StageProvider value={own}>{children}</StageProvider>;
}

describe('the loading page', () => {
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const inset = (element: React.ReactElement) => (
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <GestureHandlerRootView>{element}</GestureHandlerRootView>
    </SafeAreaProvider>
  );

  test('is laid out as the canvas that replaces it, so nothing jumps (R-3)', async () => {
    const at = stops(Dimensions.get('window').height, insets);
    const below = insets.top + STATUS_ROW;
    const page = await mount(
      inset(
        <WhisperProvider>
          <OpeningWallet
            name="Everyday"
            network="regtest"
            busy={false}
            onDisconnect={jest.fn()}
          />
        </WhisperProvider>,
      ),
    );
    const parts = page.root
      .findByType(OpeningWallet)
      .findAll(node => typeof node.type === 'string');
    const placed = (top: number) =>
      parts.find(node => flat(node).top === top && flat(node).left === 0);
    const home = placed(below)!;
    expect(flat(home).height).toBe(at.home - below);
    expect(flat(home).paddingHorizontal).toBe(HOME.edge);
    const sheet = placed(at.home)!;
    expect(flat(sheet)).toMatchObject({
      backgroundColor: palette.espresso,
      right: 0,
      bottom: 0,
    });
    // The balance's box, the vessel and the row, as Home measures them.
    const wave = parts.find(
      node => node.props.accessibilityRole === 'progressbar',
    )!;
    expect(flat(wave).height).toBe(
      heroBox(Dimensions.get('window').fontScale, PixelRatio.get()),
    );
    const vessel = parts.find(node => flat(node).height === HOME.vessel)!;
    expect(flat(vessel).marginHorizontal).toBe(HOME.vesselInset);
    // Three slots as tall as the row, each holding its disc.
    const slots = parts.filter(
      node =>
        flat(node).height === HOME.row && flat(node).borderWidth === undefined,
    );
    expect(slots).toHaveLength(3);
    await act(async () => page.unmount());

    // And the canvas puts its own parts in the same places.
    const canvas = await mount(inset(<OnCanvas />));
    const [, homePane, sheetPane] = canvas.root.findAllByType(Pane);
    expect(flat(host(homePane))).toMatchObject({
      top: below,
      height: at.home - below,
    });
    expect(transformOf(host(sheetPane), 'translateY')).toBe(at.home);
    await act(async () => canvas.unmount());
  });

  test('keeps a recovery phrase’s tile beside the mark, where the canvas puts it', async () => {
    const page = await mount(
      inset(
        <WhisperProvider>
          <OpeningWallet
            name="Everyday"
            network="regtest"
            busy={false}
            onDisconnect={jest.fn()}
            tile={<Text testID="tile">tile</Text>}
          />
        </WhisperProvider>,
      ),
    );
    // The row that holds the mark and the name holds the tile too.
    const name = page.root.find(
      node =>
        typeof node.type === 'string' && node.props.children === 'Everyday',
    );
    let row = name.parent;
    while (
      row &&
      (typeof row.type !== 'string' || String(row.type) === 'Text')
    ) {
      row = row.parent;
    }
    const inRow = (test: (node: ReactTestInstance) => boolean) =>
      row!.findAll(test).length > 0;
    expect(inRow(node => node.props.testID === 'tile')).toBe(true);
    expect(inRow(node => node.type === Bloom)).toBe(true);
    await act(async () => page.unmount());
  });
});
