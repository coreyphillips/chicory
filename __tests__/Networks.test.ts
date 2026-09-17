import * as Keychain from 'react-native-keychain';
import {
  DEFAULT_REGTEST_ELECTRUM,
  defaultPreferences,
  defaultProfile,
  loadNetworkPreferences,
  saveNetworkPreferences,
  storageNamespace,
  assertWalletNetwork,
} from '../src/services/networks';

beforeEach(() => {
  jest.mocked(Keychain.getGenericPassword).mockReset().mockResolvedValue(false);
});
test('per-network defaults use Bitkit TLS only on mainnet and preserve independent saved overrides', async () => {
  const preferences = defaultPreferences();
  expect(preferences.profiles.mainnet.electrum).toEqual({
    host: 'bitkit.to',
    port: 9999,
    tls: true,
  });
  expect(preferences.profiles.testnet.electrum.host).toBe('');
  // Regtest ships with a server, because there is no public one to fall back
  // on and a wallet without one cannot open at all.
  expect(preferences.profiles.regtest.electrum).toEqual({
    host: '192.168.50.211',
    port: 60401,
    tls: false,
  });
  expect(preferences.profiles.regtest.electrum).toEqual(
    DEFAULT_REGTEST_ELECTRUM,
  );
  // Only mainnet ships with a primary node. Dialling a plausible address for a
  // peer that is not there costs a Tor bootstrap on every open.
  expect(preferences.profiles.regtest.primaryUri).toBe('');
  expect(preferences.profiles.testnet.primaryUri).toBe('');
  preferences.profiles.regtest.electrum = {
    host: '127.0.0.1',
    port: 60001,
    tls: false,
  };
  preferences.selectedNetwork = 'regtest';
  await saveNetworkPreferences(preferences);
  const saved = jest.mocked(Keychain.setGenericPassword).mock.calls.at(-1)!;
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({
      username: 'networks',
      password: saved[1],
      service: 'profiles',
    } as never);
  const reopened = await loadNetworkPreferences();
  expect(reopened.profiles.regtest.electrum.port).toBe(60001);
  expect(reopened.profiles.mainnet).toEqual(defaultProfile('mainnet'));
  expect(saved[2]?.accessible).toBe(
    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  );
});
test('legacy wallet storage stays mapped to its original chain and other networks have separate namespaces', () => {
  expect(storageNamespace('mainnet', 'mainnet')).toBe('legacy');
  expect(storageNamespace('regtest', 'mainnet')).toBe('regtest');
  expect(storageNamespace('regtest', 'regtest')).toBe('legacy');
  expect(storageNamespace('mainnet', 'regtest')).toBe('mainnet');
  expect(
    new Set(
      ['mainnet', 'testnet', 'regtest'].map(n =>
        storageNamespace(n as 'mainnet'),
      ),
    ).size,
  ).toBe(3);
  expect(() =>
    assertWalletNetwork([{ network: 'mainnet' }], 'regtest'),
  ).toThrow('another network');
});
test('a saved profile cannot be retagged into another network slot', async () => {
  const preferences = defaultPreferences();
  preferences.profiles.testnet.network = 'mainnet';
  await expect(saveNetworkPreferences(preferences)).rejects.toThrow(
    'storage slot',
  );
});

test('a regtest profile that was never given a server adopts the shipped one', async () => {
  const stored = defaultPreferences();
  stored.profiles.regtest.electrum = { host: '', port: 50001, tls: false };
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    password: JSON.stringify(stored),
  } as never);
  const reopened = await loadNetworkPreferences();
  expect(reopened.profiles.regtest.electrum).toEqual(DEFAULT_REGTEST_ELECTRUM);
});
test('a regtest server that was actually typed is never replaced', async () => {
  const stored = defaultPreferences();
  stored.profiles.regtest.electrum = { host: '127.0.0.1', port: 60001, tls: false };
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    password: JSON.stringify(stored),
  } as never);
  const reopened = await loadNetworkPreferences();
  expect(reopened.profiles.regtest.electrum).toEqual({
    host: '127.0.0.1',
    port: 60001,
    tls: false,
  });
});
