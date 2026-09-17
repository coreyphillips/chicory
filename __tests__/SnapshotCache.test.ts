import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';
import {
  clearCachedSnapshot,
  loadCachedSnapshot,
  saveCachedSnapshot,
} from '../src/services/snapshotCache';

const snapshot: WalletSnapshot = {
  wallet: { id: 'w1', name: 'Everyday', network: 'regtest', status: 'running' },
  balance: {
    totalSats: 1000,
    availableSats: 800,
    pendingSats: 200,
    receivableSats: 5000,
  },
  activity: Array.from({ length: 30 }, (_, index) => ({
    id: `row-${index}`,
    kind: 'sent' as const,
    title: 'Payment',
    description: '',
    amountSats: 1,
    feeSats: 0,
    status: 'completed' as const,
    timestamp: index,
    reference: '',
  })),
  primary: { uri: 'node', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: 1234,
  demo: false,
};

let stored: Map<string, string>;
beforeEach(async () => {
  stored = new Map();
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      stored.set(options?.service || '', value as string);
      return { service: 'test' } as never;
    });
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      stored.has(options?.service || '')
        ? ({ password: stored.get(options?.service || '') } as never)
        : false,
    );
  jest
    .mocked(Keychain.resetGenericPassword)
    .mockImplementation(async options => stored.delete(options?.service || ''));
  jest
    .mocked(Keychain.getAllGenericPasswordServices)
    .mockImplementation(async () => [...stored.keys()]);
  await clearCachedSnapshot();
  jest.mocked(Keychain.setGenericPassword).mockClear();
});

test('the last snapshot comes back for its own wallet, trimmed, and never claims a live connection', async () => {
  await saveCachedSnapshot('w1', snapshot);
  const call = jest.mocked(Keychain.setGenericPassword).mock.calls[0];
  expect(call[2]?.accessible).toBe(
    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  );
  const cached = await loadCachedSnapshot('w1');
  expect(cached?.balance).toEqual(snapshot.balance);
  expect(cached?.updatedAt).toBe(1234);
  expect(cached?.activity).toHaveLength(20);
  expect(cached?.primary.connected).toBe(false);
  // Another wallet's figures are never shown for this one.
  expect(await loadCachedSnapshot('w2')).toBeNull();
});

test('an unchanged snapshot is not rewritten', async () => {
  await saveCachedSnapshot('w1', snapshot);
  await saveCachedSnapshot('w1', snapshot);
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  await clearCachedSnapshot();
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
    service: 'com.beignet.wallet.last-snapshot',
  });
});

test('each wallet keeps its own entry, so switching networks does not evict the other', async () => {
  const other: WalletSnapshot = {
    ...snapshot,
    wallet: { ...snapshot.wallet, id: 'w2', network: 'mainnet' },
    balance: { ...snapshot.balance, totalSats: 7 },
  };
  await saveCachedSnapshot('w1', snapshot);
  await saveCachedSnapshot('w2', other);
  expect((await loadCachedSnapshot('w1'))?.balance.totalSats).toBe(1000);
  expect((await loadCachedSnapshot('w2'))?.balance.totalSats).toBe(7);
  // Erasing the phone takes every wallet's entry with it.
  await clearCachedSnapshot();
  expect(await loadCachedSnapshot('w1')).toBeNull();
  expect(await loadCachedSnapshot('w2')).toBeNull();
});
