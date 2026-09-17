import * as Keychain from 'react-native-keychain';
import {
  isLockEnabled,
  onLockChanged,
  requireUnlock,
  setLockEnabled,
  supportedBiometry,
} from '../src/services/lock';

const mocked = jest.mocked(Keychain);
const PREFERENCE = 'com.beignet.wallet.lock';
const GUARD = 'com.beignet.wallet.lock-guard';

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getGenericPassword.mockResolvedValue(false as never);
  mocked.setGenericPassword.mockResolvedValue({ service: 'test' } as never);
  mocked.resetGenericPassword.mockResolvedValue(true as never);
  mocked.getSupportedBiometryType.mockResolvedValue('FaceID' as never);
});

test('a wallet with the lock off is never held up by a prompt', async () => {
  await expect(isLockEnabled()).resolves.toBe(false);
  await expect(requireUnlock('Confirm')).resolves.toBe(true);
  // No guard read means no biometric prompt was shown.
  expect(mocked.getGenericPassword).not.toHaveBeenCalledWith(
    expect.objectContaining({ service: GUARD }),
  );
});

test('turning the lock on stores a protected guard and proves it works first', async () => {
  mocked.getGenericPassword.mockImplementation(async options =>
    options?.service === GUARD
      ? ({ service: GUARD, username: 'beignet-lock', password: 'guard' } as never)
      : (false as never),
  );
  await setLockEnabled(true);

  const guardWrite = mocked.setGenericPassword.mock.calls.find(
    call => (call[2] as { service?: string })?.service === GUARD,
  )!;
  expect((guardWrite[2] as { accessControl?: string }).accessControl).toBe(
    Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
  );
  // The preference is only written after the prompt was actually satisfied.
  const preferenceWrite = mocked.setGenericPassword.mock.calls.find(
    call => (call[2] as { service?: string })?.service === PREFERENCE,
  )!;
  expect(preferenceWrite[1]).toBe('on');
});

test('a device that cannot satisfy the prompt is not left locked out', async () => {
  // The guard is written, but reading it back never succeeds.
  mocked.getGenericPassword.mockResolvedValue(false as never);
  await expect(setLockEnabled(true)).rejects.toThrow('was not confirmed');
  expect(mocked.resetGenericPassword).toHaveBeenCalledWith({ service: GUARD });
  // The preference must not claim the lock is on.
  expect(
    mocked.setGenericPassword.mock.calls.some(
      call =>
        (call[2] as { service?: string })?.service === PREFERENCE &&
        call[1] === 'on',
    ),
  ).toBe(false);
});

test('an enabled lock gates the action and a refused prompt refuses the action', async () => {
  mocked.getGenericPassword.mockImplementation(async options => {
    if (options?.service === PREFERENCE)
      return { service: PREFERENCE, username: 'l', password: 'on' } as never;
    return false as never;
  });
  await expect(isLockEnabled()).resolves.toBe(true);
  await expect(requireUnlock('Confirm to reveal')).resolves.toBe(false);
});

test('biometry support is reported, and its absence is not an error', async () => {
  await expect(supportedBiometry()).resolves.toBe('face');
  mocked.getSupportedBiometryType.mockResolvedValue('TouchID' as never);
  await expect(supportedBiometry()).resolves.toBe('fingerprint');
  // A device with only a passcode still supports the gate.
  mocked.getSupportedBiometryType.mockResolvedValue('Unknown' as never);
  await expect(supportedBiometry()).resolves.toBe('passcode');
  mocked.getSupportedBiometryType.mockResolvedValue(null as never);
  await expect(supportedBiometry()).resolves.toBeNull();
  mocked.getSupportedBiometryType.mockRejectedValue(new Error('no'));
  await expect(supportedBiometry()).resolves.toBeNull();
});

test('the gate hears about the lock only once it is durably on or off', async () => {
  const seen = jest.fn();
  const off = onLockChanged(seen);
  // A refused confirmation never reports the lock as on.
  mocked.getGenericPassword.mockResolvedValue(false as never);
  await expect(setLockEnabled(true)).rejects.toThrow('was not confirmed');
  expect(seen).not.toHaveBeenCalled();

  mocked.getGenericPassword.mockImplementation(async options =>
    options?.service === GUARD
      ? ({ service: GUARD, username: 'beignet-lock', password: 'guard' } as never)
      : (false as never),
  );
  await setLockEnabled(true);
  expect(seen).toHaveBeenLastCalledWith(true);
  await setLockEnabled(false);
  expect(seen).toHaveBeenLastCalledWith(false);
  expect(seen).toHaveBeenCalledTimes(2);

  off();
  await setLockEnabled(true);
  expect(seen).toHaveBeenCalledTimes(2);
});
