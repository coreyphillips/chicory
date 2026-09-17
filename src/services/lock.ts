import * as Keychain from 'react-native-keychain';

/**
 * An optional biometric / device-passcode gate in front of the app.
 *
 * What this is: a gate on opening a wallet and on revealing a recovery phrase,
 * for the realistic case of an unlocked phone in someone else's hands.
 *
 * What this is not: encryption. The wallet's SQLCipher key already lives in the
 * platform secure store under `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and is unchanged
 * by this setting. Turning the gate on does not re-encrypt anything, and
 * turning it off does not expose anything that was previously protected. The
 * UI says so rather than implying more.
 *
 * The preference and the guard are two separate entries on purpose: reading the
 * guard is what prompts, so the app can know whether the gate is on without
 * asking the user to authenticate just to render a settings screen.
 */
const PREFERENCE = 'com.beignet.wallet.lock';
const GUARD = 'com.beignet.wallet.lock-guard';

type LockListener = (enabled: boolean) => void;
const listeners = new Set<LockListener>();

/**
 * Hear about the gate being turned on or off, so the app-open lock takes
 * effect the moment Settings saves it rather than at the next launch. Fires
 * only after the preference has been durably written.
 */
export function onLockChanged(listener: LockListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notify = (enabled: boolean) => {
  listeners.forEach(listener => listener(enabled));
};

export type BiometryKind = 'face' | 'fingerprint' | 'iris' | 'passcode';

const KIND: Record<string, BiometryKind> = {
  FaceID: 'face',
  TouchID: 'fingerprint',
  Fingerprint: 'fingerprint',
  Face: 'face',
  Iris: 'iris',
};

export const BIOMETRY_NAMES: Record<BiometryKind, string> = {
  face: 'Face ID',
  fingerprint: 'fingerprint',
  iris: 'iris recognition',
  passcode: 'your device passcode',
};

/** What this device can offer, or null when it can offer nothing. */
export async function supportedBiometry(): Promise<BiometryKind | null> {
  try {
    const type = await Keychain.getSupportedBiometryType();
    if (!type) return null;
    return KIND[type as string] ?? 'passcode';
  } catch {
    return null;
  }
}

export async function isLockEnabled(): Promise<boolean> {
  try {
    const saved = await Keychain.getGenericPassword({ service: PREFERENCE });
    return !!saved && saved.password === 'on';
  } catch {
    return false;
  }
}

/**
 * Turning the gate on authenticates immediately, so a device that cannot
 * actually satisfy the prompt never leaves the user locked out of their own
 * wallet with a setting they cannot undo.
 */
export async function setLockEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    await Keychain.resetGenericPassword({ service: GUARD }).catch(() => {});
    const cleared = await Keychain.setGenericPassword('beignet-lock', 'off', {
      service: PREFERENCE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (!cleared) throw new Error('Could not save the lock setting.');
    notify(false);
    return;
  }
  const stored = await Keychain.setGenericPassword('beignet-lock', 'guard', {
    service: GUARD,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    accessControl:
      Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
  });
  if (!stored)
    throw new Error(
      'This device could not store a protected entry, so the lock was not turned on.',
    );
  const proved = await authenticate('Confirm to turn on the app lock');
  if (!proved) {
    await Keychain.resetGenericPassword({ service: GUARD }).catch(() => {});
    throw new Error('The lock was not turned on because it was not confirmed.');
  }
  const saved = await Keychain.setGenericPassword('beignet-lock', 'on', {
    service: PREFERENCE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (!saved) throw new Error('Could not save the lock setting.');
  notify(true);
}

/** Resolves true when the gate is off, or when the user satisfied the prompt. */
export async function authenticate(prompt: string): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({
      service: GUARD,
      authenticationPrompt: { title: prompt },
    });
    return !!result;
  } catch {
    return false;
  }
}

/** Gate a specific action. A disabled lock never prompts. */
export async function requireUnlock(prompt: string): Promise<boolean> {
  if (!(await isLockEnabled())) return true;
  return authenticate(prompt);
}
