import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';
import {
  cacheEntry,
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

test('the last snapshot comes back for its own wallet, with every row, and never claims a live connection', async () => {
  await saveCachedSnapshot('w1', snapshot);
  const call = jest.mocked(Keychain.setGenericPassword).mock.calls[0];
  expect(call[2]?.accessible).toBe(
    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  );
  const cached = await loadCachedSnapshot('w1');
  expect(cached?.balance).toEqual(snapshot.balance);
  expect(cached?.updatedAt).toBe(1234);
  // The entry is the only record of the history across a relaunch, and a
  // wallet never shows less than it already knew, so nothing is trimmed.
  expect(cached?.activity).toHaveLength(30);
  expect(cached?.activity).toEqual(snapshot.activity);
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

test('a read that changed only its time is not rewritten, and the first after a load is', async () => {
  await saveCachedSnapshot('w1', snapshot);
  await saveCachedSnapshot('w1', { ...snapshot, updatedAt: 5678 });
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  // A change in the figures is written, with the time it was read.
  await saveCachedSnapshot('w1', {
    ...snapshot,
    balance: { ...snapshot.balance, totalSats: 1001 },
    updatedAt: 5678,
  });
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
  expect((await loadCachedSnapshot('w1'))?.updatedAt).toBe(5678);
  // Loading the entry, as a launch does, makes the next save a write again,
  // so the first live read replaces the cached figures whatever they were.
  await saveCachedSnapshot('w1', {
    ...snapshot,
    balance: { ...snapshot.balance, totalSats: 1001 },
    updatedAt: 9999,
  });
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(3);
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

test('a save serializes the snapshot once, and stores the entry the cache always stored', async () => {
  const stringify = jest.spyOn(JSON, 'stringify');
  try {
    await saveCachedSnapshot('w1', snapshot);
    // The whole snapshot is the large part; it is turned into text once.
    const whole = stringify.mock.calls.filter(
      ([value]) => !!value && typeof value === 'object' && 'activity' in value,
    );
    expect(whole).toHaveLength(1);
  } finally {
    stringify.mockRestore();
  }
  const written = jest.mocked(Keychain.setGenericPassword).mock.calls[0][1];
  // As the entry the cache wrote before: the same top-level shape, and the
  // same snapshot read back.
  expect(JSON.parse(written)).toEqual({ version: 1, walletId: 'w1', snapshot });
  expect(Object.keys(JSON.parse(written))).toEqual([
    'version',
    'walletId',
    'snapshot',
  ]);
});

test('an entry reads back as the whole entry, whatever its wallet id or time', () => {
  const entries: [string, WalletSnapshot][] = [
    ['w1', snapshot],
    ['a "quoted" \\ id', { ...snapshot, updatedAt: 0 }],
    ['w2', { ...snapshot, activity: [], notes: ['One note.'] }],
  ];
  for (const [walletId, value] of entries) {
    const entry = cacheEntry(walletId, value);
    const { figures } = entry;
    expect(JSON.parse(entry.stored)).toEqual({
      version: 1,
      walletId,
      snapshot: value,
    });
    // The figures are the entry without its time: a new time alone leaves
    // them as they were, and anything else changes them.
    expect(cacheEntry(walletId, { ...value, updatedAt: 99 }).figures).toBe(
      figures,
    );
    expect(
      cacheEntry(walletId, { ...value, notes: ['Another.'] }).figures,
    ).not.toBe(figures);
  }
  // A time JSON cannot write is left out, as the cache always left it.
  const timeless = { ...snapshot } as Partial<WalletSnapshot>;
  delete timeless.updatedAt;
  expect(
    JSON.parse(cacheEntry('w1', timeless as WalletSnapshot).stored),
  ).toEqual({ version: 1, walletId: 'w1', snapshot: timeless });
});
