import * as Keychain from 'react-native-keychain';
import { open } from '@op-engineering/op-sqlite';
import { openEncryptedDeviceStorage } from '../src/embedded/storage';
import { secureRandomBytes } from '../src/embedded/random';
jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: () => true,
  open: jest.fn(),
}));
jest.mock('../src/embedded/random', () => ({ secureRandomBytes: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(open)
    .mockReturnValue({ executeSync: jest.fn(), close: jest.fn() } as never);
});
test.each([false, true])(
  'restoring a wallet with a missing key never saves a replacement, including prepared setup=%s',
  async allowEmpty => {
    jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
    await expect(
      openEncryptedDeviceStorage('mainnet', true, allowEmpty),
    ).rejects.toThrow('No new key');
    expect(secureRandomBytes).not.toHaveBeenCalled();
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ name: 'beignet-runtime-lease.sqlite' });
  },
);
test('restoring missing database data uses read-only probing and never opens a replacement volume', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({ password: 'a'.repeat(64) } as never);
  jest.mocked(open).mockImplementation(options => {
    if (options.readOnly) throw new Error('Existing database missing');
    return { executeSync: jest.fn(), close: jest.fn() } as never;
  });
  await expect(openEncryptedDeviceStorage('mainnet', true)).rejects.toThrow(
    'Existing database missing',
  );
  expect(open).toHaveBeenLastCalledWith({
    name: 'engine-mainnet-device-volume.sqlite',
    encryptionKey: 'a'.repeat(64),
    readOnly: true,
  });
  expect(open).toHaveBeenCalledTimes(2);
  expect(secureRandomBytes).not.toHaveBeenCalled();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});

function availableStorage() {
  const originalBytes = new Uint8Array([11, 22, 33]);
  const lease = {
    executeSync: jest.fn(() => ({ rows: [] })),
    close: jest.fn(),
  };
  const sibling = {
    executeSync: jest.fn(() => ({ rows: [{ content: originalBytes }] })),
    close: jest.fn(),
  };
  const current = {
    executeSync: jest.fn((sql: string) => ({
      rows:
        sql === 'PRAGMA cipher_version'
          ? [{ value: 'fixture' }]
          : sql === 'PRAGMA synchronous'
          ? [{ value: 2 }]
          : [],
    })),
    close: jest.fn(),
  };
  jest.mocked(open).mockImplementation(options => {
    if (options.name === 'beignet-runtime-lease.sqlite') return lease as never;
    if (options.name === 'engine-mainnet-device-volume.sqlite')
      return current as never;
    if (
      options.name === 'engine-testnet-device-volume.sqlite' &&
      options.readOnly
    )
      return sibling as never;
    throw new Error('Unexpected writable source database open');
  });
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(
      async options =>
        ({
          password: options?.service?.endsWith('mainnet')
            ? 'a'.repeat(64)
            : 'b'.repeat(64),
        } as never),
    );
  return { lease, sibling, originalBytes };
}

test('source registry reads retain the existing lease and use only an existing sibling key/read-only database', async () => {
  const { lease, sibling, originalBytes } = availableStorage();
  const storage = await openEncryptedDeviceStorage('mainnet');
  try {
    const read = await storage.readRegistry('testnet');
    expect(open).toHaveBeenLastCalledWith({
      name: 'engine-testnet-device-volume.sqlite',
      encryptionKey: 'b'.repeat(64),
      readOnly: true,
    });
    expect(sibling.executeSync).toHaveBeenCalledWith(
      'SELECT content FROM files WHERE path = ?',
      ['/wallet/registry.json'],
    );
    expect(sibling.close).toHaveBeenCalledTimes(1);
    expect(lease.close).not.toHaveBeenCalled();
    read!.fill(0);
    expect(Array.from(originalBytes)).toEqual([11, 22, 33]);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(secureRandomBytes).not.toHaveBeenCalled();
  } finally {
    storage.close();
  }
  expect(lease.close).toHaveBeenCalledTimes(1);
});

test('missing source key or closing during its retrieval never creates a key/database or reads after lease release', async () => {
  const { sibling } = availableStorage();
  const storage = await openEncryptedDeviceStorage('mainnet');
  jest.mocked(Keychain.getGenericPassword).mockResolvedValueOnce(false);
  await expect(storage.readRegistry('testnet')).rejects.toThrow('No new key');
  expect(sibling.executeSync).not.toHaveBeenCalled();
  let finish!: (value: never) => void;
  jest.mocked(Keychain.getGenericPassword).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = storage.readRegistry('testnet');
  storage.close();
  finish({ password: 'b'.repeat(64) } as never);
  await expect(pending).rejects.toThrow('storage is closed');
  expect(sibling.executeSync).not.toHaveBeenCalled();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(secureRandomBytes).not.toHaveBeenCalled();
});
