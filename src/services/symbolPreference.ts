import { useCallback, useEffect, useState } from 'react';
import * as Keychain from 'react-native-keychain';

/**
 * Settings > Show sats as ₿: the integer face drawn as BIP 177 draws it,
 * `₿2,000` rather than `2,000 sats`. The BIP is a draft, and `₿` still reads
 * as whole bitcoin to many people, so it is off unless the owner turns it on.
 *
 * A display choice rather than a secret, kept in the secure store all the
 * same, the way the haptics preference is (`hapticsPreference`): one entry
 * holding "on" or "off", under a service of its own. A build without it
 * installed over this one simply never reads it.
 */
const PREFERENCE = 'com.beignet.wallet.bitcoin-symbol';

/** Whether the symbol is on. Nothing saved, or an unreadable store, means off. */
export async function loadSymbolPreference(): Promise<boolean> {
  try {
    const saved = await Keychain.getGenericPassword({ service: PREFERENCE });
    return !!saved && saved.password === 'on';
  } catch {
    return false;
  }
}

/** Saves the choice. A save that fails throws, and changes nothing. */
export async function setSymbolPreference(on: boolean): Promise<void> {
  const saved = await Keychain.setGenericPassword(
    'beignet-bitcoin-symbol',
    on ? 'on' : 'off',
    {
      service: PREFERENCE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (!saved) throw new Error('Could not save the bitcoin symbol setting.');
}

/**
 * The saved preference, read as it mounts, and a setter that saves a change
 * before it shows it. It reads as off until the store answers, which is how
 * every amount is drawn before anyone chooses.
 */
export function useSymbolPreference(): {
  on: boolean;
  set: (on: boolean) => Promise<void>;
} {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let active = true;
    loadSymbolPreference().then(value => {
      if (active) setOn(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const set = useCallback(async (next: boolean) => {
    await setSymbolPreference(next);
    setOn(next);
  }, []);
  return { on, set };
}
