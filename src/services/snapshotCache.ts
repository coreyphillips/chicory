import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';

/**
 * The last wallet state this app saw, so the next launch opens on the wallet
 * page with real figures while the engine starts, instead of on a connection
 * screen. The figures are marked with the time they were confirmed and go
 * through the same staleness gate as any old snapshot, so nothing cached is
 * ever spendable.
 *
 * The entry lives in the platform secure store like everything else about the
 * wallet. Every row of activity is kept: the entry is the only record of what
 * the app knew across a relaunch, and a wallet never shows less than it
 * already knew, so a read that answers with fewer rows must find the rest
 * here (activityMerge).
 *
 * One entry per wallet. A single shared slot meant switching networks threw
 * away the other network's figures, so switching back always landed on a blank
 * page waiting for an engine, which is the moment the switch felt broken.
 */
const SERVICE = 'com.beignet.wallet.last-snapshot';
const serviceFor = (walletId: string) =>
  `${SERVICE}.${encodeURIComponent(walletId)}`;

interface CachedSnapshot {
  version: 1;
  walletId: string;
  snapshot: WalletSnapshot;
}

/**
 * What each wallet's entry last held, less the read's time, which changes on
 * every read. A read that changed nothing else is not written again: with a
 * long history the entry is large, and the secure store is written for a
 * change in the figures, not for the clock. The first save after the entry
 * is read is always written, so a launch's first live read replaces it.
 */
const lastSaved = new Map<string, string>();
const figuresOf = (value: CachedSnapshot) =>
  JSON.stringify({ ...value, snapshot: { ...value.snapshot, updatedAt: 0 } });

export async function loadCachedSnapshot(
  walletId: string,
): Promise<WalletSnapshot | null> {
  try {
    const saved =
      (await Keychain.getGenericPassword({ service: serviceFor(walletId) })) ||
      // An entry written before this app kept one per wallet. It still carries
      // the wallet it belongs to, and the check below refuses another's.
      (await Keychain.getGenericPassword({ service: SERVICE }));
    lastSaved.delete(walletId);
    if (!saved) return null;
    const value = JSON.parse(saved.password) as CachedSnapshot;
    if (
      value?.version !== 1 ||
      value.walletId !== walletId ||
      !value.snapshot?.balance ||
      !value.snapshot.wallet ||
      !Array.isArray(value.snapshot.activity) ||
      !Number.isFinite(value.snapshot.updatedAt)
    )
      return null;
    // The connection this describes is gone; the page must not claim it.
    return {
      ...value.snapshot,
      primary: { ...value.snapshot.primary, connected: false },
    };
  } catch {
    return null;
  }
}

export async function saveCachedSnapshot(
  walletId: string,
  snapshot: WalletSnapshot,
): Promise<void> {
  const value: CachedSnapshot = { version: 1, walletId, snapshot };
  const figures = figuresOf(value);
  if (figures === lastSaved.get(walletId)) return;
  try {
    await Keychain.setGenericPassword(
      'beignet-snapshot',
      JSON.stringify(value),
      {
        service: serviceFor(walletId),
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    lastSaved.set(walletId, figures);
  } catch {
    // A cache that cannot be written costs the next launch a few seconds,
    // nothing more.
  }
}

export async function clearCachedSnapshot(): Promise<void> {
  lastSaved.clear();
  await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => {});
  const services = await Keychain.getAllGenericPasswordServices().catch(
    () => [] as string[],
  );
  for (const service of services)
    if (service.startsWith(`${SERVICE}.`))
      await Keychain.resetGenericPassword({ service }).catch(() => {});
}
