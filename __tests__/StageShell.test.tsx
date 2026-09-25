import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import { RecoveryPhrase } from '../src/components/RecoveryPhrase';
import { copy } from '../src/design/copy';
import { palette } from '../src/design/palette';
import { LockScreen } from '../src/scenes/phases/Locked';
import { SETTINGS_SURFACE } from '../src/scenes/settings/ui';
import { defaultProfile } from '../src/services/networks';
import type { useWalletSession } from '../src/services/useWalletSession';
import { BackupPanel } from '../src/stage/layers/BackupPanel';
import { CreateSheet } from '../src/stage/layers/CreateSheet';
import { SceneSlot } from '../src/stage/panes/SceneSlot';
import type { Phase } from '../src/stage/phase';
import { Stage } from '../src/stage/Stage';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { copyViolations } from '../test-support/copyGuard';
import { guardData, snapshotOf, walletOf } from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { find, meaning, press } from '../test-support/query';

/**
 * The stage above the canvas and the phases (REDESIGN.md 2.2 and 6): what
 * stays drawn under the lock, how the new wallet sheet arrives, and a new
 * wallet's recovery phrase while the shell phases show.
 */

type Session = ReturnType<typeof useWalletSession>;

const client = new DemoWalletClient();
const wallet = walletOf();
const WORDS = 'fixture words only';

/**
 * A session with what the stage reads, and a mock for anything else it or a
 * phase calls.
 */
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
    rememberedSession: {
      mode: 'device',
      network: wallet.network,
      walletId: wallet.id,
      locked: false,
      backupPending: true,
    },
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

let stage!: StageStore;

function Staged({ phase, session }: { phase: Phase; session: Session }) {
  stage = useStageStore();
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView>
        <StageProvider value={stage}>
          <Stage phase={phase} session={session} onUnlock={jest.fn()} />
        </StageProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const LOCKED: Phase = { kind: 'locked', prompting: false, error: '' };
const LOADING: Phase = { kind: 'loading' };
const OFFLINE: Phase = { kind: 'offline', error: 'Electrum is offline.' };
const PICKER: Phase = { kind: 'picker', error: '' };

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

const markers = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.testID === SETTINGS_SURFACE,
  );

beforeEach(() => {
  jest.spyOn(client, 'getRecoveryPhrase').mockResolvedValue(WORDS);
});
afterEach(() => jest.restoreAllMocks());

describe('the lock', () => {
  test('is over an opaque cover from its first frame, with nothing of a wallet under it', async () => {
    const tree = await mount(<Staged phase={LOCKED} session={sessionOf()} />);
    const lock = tree.root.findByType(LockScreen);
    const drawn = lock.parent!.children as ReactTestInstance[];
    expect(drawn[drawn.length - 1]).toBe(lock);
    const cover = drawn[drawn.length - 2];
    expect(cover.props.testID).toBe('lock-cover');
    expect(flat(cover)).toMatchObject({
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: palette.roast,
    });
    expect(tree.root.findAllByType(SceneSlot)).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test('drops what it covers with none of its exits played', async () => {
    const session = sessionOf();
    const tree = await mount(<Staged phase={LOADING} session={session} />);
    // Everything the lock hides sits in a config that skips its exits when
    // the lock takes it away, so nothing fades out in front of whoever
    // holds the phone.
    const unlocked = tree.root
      .findAllByType(LayoutAnimationConfig)
      .find(config => config.props.skipExiting);
    expect(unlocked).toBeDefined();
    expect(unlocked!.findAllByType(SceneSlot)).not.toHaveLength(0);
    await act(async () =>
      tree.update(<Staged phase={LOCKED} session={session} />),
    );
    expect(
      tree.root
        .findAllByType(LayoutAnimationConfig)
        .filter(config => config.props.skipExiting),
    ).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});

test('the new wallet sheet slides in over the phase and back out', async () => {
  const tree = await mount(
    <Staged phase={PICKER} session={sessionOf({ rememberedSession: null })} />,
  );
  await act(async () => stage.actions.openCreate(false));
  const sheet = tree.root.findByType(CreateSheet);
  let layer: ReactTestInstance | null = sheet.parent;
  while (layer && !layer.props.entering) layer = layer.parent;
  expect(layer?.props.entering).toBeDefined();
  expect(layer?.props.exiting).toBeDefined();
  await act(async () => tree.unmount());
});

describe('a recovery phrase still to save, over a shell phase', () => {
  test.each([
    ['loading', LOADING],
    ['offline', OFFLINE],
    ['picker', PICKER],
  ] as const)(
    '%s shows a shield tile and no words about it',
    async (_name, phase) => {
      const tree = await mount(<Staged phase={phase} session={sessionOf()} />);
      expect(find(tree, copy.health.backupPending)).toBeDefined();
      expect(tree.root.findAllByType(RecoveryPhrase)).toHaveLength(0);
      // Held to the copy guard as the stage draws it (REDESIGN.md rule 1).
      expect(
        copyViolations(tree, {
          data: guardData(snapshotOf(), [wallet.name]),
        }),
      ).toEqual([]);
      await act(async () => tree.unmount());
    },
  );

  test('the tile opens the phrase in a setup surface drawn in place of the phase', async () => {
    const session = sessionOf();
    const tree = await mount(<Staged phase={OFFLINE} session={session} />);
    expect(find(tree, copy.health.backupPending)!.props.accessibilityHint).toBe(
      copy.phase.backupHint,
    );
    await press(tree, copy.health.backupPending);
    const panel = tree.root.findByType(BackupPanel);
    expect(panel.findAllByType(RecoveryPhrase)).toHaveLength(1);
    // A settings-class surface, the only one drawn: the phase is not.
    expect(markers(tree)).toHaveLength(1);
    expect(copyViolations(tree, { data: [wallet.name] })).toEqual([]);
    expect(meaning(tree)).not.toContain(copy.phase.offline);

    // The wallet opening under it does not take the phrase away.
    await act(async () =>
      tree.update(
        <Staged
          phase={{ kind: 'wallet', error: '' }}
          session={sessionOf({ snapshot: snapshotOf() })}
        />,
      ),
    );
    expect(tree.root.findAllByType(BackupPanel)).toHaveLength(1);

    // Closed, the phase comes back with its tile.
    await press(tree, copy.phase.close);
    expect(tree.root.findAllByType(BackupPanel)).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test('Android back closes the surface before it closes the phase', async () => {
    const tree = await mount(<Staged phase={PICKER} session={sessionOf()} />);
    await press(tree, copy.health.backupPending);
    const [answer] = newestFirst(stage.responders.phaseBack);
    let took = false;
    await act(async () => {
      took = answer();
    });
    expect(took).toBe(true);
    expect(tree.root.findAllByType(BackupPanel)).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test('saving the phrase ends it, and the tile and surface go', async () => {
    const tree = await mount(<Staged phase={LOADING} session={sessionOf()} />);
    await press(tree, copy.health.backupPending);
    expect(tree.root.findAllByType(BackupPanel)).toHaveLength(1);
    const saved = sessionOf({
      rememberedSession: {
        mode: 'device',
        network: wallet.network,
        walletId: wallet.id,
        locked: false,
        backupPending: false,
      },
    });
    await act(async () =>
      tree.update(<Staged phase={LOADING} session={saved} />),
    );
    expect(tree.root.findAllByType(BackupPanel)).toHaveLength(0);
    expect(find(tree, copy.health.backupPending)).toBeUndefined();
    await act(async () => tree.unmount());
  });
});
