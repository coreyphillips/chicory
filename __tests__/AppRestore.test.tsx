import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppState, FlatList, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import App from '../App';
import * as DeviceWallet from '../src/embedded/client';
import { defaultPreferences } from '../src/services/networks';
import { Transit } from '../src/scenes/phases/Transit';
import { NetworkSettings } from '../src/screens/NetworkSettings';
import { SettingsScreen } from '../src/screens/Settings';
import { eraseDeviceStorage } from '../src/embedded/storage';
import { allText, meaning, visibleText } from '../test-support/query';
import { activePhase, activeScene } from '../test-support/scene';
jest.mock('../src/embedded/storage', () => ({
  eraseDeviceStorage: jest.fn().mockResolvedValue(undefined),
}));
const SESSION = 'com.beignet.wallet.last-session';
const SNAPSHOT = 'com.beignet.wallet.last-snapshot';
const PROFILES = 'com.beignet.wallet.network-profiles';
let records: Map<string, string>;
beforeEach(() => {
  jest.clearAllMocks();
  records = new Map();
  const prefs = defaultPreferences();
  prefs.legacyNetwork = null;
  prefs.profiles.regtest.electrum = {
    host: 'localhost',
    port: 60001,
    tls: false,
  };
  // These fixtures exercise the regtest wallet being created and reopened, so
  // the profile carries the primary node a real regtest setup would have. The
  // shipped default has none, because there is no node to guess at.
  prefs.profiles.regtest.primaryUri = `03${'a'.repeat(64)}@127.0.0.1:9735`;
  records.set(PROFILES, JSON.stringify(prefs));
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      records.has(options?.service || '')
        ? ({ password: records.get(options?.service || '') } as never)
        : false,
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      records.set(options?.service || '', value);
      return { service: options?.service } as never;
    });
  jest.mocked(Keychain.getAllGenericPasswordServices).mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());
function text(tree: ReactTestRenderer) {
  return tree.root
    .findAllByType(Text)
    .map(item =>
      typeof item.props.children === 'string' ? item.props.children : '',
    )
    .join(' ');
}
function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function')!;
}
function device() {
  const client = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  client.listWallets = jest.fn().mockResolvedValue([
    {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'stopped',
    },
  ]);
  client.startWallet = jest
    .fn()
    .mockRejectedValue(new Error('Network is offline'));
  client.snapshot = jest
    .fn()
    .mockRejectedValue(new Error('Network is offline'));
  client.createWallet = jest.fn().mockResolvedValue({
    id: 'new-regtest',
    name: 'My wallet',
    network: 'regtest',
    status: 'running',
    mnemonic: 'fixture words never shown',
  });
  return client;
}
test('fresh mount restores the exact saved device network and wallet even when startup is offline', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  // Stale host credentials must not override the last device choice.
  records.set(
    'com.beignet.wallet.connection',
    JSON.stringify({ host: 'https://unused.example', token: 'fixture' }),
  );
  const client = device();
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(opened).toHaveBeenCalledWith(
    expect.objectContaining({ network: 'regtest' }),
    expect.any(Function),
    { existingOnly: true },
  );
  expect(client.connection.walletId).toBe('saved-regtest');
  expect(activePhase(tree)).toBe('offline');
  expect(meaning(tree)).toContain('My saved wallet');
  expect(meaning(tree)).toContain('Balances are unavailable');
  // The network editor, the recovery phrase and the lock wait behind the cog.
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  expect(label(tree, 'Change network or Bitcoin server')).toBeDefined();
  expect(label(tree, 'Reveal recovery phrase')).toBeDefined();
  expect(client.createWallet).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'Lock device wallet').props.onPress();
  });
  expect(JSON.parse(records.get(SESSION)!)).toEqual({
    mode: 'device',
    network: 'regtest',
    walletId: 'saved-regtest',
    locked: true,
  });
  await act(async () => {
    tree.unmount();
  });
  await act(async () => {
    tree = create(<App />);
  });
  expect(label(tree, 'Open device wallet')).toBeDefined();
  expect(opened).toHaveBeenCalledTimes(1);
  expect(activePhase(tree)).toBe('saved');
  expect(meaning(tree)).toContain('Open device wallet');
  await act(async () => {
    tree.unmount();
  });
});
test('legacy installation offers its existing device wallet without opening or creating storage at startup', async () => {
  jest
    .mocked(Keychain.getAllGenericPasswordServices)
    .mockResolvedValue(['com.beignet.wallet.embedded.database-key']);
  const opened = jest.spyOn(DeviceWallet, 'openDeviceWallet');
  const preferences = jest.spyOn(DeviceWallet, 'loadDevicePreferences');
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(label(tree, 'Open device wallet')).toBeDefined();
  expect(opened).not.toHaveBeenCalled();
  expect(preferences).not.toHaveBeenCalled();
  await act(async () => {
    tree.unmount();
  });
});
test.each([true, false])(
  'legacy discovery resumes the original encrypted vault, empty=%s, without inventing backup state',
  async empty => {
    jest
      .mocked(Keychain.getAllGenericPasswordServices)
      .mockResolvedValue(['com.beignet.wallet.embedded.database-key']);
    const preferences = JSON.parse(records.get(PROFILES)!);
    preferences.selectedNetwork = 'regtest';
    jest
      .spyOn(DeviceWallet, 'loadDevicePreferences')
      .mockResolvedValue(preferences);
    const client = device();
    if (empty) client.listWallets = jest.fn().mockResolvedValue([]);
    const opened = jest
      .spyOn(DeviceWallet, 'openDeviceWallet')
      .mockResolvedValue(client);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<App />);
    });
    expect(opened).not.toHaveBeenCalled();
    await act(async () => {
      label(tree, 'Open device wallet').props.onPress();
    });
    expect(opened).toHaveBeenCalledWith(
      preferences.profiles.regtest,
      expect.any(Function),
      { existingOnly: true, allowEmpty: true },
    );
    const session = JSON.parse(records.get(SESSION)!);
    if (empty) {
      // An empty vault gets its wallet from the defaults, and only that new
      // wallet carries a pending backup.
      expect(client.createWallet).toHaveBeenCalledTimes(1);
      expect(session.backupPending).toBe(true);
      expect(session.prepared).toBeUndefined();
      expect(text(tree)).toContain('Save your recovery phrase.');
    } else {
      expect(session.backupPending).toBeUndefined();
      expect(client.createWallet).not.toHaveBeenCalled();
      expect(text(tree)).toContain('My saved wallet');
      expect(session.walletId).toBe('saved-regtest');
      expect(session.prepared).toBeUndefined();
    }
    await act(async () => {
      tree.unmount();
    });
  },
);
test('a remembered wallet identity never resumes an empty vault as fresh setup', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  client.listWallets = jest.fn().mockResolvedValue([]);
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(opened).toHaveBeenCalledWith(
    expect.objectContaining({ network: 'regtest' }),
    expect.any(Function),
    { existingOnly: true },
  );
  expect(activePhase(tree)).toBe('saved');
  expect(meaning(tree)).toContain('No new wallet was created');
  expect(label(tree, 'Create a wallet')).toBeUndefined();
  expect(client.createWallet).not.toHaveBeenCalled();
  expect(JSON.parse(records.get(SESSION)!).walletId).toBe('saved-regtest');
  await act(async () => {
    tree.unmount();
  });
});
test('restore storage errors stay visible and never fall back to creating an empty wallet', async () => {
  const saved = {
    mode: 'device',
    network: 'regtest',
    walletId: 'saved-regtest',
    locked: false,
  };
  records.set(SESSION, JSON.stringify(saved));
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockRejectedValue(new Error('Saved encryption key unavailable'));
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(activePhase(tree)).toBe('saved');
  expect(meaning(tree)).toContain('Saved encryption key unavailable');
  expect(label(tree, 'Open device wallet')).toBeDefined();
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Create a wallet' }),
  ).toHaveLength(0);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(JSON.parse(records.get(SESSION)!)).toEqual(saved);
  await act(async () => {
    tree.unmount();
  });
});

test('locking serializes secure-store writes and closure against captured wallet actions', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  const lock = label(tree, 'Lock device wallet').props.onPress;
  const choose = label(tree, 'Choose another wallet').props.onPress;
  let finishSave!: () => void;
  let finishClose!: () => void;
  jest.mocked(Keychain.setGenericPassword).mockImplementationOnce(
    (_name, value, options) =>
      new Promise(resolve => {
        finishSave = () => {
          records.set(options!.service!, value);
          resolve({ service: 'fixture' } as never);
        };
      }),
  );
  const close = jest.spyOn(client, 'close').mockImplementation(
    () =>
      new Promise(resolve => {
        finishClose = resolve;
      }),
  );
  const savesBefore = jest.mocked(Keychain.setGenericPassword).mock.calls
    .length;
  await act(async () => {
    lock();
    choose();
    lock();
  });
  expect(jest.mocked(Keychain.setGenericPassword).mock.calls.length).toBe(
    savesBefore + 1,
  );
  expect(close).not.toHaveBeenCalled();
  expect(activePhase(tree)).toBe('transit');
  expect(meaning(tree)).toContain('Closing your wallet');
  // The bloom starts in the tone of the network being left.
  expect(tree.root.findByType(Transit).props.network).toBe('regtest');
  expect(label(tree, 'Choose another wallet')).toBeUndefined();
  await act(async () => {
    finishSave();
  });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => {
    choose();
    lock();
  });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishClose();
  });
  expect(label(tree, 'Open device wallet')).toBeDefined();
  expect(JSON.parse(records.get(SESSION)!).walletId).toBe('saved-regtest');
  await act(async () => {
    tree.unmount();
  });
});

test('an unmounted pending restore closes its runtime instead of committing an orphan wallet', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  const close = jest.spyOn(client, 'close');
  let finishOpen!: (value: EmbeddedWalletClient) => void;
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockImplementation(
    () =>
      new Promise(resolve => {
        finishOpen = resolve;
      }),
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    tree.unmount();
  });
  await act(async () => {
    finishOpen(client);
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(client.startWallet).not.toHaveBeenCalled();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});

test('a failed close preserves the wallet and permits retrying the durable close', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  const close = jest
    .spyOn(client, 'close')
    .mockRejectedValueOnce(new Error('Storage flush failed'))
    .mockResolvedValueOnce();
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  await act(async () => {
    label(tree, 'Lock device wallet').props.onPress();
  });
  expect(meaning(tree)).toContain('Storage flush failed');
  expect(meaning(tree)).toContain('My saved wallet');
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  expect(label(tree, 'Lock device wallet')).toBeDefined();
  await act(async () => {
    label(tree, 'Lock device wallet').props.onPress();
  });
  expect(close).toHaveBeenCalledTimes(2);
  expect(label(tree, 'Open device wallet')).toBeDefined();
  await act(async () => {
    tree.unmount();
  });
});

test('an empty prepared setup can resume after lock and relaunch without claiming a saved wallet', async () => {
  const prefs = JSON.parse(records.get(PROFILES)!);
  prefs.selectedNetwork = 'regtest';
  jest.spyOn(DeviceWallet, 'loadDevicePreferences').mockResolvedValue(prefs);
  // A vault the defaults cannot fill: creation is refused, so the empty
  // vault stays prepared and the manual way in is shown with the reason.
  const empty = () => {
    const client = device();
    client.listWallets = jest.fn().mockResolvedValue([]);
    client.createWallet = jest
      .fn()
      .mockRejectedValue(new Error('Add a primary node for regtest.'));
    return client;
  };
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValueOnce(empty())
    .mockResolvedValueOnce(empty());
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // Nothing is tapped: with nothing saved and no vault, the launch opens the
  // wallet itself.
  expect(opened).toHaveBeenLastCalledWith(
    prefs.profiles.regtest,
    expect.any(Function),
    {
      existingOnly: false,
      allowEmpty: true,
    },
  );
  expect(label(tree, 'Create a wallet')).toBeDefined();
  expect(activePhase(tree)).toBe('picker');
  expect(meaning(tree)).toContain('Add a primary node for regtest.');
  expect(JSON.parse(records.get(SESSION)!).prepared).toBe(true);
  await act(async () => {
    label(tree, 'Lock device wallet').props.onPress();
  });
  await act(async () => {
    tree.unmount();
  });
  await act(async () => {
    tree = create(<App />);
  });
  expect(opened).toHaveBeenCalledTimes(1);
  expect(label(tree, 'Open device wallet')).toBeUndefined();
  // A lock is a deliberate close, so this relaunch waits to be asked.
  await act(async () => {
    label(tree, 'Try again').props.onPress();
  });
  expect(opened).toHaveBeenLastCalledWith(
    prefs.profiles.regtest,
    expect.any(Function),
    {
      existingOnly: true,
      allowEmpty: true,
    },
  );
  expect(label(tree, 'Create a wallet')).toBeDefined();
  await act(async () => {
    tree.unmount();
  });
});

test('a wallet created during interrupted setup returns with an explicit backup reminder', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      locked: true,
      prepared: true,
    }),
  );
  const client = device();
  client.getRecoveryPhrase = jest
    .fn()
    .mockResolvedValue('test fixture words only');
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Try again').props.onPress();
  });
  expect(text(tree)).toContain('Save your recovery phrase.');
  expect(client.getRecoveryPhrase).not.toHaveBeenCalled();
  expect(JSON.parse(records.get(SESSION)!).backupPending).toBe(true);
  await act(async () => {
    label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await act(async () => {
    label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(JSON.parse(records.get(SESSION)!).backupPending).toBe(false);
  expect(records.get(SESSION)).not.toContain('fixture words');
  await act(async () => {
    tree.unmount();
  });
});

const savedSnapshot = {
  wallet: {
    id: 'saved-regtest',
    name: 'My saved wallet',
    network: 'regtest',
    status: 'running',
  },
  balance: {
    totalSats: 123456,
    availableSats: 100000,
    pendingSats: 23456,
    receivableSats: 50000,
  },
  activity: [],
  primary: { uri: 'node', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: Date.now() - 60000,
  demo: false,
};

test('a returning wallet opens on the wallet page with its last figures while the engine starts', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  records.set(
    SNAPSHOT,
    JSON.stringify({
      version: 1,
      walletId: 'saved-regtest',
      snapshot: savedSnapshot,
    }),
  );
  const client = device();
  let finish!: () => void;
  client.startWallet = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  client.snapshot = jest.fn().mockResolvedValue({
    ...savedSnapshot,
    balance: { ...savedSnapshot.balance, totalSats: 200000 },
    updatedAt: Date.now(),
  });
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // The wallet page, with the cached total, and none of the offline controls.
  const before = meaning(tree);
  expect(before).toContain('Total balance');
  expect(before).toContain('123,456');
  expect(allText(tree)).not.toContain('Balances are unavailable');
  expect(label(tree, 'Retry connection')).toBeUndefined();
  // A cached figure is old by definition, so it cannot be spent against. The
  // gate says so by being closed; the page does not also ask to be refreshed.
  expect(allText(tree)).not.toContain('Pull to refresh');
  expect(
    label(tree, 'Send').props.accessibilityState?.disabled ??
      label(tree, 'Send').props.disabled,
  ).toBe(true);
  await act(async () => {
    finish();
  });
  // The live snapshot lands a few promise hops after the engine reports.
  for (let i = 0; i < 50 && !meaning(tree).includes('200,000'); i++) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 20));
    });
  }
  expect(meaning(tree)).toContain('200,000');
  expect(allText(tree)).not.toContain('123,456');
  // Written to this wallet's own slot. One shared slot meant switching
  // networks threw away the other network's figures.
  expect(
    JSON.parse(records.get(`${SNAPSHOT}.saved-regtest`)!).snapshot.balance
      .totalSats,
  ).toBe(200000);
  await act(async () => {
    tree.unmount();
  });
});

test('a returning wallet with nothing cached shows a quiet opening page, not the offline controls', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  let finish!: () => void;
  client.startWallet = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  client.snapshot = jest.fn().mockResolvedValue(savedSnapshot);
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(activePhase(tree)).toBe('loading');
  const opening = meaning(tree);
  expect(opening).toContain('Opening…');
  expect(opening).toContain('My saved wallet');
  expect(opening).not.toContain('Balances are unavailable');
  expect(label(tree, 'Retry connection')).toBeUndefined();
  expect(label(tree, 'Retry wallet setup')).toBeUndefined();
  expect(label(tree, 'Reveal recovery phrase')).toBeUndefined();
  await act(async () => {
    finish();
  });
  for (let i = 0; i < 50 && !meaning(tree).includes('123,456'); i++) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 20));
    });
  }
  expect(meaning(tree)).toContain('123,456');
  await act(async () => {
    tree.unmount();
  });
});

test('erasing the wallet closes the engine, removes storage and returns to a fresh start', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  client.snapshot = jest.fn().mockResolvedValue(savedSnapshot);
  const closed = jest.spyOn(client, 'close').mockResolvedValue(undefined);
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  await act(async () => {
    label(tree, 'Erase wallet from this phone').props.onPress();
  });
  expect(text(tree)).toContain('funds are lost');
  expect(eraseDeviceStorage).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'Erase wallet').props.onPress();
  });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(eraseDeviceStorage).toHaveBeenCalledTimes(1);
  const cleared = jest
    .mocked(Keychain.resetGenericPassword)
    .mock.calls.map(call => call[0]?.service);
  expect(cleared).toEqual(
    expect.arrayContaining([
      SESSION,
      SNAPSHOT,
      'com.beignet.wallet.device-seed-source',
    ]),
  );
  // Back at the beginning: a fresh start, not a wallet to welcome back, and
  // no question about where the next one should live.
  expect(activePhase(tree)).toBe('welcome');
  const fresh = meaning(tree);
  expect(fresh).toContain('Bitcoin, with less to think about.');
  expect(fresh).not.toContain('Welcome back');
  expect(fresh).not.toContain('On this device');
  expect(fresh).not.toContain('Connect a host');
  await act(async () => {
    tree.unmount();
  });
});

test('a pending backup is a shield pinned above Activity, and opens Settings', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      locked: true,
      prepared: true,
    }),
  );
  const client = device();
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  client.snapshot = jest.fn().mockResolvedValue({
    wallet: {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'running',
    },
    balance: {
      totalSats: 0,
      availableSats: 0,
      pendingSats: 0,
      receivableSats: 0,
    },
    activity: [],
    primary: { uri: 'node', connected: true, setup: 'ready' },
    notes: [],
    updatedAt: Date.now(),
    demo: false,
  });
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Try again').props.onPress();
  });
  expect(meaning(tree)).toContain('Save your recovery phrase.');
  await act(async () => {
    label(tree, 'Activity').props.onPress();
  });
  // Activity has no title on screen; the stage says it is showing.
  expect(activeScene(tree)).toBe('activity');
  expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
  // The list keeps the shield, which says what it is only to a screen
  // reader; the phrase and its words stay in Settings.
  expect(label(tree, 'Save your recovery phrase.')).toBeDefined();
  expect(label(tree, 'Reveal recovery phrase')).toBeUndefined();
  expect(visibleText(tree)).not.toContain('Save your recovery phrase.');
  await act(async () => {
    label(tree, 'Save your recovery phrase.').props.onPress();
  });
  expect(activeScene(tree)).toBe('settings');
  expect(label(tree, 'Reveal recovery phrase')).toBeDefined();
  await act(async () => {
    tree.unmount();
  });
});

test('saving the device server waits for close and returns to Settings with the same wallet', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const previous = device();
  const next = device();
  const snapshot = {
    wallet: {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'running',
    },
    balance: {
      totalSats: 1000,
      availableSats: 1000,
      pendingSats: 0,
      receivableSats: 0,
    },
    activity: [],
    primary: {
      uri: 'fixture-primary',
      connected: false,
      setup: 'failed',
      setupError: 'Liquidity provider is unavailable.',
    },
    notes: [],
    updatedAt: Date.now(),
    demo: false,
  };
  for (const client of [previous, next]) {
    client.startWallet = jest.fn().mockResolvedValue(undefined);
    client.snapshot = jest.fn().mockResolvedValue(snapshot);
  }
  let resolveClose!: () => void;
  previous.close = jest.fn().mockImplementation(
    () =>
      new Promise<void>(resolve => {
        resolveClose = resolve;
      }),
  );
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValueOnce(previous)
    .mockResolvedValueOnce(next);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  expect(text(tree)).toContain('Liquidity provider is unavailable.');
  await act(async () => {
    label(tree, 'Change network or Bitcoin server').props.onPress();
  });
  const preferences = defaultPreferences();
  const profile = {
    ...preferences.profiles.regtest,
    electrum: { host: 'new-electrum', port: 60401, tls: false },
  };
  let applying!: Promise<void>;
  await act(async () => {
    applying = tree.root.findByType(NetworkSettings).props.onApply(profile);
  });
  expect(activePhase(tree)).toBe('transit');
  expect(meaning(tree)).toContain('Closing this wallet');
  expect(opened).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveClose();
    await applying;
  });
  expect(opened).toHaveBeenCalledTimes(2);
  expect(activeScene(tree)).toBe('settings');
  expect(text(tree)).toContain('My saved wallet');
  expect(next.connection.walletId).toBe('saved-regtest');
  expect(next.createWallet).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('a first run takes no taps: the defaults create the wallet and the page opens with the backup banner', async () => {
  const prefs = JSON.parse(records.get(PROFILES)!);
  jest.spyOn(DeviceWallet, 'loadDevicePreferences').mockResolvedValue(prefs);
  const client = device();
  client.listWallets = jest.fn().mockResolvedValue([]);
  client.createWallet = jest.fn().mockResolvedValue({
    id: 'new-mainnet',
    name: 'My wallet',
    network: 'mainnet',
    status: 'running',
    mnemonic: 'fixture words never shown',
  });
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  client.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet: {
      id: 'new-mainnet',
      name: 'My wallet',
      network: 'mainnet',
      status: 'running',
    },
    demo: false,
  });
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // No tap and no form in between: the saved defaults open the vault and fill it.
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenLastCalledWith(
    prefs.profiles.mainnet,
    expect.any(Function),
    {
      existingOnly: false,
      allowEmpty: true,
    },
  );
  expect(client.createWallet).toHaveBeenCalledWith({
    name: 'My wallet',
    network: 'mainnet',
    primaryUri: prefs.profiles.mainnet.primaryUri,
  });
  const shown = meaning(tree);
  expect(shown).toContain('Total balance');
  expect(shown).toContain('Save your recovery phrase.');
  expect(allText(tree)).not.toContain('fixture words never shown');
  const session = JSON.parse(records.get(SESSION)!);
  expect(session.walletId).toBe('new-mainnet');
  expect(session.backupPending).toBe(true);
  await act(async () => {
    tree.unmount();
  });
});

test('a switch whose open fails keeps the previous network and says why, without a form', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const previous = device();
  previous.startWallet = jest.fn().mockResolvedValue(undefined);
  previous.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet: {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'running',
    },
    demo: false,
  });
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValueOnce(previous)
    .mockRejectedValueOnce(new Error('The Electrum server did not answer.'));
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  const target = { ...defaultPreferences().profiles.mainnet };
  await act(async () => {
    await tree.root
      .findByType(SettingsScreen)
      .props.onNetwork(target)
      .catch(() => {});
  });
  expect(opened).toHaveBeenCalledTimes(2);
  expect(activePhase(tree)).toBe('saved');
  const shown = meaning(tree);
  // The reason survives the full-page wait that replaced the screen it was
  // started from, and the phone is still described as being on regtest.
  expect(shown).toContain('The Electrum server did not answer.');
  expect(shown).not.toContain('Bitcoin, with less to think about.');
  expect(label(tree, 'Default Electrum server')).toBeUndefined();
  // The wallet is still on the phone, and this is the way back into it.
  expect(shown).toContain('This wallet is still on your phone');
  expect(label(tree, 'Open device wallet')).toBeDefined();
  // The phone is still on the network it was already on. Claiming the one that
  // just refused to open would send the next launch straight back into it.
  await act(async () => {
    label(tree, 'Change network or Bitcoin server').props.onPress();
  });
  expect(tree.root.findByType(NetworkSettings).props.initialNetwork).toBe(
    'regtest',
  );
  await act(async () => tree.unmount());
});

test('a close that fails still releases the vault, so the next switch works', async () => {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const previous = device();
  previous.startWallet = jest.fn().mockResolvedValue(undefined);
  previous.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet: {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'running',
    },
    demo: false,
  });
  previous.close = jest
    .fn()
    .mockRejectedValue(new Error('The wallet engine did not finish closing.'));
  const next = device();
  next.startWallet = jest.fn().mockResolvedValue(undefined);
  next.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet: {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'running',
    },
    demo: false,
  });
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValueOnce(previous)
    .mockResolvedValueOnce(next);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await act(async () => {
    label(tree, 'Settings').props.onPress();
  });
  const mainnet = { ...defaultPreferences().profiles.mainnet };
  await act(async () => {
    await tree.root
      .findByType(SettingsScreen)
      .props.onNetwork(mainnet)
      .catch(() => {});
  });
  expect(activePhase(tree)).toBe('saved');
  expect(meaning(tree)).toContain('did not finish closing');
  await act(async () => {
    label(tree, 'Change network or Bitcoin server').props.onPress();
  });
  const regtest = JSON.parse(records.get(PROFILES)!).profiles.regtest;
  // The failed close must not have taken the vault with it. A second switch in
  // the same process is the whole point: before this, the storage lease leaked
  // and every later open answered "the device wallet is already open".
  await act(async () => {
    await tree.root
      .findByType(NetworkSettings)
      .props.onApply(regtest)
      .catch(() => {});
  });
  expect(opened).toHaveBeenCalledTimes(2);
  expect(text(tree)).toContain('My saved wallet');
  await act(async () => tree.unmount());
});

test('figures that have aged out are recovered by the app, not by asking the user', async () => {
  jest.useFakeTimers();
  // Under jest this is undefined, and the poll only runs for a foregrounded
  // app, so say so.
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const wallet = {
    id: 'saved-regtest',
    name: 'My saved wallet',
    network: 'regtest' as const,
    status: 'running',
  };
  const client = device();
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  const refreshWallet = jest.fn().mockResolvedValue(undefined);
  client.refreshWallet = refreshWallet as never;
  // Every reading it gives back is already older than the staleness gate, so
  // the wallet page is gated from the moment it opens and stays that way.
  client.snapshot = jest.fn(async () => ({
    ...(await new DemoWalletClient().snapshot()),
    wallet,
    demo: false,
    updatedAt: Date.now() - 120000,
  })) as never;
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // Opening does its own start; the recovery is what comes after.
  const startedOnOpen = jest.mocked(client.startWallet).mock.calls.length;
  expect(refreshWallet).not.toHaveBeenCalled();
  expect(text(tree)).not.toContain('Pull to refresh');
  // One poll later, the app asks the engine to start and resync on its own.
  await act(async () => {
    jest.advanceTimersByTime(12000);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(refreshWallet).toHaveBeenCalled();
  expect(jest.mocked(client.startWallet).mock.calls.length).toBeGreaterThan(
    startedOnOpen,
  );
  await act(async () => tree.unmount());
  jest.useRealTimers();
});
