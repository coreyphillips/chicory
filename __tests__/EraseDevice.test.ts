import * as Keychain from 'react-native-keychain';

const mockDeleted: string[] = [];
const mockFailing = { name: '' };
jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: () => true,
  open: ({ name }: { name: string }) => ({
    delete: () => {
      if (name === mockFailing.name) throw new Error('busy');
      mockDeleted.push(name);
    },
  }),
}));

import { eraseDeviceStorage } from '../src/embedded/storage';

beforeEach(() => {
  mockDeleted.length = 0;
  mockFailing.name = '';
  jest.clearAllMocks();
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(true as never);
});

test('erasing removes every network slot, its journal, the lease and every database key', async () => {
  await eraseDeviceStorage();
  // Four namespaces, five database names each, plus the lease.
  expect(mockDeleted).toHaveLength(21);
  expect(mockDeleted).toContain('engine-device-volume.sqlite');
  expect(mockDeleted).toContain('engine-mainnet-device-volume.sqlite');
  expect(mockDeleted).toContain('engine-regtest-%2Fwallet%2Fregtest.db.sqlite');
  expect(mockDeleted).toContain('beignet-runtime-lease.sqlite');
  const services = jest
    .mocked(Keychain.resetGenericPassword)
    .mock.calls.map(call => call[0]?.service);
  expect(services).toEqual(
    expect.arrayContaining([
      'com.beignet.wallet.embedded.database-key',
      'com.beignet.wallet.embedded.database-key.mainnet',
      'com.beignet.wallet.embedded.database-key.testnet',
      'com.beignet.wallet.embedded.database-key.regtest',
      'com.beignet.wallet.embedded.settings',
    ]),
  );
});

test('a slot that cannot be removed is reported rather than silently kept', async () => {
  mockFailing.name = 'engine-mainnet-device-volume.sqlite';
  await expect(eraseDeviceStorage()).rejects.toThrow('could not be removed');
  // Everything else was still attempted.
  expect(mockDeleted).toHaveLength(20);
});
