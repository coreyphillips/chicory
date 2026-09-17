import * as Keychain from 'react-native-keychain';
import {
  loadWalletSession,
  saveWalletSession,
  clearWalletSession,
  hasSavedDeviceHint,
} from '../src/services/session';

afterEach(() => jest.clearAllMocks());
test('saves and reloads device selection and explicit lock without wallet secrets', async () => {
  const session = {
    mode: 'device' as const,
    network: 'regtest' as const,
    walletId: 'existing',
    locked: true,
  };
  jest
    .mocked(Keychain.setGenericPassword)
    .mockResolvedValue({ service: 'test' } as never);
  await saveWalletSession(session);
  const call = jest.mocked(Keychain.setGenericPassword).mock.calls[0];
  expect(call[2]?.accessible).toBe(
    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  );
  expect(JSON.parse(call[1])).toEqual(session);
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({ password: call[1] } as never);
  expect(await loadWalletSession()).toEqual(session);
});
test('failed secure-store writes and invalid selections never claim success', async () => {
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
  await expect(
    saveWalletSession({
      mode: 'device',
      network: 'regtest',
      locked: false,
    }),
  ).rejects.toThrow('securely');
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(false);
  await expect(clearWalletSession()).rejects.toThrow('clear');
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    password: JSON.stringify({
      mode: 'device',
      network: 'unknown',
      locked: false,
    }),
  } as never);
  await expect(loadWalletSession()).rejects.toThrow('invalid');
});
test('legacy discovery reads service names without decrypting keys or opening storage', async () => {
  jest
    .mocked(Keychain.getAllGenericPasswordServices)
    .mockResolvedValue(['com.beignet.wallet.embedded.database-key.mainnet']);
  expect(await hasSavedDeviceHint()).toBe(true);
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});

test('a session saved against a wallet host is discarded, not reported as damage', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    password: JSON.stringify({ mode: 'host', walletId: 'remote' }),
  } as never);
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(true);
  // The phone's own wallet is untouched and should simply be offered, so this
  // resolves to "nothing saved" rather than throwing an error an upgrading
  // owner would read as their wallet being gone.
  expect(await loadWalletSession()).toBeNull();
  const cleared = jest
    .mocked(Keychain.resetGenericPassword)
    .mock.calls.map(call => call[0]?.service);
  expect(cleared).toContain('com.beignet.wallet.last-session');
  expect(cleared).toContain('com.beignet.wallet.connection');
});
test('a launch with nothing saved still clears any leftover host credential', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false as never);
  jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(true);
  expect(await loadWalletSession()).toBeNull();
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
    service: 'com.beignet.wallet.connection',
  });
});
