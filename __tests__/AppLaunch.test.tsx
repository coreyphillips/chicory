import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import * as DeviceWallet from '../src/embedded/client';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import { defaultPreferences } from '../src/services/networks';

const SESSION = 'com.beignet.wallet.last-session';
const LOCK = 'com.beignet.wallet.lock';
const GUARD = 'com.beignet.wallet.lock-guard';

function strings(children: unknown, out: string[] = []): string[] {
  if (typeof children === 'string' || typeof children === 'number')
    out.push(String(children));
  else if (Array.isArray(children)) children.forEach(c => strings(c, out));
  else if (children && typeof children === 'object')
    strings((children as { props?: { children?: unknown } }).props?.children, out);
  return out;
}
const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(node => strings(node.props.children))
    .join(' | ');
const label = (tree: ReactTestRenderer, value: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(node => typeof node.props.onPress === 'function');

let records: Map<string, string>;

beforeEach(() => {
  jest.clearAllMocks();
  records = new Map();
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      records.has(options!.service!)
        ? ({ password: records.get(options!.service!) } as never)
        : (false as never),
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_u, value, options) => {
      records.set((options as { service: string }).service, value as string);
      return { service: 'test' } as never;
    });
  jest.mocked(Keychain.getAllGenericPasswordServices).mockResolvedValue([]);
});

function deviceClient() {
  const client = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  const wallet = {
    id: 'saved-regtest',
    name: 'My saved wallet',
    network: 'regtest' as const,
    status: 'running',
  };
  client.listWallets = jest.fn().mockResolvedValue([wallet]);
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  client.snapshot = jest.fn(async () => ({
    ...(await new DemoWalletClient().snapshot()),
    wallet,
    demo: false,
  }));
  return client;
}

test('an enabled lock holds the wallet back until it is unlocked', async () => {
  records.set(LOCK, 'on');
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(deviceClient());
  jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(defaultPreferences());
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    // The lock screen shows, and nothing about the wallet is on it.
    expect(text(tree)).toContain('Locked');
    expect(text(tree)).not.toContain('My saved wallet');
    // Crucially the vault is never opened, so no engine runs for someone who
    // has not authenticated.
    expect(opened).not.toHaveBeenCalled();

    // Authenticating releases it: the guard read now succeeds.
    records.set(GUARD, 'guard');
    await act(async () => {
      await label(tree, 'Unlock')!.props.onPress();
    });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(text(tree)).not.toContain('Chicory is locked.');
  } finally {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
  }
});

test('a refused unlock keeps the wallet closed and says so', async () => {
  records.set(LOCK, 'on');
  const opened = jest.spyOn(DeviceWallet, 'openDeviceWallet');
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    await act(async () => {
      await label(tree, 'Unlock')!.props.onPress();
    });
    expect(text(tree)).toContain('stays locked until this is confirmed');
    expect(opened).not.toHaveBeenCalled();
  } finally {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
  }
});

test('with no lock set the app opens straight into its wallet', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(deviceClient());
  jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(defaultPreferences());
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    expect(text(tree)).not.toContain('Chicory is locked.');
    expect(text(tree)).toContain('Total balance');
  } finally {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
  }
});

test('a saved wallet that fails to open offers itself back, not first-run setup', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(defaultPreferences());
  jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockRejectedValue(new Error('Electrum is offline.'));
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    const shown = text(tree);
    // The wallet is here; offering to choose where a wallet should live is the
    // wrong question, and was what the app used to fall back to.
    expect(shown).toContain('could not be opened just now');
    expect(shown).toContain('Electrum is offline.');
    expect(shown).not.toContain('Bitcoin, with less to think about.');
    expect(label(tree, 'Open device wallet')).toBeDefined();
    expect(label(tree, 'Explore a preview')).toBeUndefined();
  } finally {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
  }
});
