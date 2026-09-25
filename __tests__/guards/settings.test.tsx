import React from 'react';
import type { PropsWithChildren } from 'react';
import { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { SettingsLayer } from '../../src/scenes/settings/SettingsLayer';
import { DeviceSetup } from '../../src/screens/DeviceSetup';
import { WalletPicker } from '../../src/screens/Settings';
import {
  clearDiagnostics,
  recordDiagnostic,
} from '../../src/services/diagnosticLog';
import { defaultProfile } from '../../src/services/networks';
import type { WalletAdapter } from '../../src/services/wallet';
import type { Backup, CanvasSession, CanvasView } from '../../src/stage/Canvas';
import { CreateSheet } from '../../src/stage/layers/CreateSheet';
import { StageProvider, useStageStore } from '../../src/stage/StageContext';
import { guardData, snapshotOf, walletOf } from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import { field, press } from '../../test-support/query';

/**
 * Settings under the copy guard (REDESIGN.md rule 1) and the accessibility
 * check (section 9): Settings itself, the setup surfaces and the new wallet
 * sheet. The copy guard skips what sits under the Settings marker; the
 * accessibility check reads all of it. The settings track adds each state it
 * redraws, drawn from test-support/fixtures.ts with `guardData` as its data.
 *
 * Settings, the new wallet sheet and first-run network setup are
 * settings-class surfaces (rule 2): each root carries the marker, so the
 * copy check proves no word of theirs is drawn outside it. The wallet picker
 * sits in a shell phase instead, so it may show wallet names and nothing
 * else.
 */

const PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

function client(over: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
    updatePrimary: jest.fn().mockResolvedValue(walletOf()),
    retrySetup: jest.fn().mockResolvedValue(undefined),
    createWallet: jest
      .fn()
      .mockResolvedValue({ ...walletOf(), mnemonic: PHRASE }),
    ...over,
  } as unknown as WalletAdapter;
}

function session(over: Partial<CanvasSession> = {}): CanvasSession {
  return {
    error: '',
    switchError: '',
    refreshing: false,
    connecting: false,
    refresh: jest.fn(),
    manualRefresh: jest.fn(),
    disconnect: jest.fn(),
    chooseWallet: jest.fn(),
    switchNetwork: jest.fn().mockResolvedValue(undefined),
    eraseDevice: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as CanvasSession;
}

const view = {
  hidden: false,
  setHidden: jest.fn(),
  unit: 'sats',
  setUnit: jest.fn(),
  filter: 'All',
  setFilter: jest.fn(),
  query: '',
  setQuery: jest.fn(),
} as unknown as CanvasView;

/** A stage for the parts that reach for one: the close control, the sheet. */
function OnStage({ children }: PropsWithChildren) {
  const stage = useStageStore();
  return <StageProvider value={stage}>{children}</StageProvider>;
}

function settings(
  snapshot: WalletSnapshot,
  {
    backup = null,
    over = {},
    adapter = client(),
  }: {
    backup?: Backup | null;
    over?: Partial<CanvasSession>;
    adapter?: WalletAdapter;
  } = {},
) {
  return mount(
    <OnStage>
      <SettingsLayer
        snapshot={snapshot}
        client={adapter}
        session={session(over)}
        view={view}
        stale={false}
        backup={backup}
      />
    </OnStage>,
  );
}

const pending: Backup = {
  pending: true,
  loadPhrase: async () => PHRASE,
  onSaved: jest.fn(),
};

function sheet(
  restoring: boolean,
  network: 'mainnet' | 'regtest',
  adapter = client(),
) {
  return mount(
    <OnStage>
      <CreateSheet
        client={adapter}
        profile={defaultProfile(network)}
        restoring={restoring}
        onCreated={jest.fn().mockResolvedValue(undefined)}
      />
    </OnStage>,
  );
}

/** Restore entry with `count` words typed. */
async function typed(count: number, adapter = client()) {
  const tree = await sheet(true, 'regtest', adapter);
  const words = PHRASE.split(' ');
  const phrase = Array.from(
    { length: count },
    (_, index) => words[index % words.length],
  ).join(' ');
  await act(async () => {
    field(tree, 'Recovery phrase').props.onChangeText(phrase);
  });
  return tree;
}

const snapshot = snapshotOf();
const mainnet = snapshotOf({ wallet: { network: 'mainnet' } });
const failing = snapshotOf({
  primary: {
    connected: false,
    setup: 'failed',
    setupError: 'Liquidity provider is unavailable.',
  },
});
const wallets = [
  walletOf(),
  walletOf({ id: 'second', name: 'Savings', status: 'stopped' }),
];
const names = wallets.map(wallet => wallet.name);

const GUARDED: GuardedState[] = [
  {
    name: 'settings',
    render: () => settings(snapshot),
    data: guardData(snapshot),
  },
  {
    name: 'settings on mainnet',
    render: () => settings(mainnet),
    data: guardData(mainnet),
  },
  {
    name: 'settings with the recovery phrase to save',
    render: () => settings(snapshot, { backup: pending }),
    data: guardData(snapshot),
  },
  {
    name: 'settings showing the phrase to save, with its hold',
    render: async () => {
      const tree = await settings(snapshot, { backup: pending });
      await press(tree, 'Reveal recovery phrase');
      return tree;
    },
    data: guardData(snapshot, PHRASE.split(' ')),
  },
  {
    name: 'settings showing the phrase',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'Reveal recovery phrase');
      return tree;
    },
    data: guardData(snapshot, PHRASE.split(' ')),
  },
  {
    name: 'settings proposing another network',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'mainnet');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings with the network editor open',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'Change network or Bitcoin server');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings changing the primary node',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'Change primary node');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings having saved the primary node',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'Change primary node');
      await press(tree, 'Save primary node');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings refused a primary node',
    render: async () => {
      const tree = await settings(snapshot, {
        adapter: client({
          updatePrimary: jest
            .fn()
            .mockRejectedValue(new Error('That node URI is not valid.')),
        }),
      });
      await press(tree, 'Change primary node');
      await press(tree, 'Save primary node');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings with a primary node that failed setup',
    render: () => settings(failing),
    data: guardData(failing),
  },
  {
    name: 'settings offering an app lock',
    render: () => {
      jest
        .mocked(Keychain.getSupportedBiometryType)
        .mockResolvedValueOnce('FaceID' as never);
      return settings(snapshot);
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings with diagnostics open',
    render: async () => {
      clearDiagnostics();
      recordDiagnostic({ phase: 'ui', message: 'No route was found.' });
      const tree = await settings(snapshot);
      await press(tree, 'Diagnostics');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings confirming an erase',
    render: async () => {
      const tree = await settings(snapshot);
      await press(tree, 'Erase wallet from this phone');
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'settings after a failed refresh and switch',
    render: () =>
      settings(snapshot, {
        over: {
          error: 'The Electrum server did not answer.',
          switchError: 'The previous wallet did not close.',
        },
      }),
    data: guardData(snapshot),
  },
  {
    name: 'new wallet sheet',
    render: () => sheet(false, 'regtest'),
    data: [],
  },
  {
    name: 'new mainnet wallet sheet',
    render: () => sheet(false, 'mainnet'),
    data: [],
  },
  {
    name: 'restore entry, empty',
    render: () => sheet(true, 'regtest'),
    data: [],
  },
  {
    name: 'restore entry, partway',
    render: () => typed(5),
    data: [],
  },
  {
    name: 'restore entry, ready',
    render: () => typed(12),
    data: [],
  },
  {
    name: 'restore entry, second ring',
    render: () => typed(18),
    data: [],
  },
  {
    name: 'restore entry, past 24',
    render: () => typed(25),
    data: [],
  },
  {
    name: 'restore entry, refused',
    render: async () => {
      const tree = await typed(
        12,
        client({
          createWallet: jest
            .fn()
            .mockRejectedValue(new Error('That recovery phrase is not valid.')),
        }),
      );
      await press(tree, 'Restore regtest wallet');
      return tree;
    },
    data: [],
  },
  {
    name: 'new wallet with its phrase to save',
    render: async () => {
      const tree = await sheet(false, 'regtest');
      await press(tree, 'Create regtest wallet');
      return tree;
    },
    data: [],
  },
  {
    name: 'new wallet showing its phrase',
    render: async () => {
      const tree = await sheet(false, 'regtest');
      await press(tree, 'Create regtest wallet');
      await press(tree, 'Reveal recovery phrase');
      return tree;
    },
    data: PHRASE.split(' '),
  },
  {
    name: 'first-run network setup',
    render: () =>
      mount(
        <DeviceSetup
          busy={false}
          error="The saved wallet could not be found."
          onOpen={jest.fn().mockResolvedValue(undefined)}
        />,
      ),
    data: [],
  },
  {
    name: 'wallet picker',
    render: () =>
      mount(
        <WalletPicker
          wallets={wallets}
          onSelect={jest.fn()}
          onCreate={jest.fn()}
        />,
      ),
    data: names,
  },
  {
    name: 'wallet picker opening a wallet',
    render: () =>
      mount(
        <WalletPicker
          wallets={wallets}
          busy
          onSelect={jest.fn()}
          onCreate={jest.fn()}
        />,
      ),
    data: names,
  },
  {
    name: 'wallet picker opening the chosen wallet',
    render: async () => {
      const onSelect = jest.fn();
      const tree = await mount(
        <WalletPicker
          wallets={wallets}
          onSelect={onSelect}
          onCreate={jest.fn()}
        />,
      );
      await press(tree, 'Open Savings');
      await act(async () =>
        tree.update(
          <WalletPicker
            wallets={wallets}
            busy
            onSelect={onSelect}
            onCreate={jest.fn()}
          />,
        ),
      );
      return tree;
    },
    data: names,
  },
  {
    name: 'wallet picker with no wallets',
    render: () =>
      mount(
        <WalletPicker wallets={[]} onSelect={jest.fn()} onCreate={jest.fn()} />,
      ),
    data: [],
  },
];

guard('settings', GUARDED);
