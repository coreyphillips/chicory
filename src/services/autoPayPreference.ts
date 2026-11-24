import { useSyncExternalStore } from 'react';
import * as Keychain from 'react-native-keychain';

/**
 * Settings > Auto-pay (REDESIGN.md rule 5). The secure store keeps the
 * master switch, spending limit and tap-to-pay opt-in together on this
 * phone. Turning off the master switch preserves the other choices.
 *
 * One value serves every reader. Send reads it as it decides, without
 * waiting, so it is read once at launch (`loadAutoPayPreference` in
 * App.tsx) and until that answers it reads as off, which pays nothing on
 * its own.
 */
const PREFERENCE = 'com.beignet.wallet.auto-pay';

export interface AutoPay {
  on: boolean;
  /** Percent of the available balance, 0 to 100 in steps of `SHARE_STEP`. */
  share: number;
  /** Include Lightning invoices read over NFC while auto-pay is on. */
  tapToPay: boolean;
}

/** The slider's detent, and the step a screen reader moves it by. */
export const SHARE_STEP = 5;
/** Where the share starts the first time Auto-pay is switched on. */
export const SHARE_DEFAULT = 50;

export const AUTO_PAY_OFF: AutoPay = Object.freeze({
  on: false,
  share: SHARE_DEFAULT,
  tapToPay: false,
});

/** A share held to 0 to 100 and to its detent. Anything else is the default. */
export function snapShare(share: unknown): number {
  if (typeof share !== 'number' || !Number.isFinite(share)) {
    return SHARE_DEFAULT;
  }
  const clamped = Math.min(100, Math.max(0, share));
  return Math.round(clamped / SHARE_STEP) * SHARE_STEP;
}

function normalizeAutoPay({ on, share, tapToPay }: Partial<AutoPay>): AutoPay {
  return {
    on: on === true,
    share: snapShare(share),
    tapToPay: tapToPay === true,
  };
}

/** Older preferences keep their switch and share, with tap-to-pay off. */
export function parseAutoPay(saved: string | null | undefined): AutoPay {
  if (!saved) return AUTO_PAY_OFF;
  try {
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object') return AUTO_PAY_OFF;
    return normalizeAutoPay(value);
  } catch {
    return AUTO_PAY_OFF;
  }
}

let current: AutoPay = AUTO_PAY_OFF;
let pendingAccess: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

/** The preference as last read or saved; off until the store has answered. */
export const autoPayNow = () => current;

function publish(next: AutoPay) {
  if (
    next.on === current.on &&
    next.share === current.share &&
    next.tapToPay === current.tapToPay
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Each edit uses the value from the launch read and any earlier successful edits. */
function inStoreOrder<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingAccess.then(operation, operation);
  pendingAccess = result;
  return result;
}

/** Reads the saved preference and makes it the one every reader sees. */
export function loadAutoPayPreference(): Promise<AutoPay> {
  return inStoreOrder(async () => {
    let read = AUTO_PAY_OFF;
    try {
      const saved = await Keychain.getGenericPassword({ service: PREFERENCE });
      read = parseAutoPay(saved ? saved.password : null);
    } catch {
      // An unreadable store pays nothing on its own.
    }
    publish(read);
    return current;
  });
}

/** Saves only the fields the user changed. A failed write keeps the old value. */
export function setAutoPayPreference(change: Partial<AutoPay>): Promise<void> {
  return inStoreOrder(async () => {
    const value = normalizeAutoPay({ ...current, ...change });
    const saved = await Keychain.setGenericPassword(
      'beignet-auto-pay',
      JSON.stringify(value),
      {
        service: PREFERENCE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (!saved) throw new Error('Could not save the auto-pay setting.');
    publish(value);
  });
}

/** The preference every reader shares, kept current as it is saved. */
export function useAutoPay(): AutoPay {
  return useSyncExternalStore(subscribe, autoPayNow);
}
