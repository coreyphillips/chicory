import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';
import { loadDevicePreferences } from '../src/embedded/client';
import { openEncryptedDeviceStorage } from '../src/embedded/storage';
import { storageNamespace } from '../src/services/networks';
jest.mock('../src/embedded/random', () => ({ installNativeCrypto: jest.fn() }));
jest.mock('../src/embedded/storage', () => ({
  hasLegacyDeviceKey: jest.fn().mockResolvedValue(true),
  openEncryptedDeviceStorage: jest.fn(),
}));
test('legacy regtest identity maps to the original storage without copying or assigning it to mainnet', async () => {
  const records = new Map<string, string>();
  const old = {
    electrum: { host: 'localhost', port: 60001, tls: false },
    transport: 'native',
    relayUrl: '',
    relayToken: '',
  };
  records.set('com.beignet.wallet.embedded.settings', JSON.stringify(old));
  jest.mocked(Keychain.getGenericPassword).mockImplementation(async options => {
    const value = records.get(options?.service || '');
    return value
      ? ({
          username: 'test',
          password: value,
          service: options?.service,
        } as never)
      : false;
  });
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_user, value, options) => {
      records.set(options?.service || '', value);
      return { service: options?.service } as never;
    });
  const bytes = Buffer.from(
    JSON.stringify({
      record: {
        id: 'original',
        network: 'regtest',
        lfbw: { primaryUri: 'regtest-node' },
      },
      mnemonic: 'fixture only',
    }),
  );
  const close = jest.fn();
  const read = jest.fn().mockReturnValue(bytes);
  const write = jest.fn();
  jest
    .mocked(openEncryptedDeviceStorage)
    .mockResolvedValue({ volume: { read, write }, close } as never);
  const migrated = await loadDevicePreferences();
  expect(openEncryptedDeviceStorage).toHaveBeenCalledWith('legacy', true, true);
  expect(read).toHaveBeenCalledWith('/wallet/registry.json');
  expect(write).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(migrated.legacyNetwork).toBe('regtest');
  expect(migrated.selectedNetwork).toBe('regtest');
  expect(migrated.profiles.regtest.electrum).toEqual(old.electrum);
  expect(migrated.profiles.regtest.primaryUri).toBe('regtest-node');
  expect(storageNamespace('regtest', migrated.legacyNetwork)).toBe('legacy');
  expect(storageNamespace('mainnet', migrated.legacyNetwork)).toBe('mainnet');
  expect(bytes.every(byte => byte === 0)).toBe(true);
  await loadDevicePreferences();
  expect(openEncryptedDeviceStorage).toHaveBeenCalledTimes(1);
});

test('legacy inspection requires the original vault and leaves preferences untouched when it is missing', async () => {
  jest.clearAllMocks();
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  jest
    .mocked(openEncryptedDeviceStorage)
    .mockRejectedValue(new Error('Existing database missing'));
  await expect(loadDevicePreferences()).rejects.toThrow(
    'Existing database missing',
  );
  expect(openEncryptedDeviceStorage).toHaveBeenCalledWith('legacy', true, true);
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});
