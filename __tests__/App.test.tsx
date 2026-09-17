import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import { Text } from 'react-native';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import * as DeviceWallet from '../src/embedded/client';
import { defaultPreferences, defaultProfile } from '../src/services/networks';
import { SettingsScreen } from '../src/screens/Settings';
import { SendScreen } from '../src/screens/Payments';
import { Scanner } from '../src/components/Scanner';

function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function')!;
}

test('a first launch offers no choice at all: no host, no preview, no chooser', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // The wallet runs on this phone. There is no second option and no sample to
  // look at instead, so there is no question, and the launch screen asks none.
  const first = JSON.stringify(tree.toJSON());
  expect(first).not.toContain('On this device');
  expect(first).not.toContain('Connect a host');
  expect(first).not.toContain('preview');
  expect(first).not.toContain('SAMPLE FUNDS');
  expect(label(tree, 'Explore a preview')).toBeUndefined();
  // What it does offer is the two ways back in when the open did not work.
  expect(label(tree, 'Try again')).toBeDefined();
  expect(label(tree, 'Restore from recovery phrase')).toBeDefined();
  expect(label(tree, 'Network settings')).toBeDefined();
  await act(async () => {
    tree.unmount();
  });
});

test('a pending wallet start serializes wallet selection and locking', async () => {
  const wallets = [
    {
      id: 'a',
      name: 'First wallet',
      network: 'regtest' as const,
      status: 'stopped',
    },
    {
      id: 'b',
      name: 'Second wallet',
      network: 'regtest' as const,
      status: 'running',
    },
  ];
  const preferences = defaultPreferences();
  preferences.legacyNetwork = null;
  preferences.selectedNetwork = 'regtest';
  jest.mocked(Keychain.getGenericPassword).mockImplementation(async options =>
    options?.service === 'com.beignet.wallet.last-session'
      ? ({
          service: 'test',
          username: 'beignet-session',
          password: JSON.stringify({
            mode: 'device',
            network: 'regtest',
            locked: false,
          }),
        } as never)
      : options?.service === 'com.beignet.wallet.network-profiles'
      ? ({
          service: 'test',
          username: 'beignet-networks',
          password: JSON.stringify(preferences),
        } as never)
      : false,
  );
  let finish!: () => void;
  const device = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  device.listWallets = jest.fn().mockResolvedValue(wallets);
  const selected = jest.spyOn(device, 'selectWallet');
  const started = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  device.startWallet = started as never;
  const sample = new DemoWalletClient();
  const value = await sample.snapshot();
  const snapshot = jest
    .fn()
    .mockResolvedValue({ ...value, wallet: wallets[0], demo: false });
  device.snapshot = snapshot as never;
  const loaded = jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(preferences);
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(device);
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    const openA = label(tree, 'Open First wallet').props.onPress;
    const openB = label(tree, 'Open Second wallet').props.onPress;
    const lock = label(tree, 'Lock device wallet').props.onPress;
    await act(async () => {
      openA();
    });
    expect(started).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Open Second wallet' }),
    ).toHaveLength(0);
    expect(label(tree, 'Lock device wallet').props.disabled).toBe(true);
    // Also exercise already-captured handlers, before disabled UI rerenders.
    await act(async () => {
      openB();
      lock();
    });
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith('a');
    await act(async () => {
      finish();
    });
    expect(
      tree.root
        .findAllByType(Text)
        .some(item => item.props.children === 'Choose your wallet.'),
    ).toBe(false);
    expect(snapshot).toHaveBeenCalled();
  } finally {
    await act(async () => {
      tree?.unmount();
    });
    loaded.mockRestore();
    opened.mockRestore();
    selected.mockRestore();
  }
});

test('network switching waits for local engine closure before opening a different wallet namespace', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  const preferences = defaultPreferences();
  preferences.legacyNetwork = null;
  const target = {
    ...defaultProfile('regtest'),
    electrum: { host: 'localhost', port: 60001, tls: false },
  };
  const wallet = {
    id: 'local-mainnet',
    name: 'Local mainnet',
    network: 'mainnet' as const,
    status: 'running',
  };
  let closeFinished!: () => void;
  const close = jest.fn(
    () =>
      new Promise<void>(resolve => {
        closeFinished = resolve;
      }),
  );
  const local = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close },
  });
  local.listWallets = jest.fn().mockResolvedValue([wallet]);
  local.startWallet = jest.fn().mockResolvedValue(undefined);
  local.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet,
    demo: false,
  });
  const next = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  next.listWallets = jest.fn().mockResolvedValue([]);
  const loaded = jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(preferences);
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValueOnce(local)
    .mockResolvedValueOnce(next);
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<App />);
    });
    // Nothing is tapped to get here: the launch opens the wallet itself.
    await act(async () => {
      label(tree, 'Settings').props.onPress();
    });
    let switching!: Promise<void>;
    await act(async () => {
      switching = tree.root.findByType(SettingsScreen).props.onNetwork(target);
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(wallet.network).toBe('mainnet');
    await act(async () => {
      closeFinished();
      await switching;
    });
    expect(opened).toHaveBeenLastCalledWith(target, expect.any(Function), {
      existingOnly: false,
      allowEmpty: true,
    });
    // Regtest has no primary node in its profile, so no wallet is invented for
    // it: the shared client refuses one without a node, and the picker is
    // where a wallet gets made once the node is set.
    expect(label(tree, 'Create a wallet')).toBeDefined();
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Open Local mainnet' }),
    ).toHaveLength(0);
  } finally {
    await act(async () => {
      tree?.unmount();
    });
    loaded.mockRestore();
    opened.mockRestore();
  }
});

test('a paid or abandoned request never greets the next Send, and home scan opens the camera inside Send', async () => {
  const wallet = {
    id: 'scan-wallet',
    name: 'Scan wallet',
    network: 'regtest' as const,
    status: 'running',
  };
  const preferences = defaultPreferences();
  preferences.legacyNetwork = null;
  preferences.selectedNetwork = 'regtest';
  jest.mocked(Keychain.getGenericPassword).mockImplementation(async options =>
    options?.service === 'com.beignet.wallet.last-session'
      ? ({
          password: JSON.stringify({
            mode: 'device',
            network: 'regtest',
            walletId: 'scan-wallet',
            locked: false,
          }),
        } as never)
      : options?.service === 'com.beignet.wallet.network-profiles'
      ? ({ password: JSON.stringify(preferences) } as never)
      : false,
  );
  const device = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  device.listWallets = jest.fn().mockResolvedValue([wallet]);
  device.startWallet = jest.fn().mockResolvedValue(undefined);
  device.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet,
    demo: false,
  });
  const loaded = jest
    .spyOn(DeviceWallet, 'loadDevicePreferences')
    .mockResolvedValue(preferences);
  const opened = jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockResolvedValue(device);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  // A scanned code or a tapped link only prefills Send.
  await act(async () => {
    label(tree, 'Scan a payment request').props.onPress();
  });
  expect(tree.root.findAllByType(Scanner)).toHaveLength(1);
  await act(async () => {
    tree.root.findByType(Scanner).props.onDetected('lnbc-scanned');
  });
  expect(tree.root.findAllByType(Scanner)).toHaveLength(0);
  expect(
    tree.root
      .findAllByProps({ accessibilityLabel: 'Payment request or address' })
      .find(item => typeof item.props.onChangeText === 'function')!.props
      .value,
  ).toBe('lnbc-scanned');
  // Leaving through "View activity" clears the request like closing does.
  await act(async () => {
    tree.root.findByType(SendScreen).props.onActivity();
  });
  await act(async () => {
    label(tree, 'Wallet').props.onPress();
  });
  await act(async () => {
    label(tree, 'Send').props.onPress();
  });
  expect(tree.root.findByType(SendScreen).props.initialRequest).toBe('');
  expect(tree.root.findAllByType(Scanner)).toHaveLength(0);
  await act(async () => {
    tree.unmount();
  });
  loaded.mockRestore();
  opened.mockRestore();
});
