import * as Keychain from 'react-native-keychain';
import { DEFAULT_PRIMARY_URI, parsePrimaryUri } from '@beignet/wallet-core';
import {
  DEFAULT_MAINNET_PRIMARY_URI,
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

test('a new mainnet profile starts on the relay-only Iroh link of the node the onion address named', () => {
  const profile = defaultProfile('mainnet');
  expect(profile.primaryUri).toBe(DEFAULT_MAINNET_PRIMARY_URI);
  expect(profile.transport).toBe('native');
  const parsed = parsePrimaryUri(DEFAULT_MAINNET_PRIMARY_URI);
  // The link reads back unchanged, so a saved wallet stores it as written.
  expect(parsed.uri).toBe(DEFAULT_MAINNET_PRIMARY_URI);
  expect(parsed.transport).toEqual({
    type: 'iroh',
    endpointId:
      '8ec01f040891cb3f9973a1f6139d36c24a4e42b2939186e1508848fc09f8a640',
    relayUrl: 'https://use1-1.relay.n0.iroh.link./',
  });
  // Same node, so a wallet on the onion address keeps its channels there.
  expect(parsed.pubkey).toBe(parsePrimaryUri(DEFAULT_PRIMARY_URI).pubkey);
  expect(defaultProfile('testnet').primaryUri).toBe('');
  expect(defaultProfile('regtest').primaryUri).toBe('');
});
test.each([
  ['the onion address an earlier build shipped', DEFAULT_PRIMARY_URI],
  [
    'an Iroh link with no relay hint',
    `${parsePrimaryUri(DEFAULT_PRIMARY_URI).pubkey}@iroh:${'c'.repeat(64)}`,
  ],
  ['a node of its own', `03${'b'.repeat(64)}@node.example:9735`],
])('a saved mainnet profile keeps %s', async (_, primaryUri) => {
  const stored = defaultPreferences();
  stored.profiles.mainnet.primaryUri = primaryUri;
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    password: JSON.stringify(stored),
  } as never);
  jest.mocked(Keychain.setGenericPassword).mockClear();
  const reopened = await loadNetworkPreferences();
  expect(reopened.profiles.mainnet.primaryUri).toBe(primaryUri);
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});
