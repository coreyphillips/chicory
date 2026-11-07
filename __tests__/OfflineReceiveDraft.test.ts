import * as Keychain from 'react-native-keychain';
import {
  saveOfflineReceiveDraft,
  loadOfflineReceiveDraft,
  clearOfflineReceiveDraft,
  clearOfflineReceiveDrafts,
} from '../src/services/offlineReceiveDraft';

test('an interrupted offline identity is durable, wallet scoped and retained until completion', async () => {
  const store = new Map<string, string>();
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      store.set(options!.service!, value);
      return { service: options!.service! } as never;
    });
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      store.has(options!.service!)
        ? ({ password: store.get(options!.service!) } as never)
        : false,
    );
  jest
    .mocked(Keychain.resetGenericPassword)
    .mockImplementation(async options => store.delete(options!.service!));
  const draft = {
    id: 'interrupted-request-1234',
    amountSats: 20000,
    description: 'Receipt',
  };
  await saveOfflineReceiveDraft('wallet-1', draft);
  expect(await loadOfflineReceiveDraft('wallet-1')).toEqual(draft);
  expect(await loadOfflineReceiveDraft('wallet-2')).toBeNull();
  expect(await loadOfflineReceiveDraft('wallet-1')).toEqual(draft);
  await clearOfflineReceiveDraft('wallet-1');
  expect(await loadOfflineReceiveDraft('wallet-1')).toBeNull();
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
  await expect(saveOfflineReceiveDraft('wallet-1', draft)).rejects.toThrow(
    'could not be saved',
  );
});

test('deletion failure retains the draft and erasure removes every wallet draft', async () => {
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(false);
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({ password: 'still saved' } as never);
  await expect(clearOfflineReceiveDraft('wallet-1')).rejects.toThrow(
    'could not be removed',
  );
  jest
    .mocked(Keychain.getAllGenericPasswordServices)
    .mockResolvedValue([
      'com.beignet.wallet.offline-request.wallet-1',
      'com.beignet.wallet.offline-request.wallet-2',
      'unrelated',
    ]);
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(true);
  jest.mocked(Keychain.resetGenericPassword).mockClear();
  await clearOfflineReceiveDrafts();
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(2);
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalledWith({
    service: 'unrelated',
  });
});

test('a draft remembers the node it was quoted at and its mode, reads older drafts without them, and refuses a malformed node', async () => {
  const store = new Map<string, string>();
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      store.set(options!.service!, value);
      return { service: options!.service! } as never;
    });
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      store.has(options!.service!)
        ? ({ password: store.get(options!.service!) } as never)
        : false,
    );
  const peer = `03${'7'.repeat(64)}`;
  const draft = {
    id: 'interrupted-request-5678',
    amountSats: 20000,
    description: 'Receipt',
    mode: 'offline' as const,
    peer,
  };
  await saveOfflineReceiveDraft('wallet-3', draft);
  expect(await loadOfflineReceiveDraft('wallet-3')).toEqual(draft);
  // A draft saved before the node was recorded still reads.
  store.set(
    'com.beignet.wallet.offline-request.wallet-4',
    JSON.stringify({ id: 'interrupted-request-9999', amountSats: 500, description: '' }),
  );
  expect(await loadOfflineReceiveDraft('wallet-4')).toEqual({
    id: 'interrupted-request-9999',
    amountSats: 500,
    description: '',
  });
  store.set(
    'com.beignet.wallet.offline-request.wallet-5',
    JSON.stringify({ ...draft, peer: 'not-a-node' }),
  );
  await expect(loadOfflineReceiveDraft('wallet-5')).rejects.toThrow('could not be read');
  store.set(
    'com.beignet.wallet.offline-request.wallet-6',
    JSON.stringify({ ...draft, mode: 'unified' }),
  );
  await expect(loadOfflineReceiveDraft('wallet-6')).rejects.toThrow('could not be read');
});

