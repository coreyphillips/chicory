import { clearOfflineReceiveDrafts } from './offlineReceiveDraft';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import type {
  Network,
  WalletRecord,
  WalletSnapshot,
} from '@beignet/wallet-core';
import type { WalletAdapter } from './wallet';
import {
  openDeviceWallet,
  loadDevicePreferences as DevicePreferences,
} from '../embedded/client';
import type { DeviceSettings } from '../embedded/client';
import { recordDiagnostic } from './diagnosticLog';
import { mergeSnapshot } from './activityMerge';
import { markBoot, markEngine, noteRead } from './perf';
import {
  defaultProfile,
  loadNetworkPreferences,
  assertWalletNetwork,
} from './networks';
import type { NetworkProfile } from './networks';
import {
  loadWalletSession,
  saveWalletSession,
  hasSavedDeviceHint,
  clearWalletSession,
} from './session';
import type { WalletSession } from './session';
import {
  clearCachedSnapshot,
  loadCachedSnapshot,
  saveCachedSnapshot,
} from './snapshotCache';

/**
 * The wallet's connection lifecycle, lifted out of the render tree.
 *
 * Every asynchronous action captures the session `generation` and re-checks it
 * before each state write, and each family of action holds an in-flight latch,
 * so a slow open can never land on top of a newer selection and two closes can
 * never race. That discipline is load-bearing and it is what the restore and
 * lifecycle tests assert.
 *
 * A latch is held by a token, an object the action that took it made, and
 * only that action lets it go. An open or a selection lets go of its latch as
 * it commits, when the wallet page is drawn and Settings can be used, not
 * when the engine has finished starting, which over Tor takes tens of seconds
 * and has no limit. The start holds `runtimeStarting` on its own. A lock, an
 * erase or a network switch made while it runs takes over: it moves the
 * generation, so the start can no longer write, and stands the start's busy
 * flags down itself (`standDown`), since the start's own clean-up now skips
 * them. A start that ends late finds its latches gone or taken by a newer
 * action, and leaves them as they are.
 *
 * The wallet runs on this phone. There is no second kind of connection to
 * choose between, so there is no chooser: a launch with nothing saved opens the
 * wallet itself.
 */

/**
 * A device wallet this session let go of whose close has not been seen to
 * finish: closed by an unmount, so a remount can still wait on it, or closed
 * by an action and refused or run out of time. The next open waits on it
 * before it claims the vault.
 */
let detachedDevice: EmbeddedWalletClient | null = null;

/**
 * Close a device wallet the session is letting go of.
 *
 * A close that fails or runs past its deadline has still released the vault's
 * storage (`openDeviceWallet`), but the engine keeps its claim on the JS realm
 * until the start it was waiting on settles, and an open made before then is
 * refused with "Only one portable wallet runtime may own this JS realm". A
 * lock pressed during a cold Tor start is exactly that case. So a client
 * whose close failed is kept in `detachedDevice`, where the next open waits
 * on it, and the failure still throws for the action to report.
 */
async function closeDevice(device: EmbeddedWalletClient) {
  try {
    await device.close();
  } catch (error) {
    detachedDevice = device;
    throw error;
  }
  if (detachedDevice === device) detachedDevice = null;
}

export type Tab = 'Wallet' | 'Activity' | 'Settings';

/** Stale wallet data must not be spendable. Matches the browser client. */
export const STALE_AFTER_MS = 45000;

/**
 * How long the app waits on a recovery, five polls, before it writes down
 * the step it is stuck in and polls on without it.
 */
export const RECOVERY_DEADLINE_MS = 60000;

type RecoveryStep = 'startWallet' | 'refreshWallet' | 'snapshot';

type Balance = WalletSnapshot['balance'];

/** Whether `next` holds less than `before`, in total or ready to send. */
const shrank = (before: Balance, next: Balance) =>
  next.totalSats < before.totalSats ||
  next.availableSats < before.availableSats;

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'The wallet could not complete this request.';

export interface WalletSessionView {
  /** Where the user is now, so a network switch can put them back. */
  tab: Tab;
  onTab: (tab: Tab) => void;
  onCloseSheet: () => void;
  /**
   * Hold the restore. Set while the app lock is being checked or is engaged, so
   * a locked app does not start an engine or read a balance for someone who has
   * not authenticated. Only the first restore is held; re-locking later covers
   * the screen without tearing a running wallet down.
   */
  paused?: boolean;
}

/** Consecutive failed background reads before the wallet page says so. */
const POLL_FAILURE_LIMIT = 3;

/**
 * Whether a wallet can be created on this profile without asking anything
 * first. Only mainnet ships with a primary node, and the shared client refuses
 * a wallet without one, so creating on a test network before its node is
 * configured would fail every time with a message about a URI nobody was asked
 * for. Those networks land on the picker instead.
 */
const canCreateOn = (profile: NetworkProfile) => !!profile.primaryUri.trim();

/** A compressed public key, as the engine names a peer. */
const NODE_ID = /^0[23][0-9a-f]{64}$/i;

/**
 * The primary's public key, as `snapshot` knows it: the wallet record's own
 * `primaryPubkey`, or else the key before the `@` of the primary's URI, in
 * lower case. Empty when neither is a public key, as before a wallet's first
 * read, which leaves the primary unknown.
 */
export function primaryPubkey(
  snapshot: WalletSnapshot | null | undefined,
): string {
  const named = snapshot?.wallet?.lfbw?.primaryPubkey ?? '';
  if (NODE_ID.test(named)) return named.toLowerCase();
  const uri = snapshot?.primary?.uri ?? '';
  const front = uri.slice(0, Math.max(0, uri.indexOf('@')));
  return NODE_ID.test(front) ? front.toLowerCase() : '';
}

/**
 * Notes how long a wallet read takes, and whether another was still out as
 * it began, for the boot report (services/perf). `out` counts the reads
 * under way. The read itself is handed back untouched for the caller to
 * await, so timing it puts no step between the answer and its landing.
 */
function timeRead<T>(read: Promise<T>, out: { current: number }): Promise<T> {
  const overlapped = out.current > 0;
  out.current += 1;
  const began = Date.now();
  const settled = () => {
    out.current -= 1;
    noteRead(Date.now() - began, overlapped);
  };
  Promise.resolve(read).then(settled, settled);
  return read;
}

export function useWalletSession(view: WalletSessionView) {
  const { onTab, onCloseSheet, paused = false } = view;
  // Read through a ref so the action callbacks do not have to be rebuilt on
  // every tab change, which would restart the snapshot poll.
  const tabRef = useRef(view.tab);
  tabRef.current = view.tab;
  const [rememberedSession, setRememberedSession] =
    useState<WalletSession | null>(null);
  const [deviceHint, setDeviceHint] = useState(false);
  /**
   * The token of the open or selection whose wallet is starting, held from
   * its commit until the start and its first read settle. Reads and
   * recoveries wait for it, and a second selection is refused while it is
   * held. A start ends by clearing it only while it still holds it: one
   * replaced by a newer open must not let that open's reads in early.
   */
  const runtimeStarting = useRef<object | null>(null);
  const ownedDevice = useRef<EmbeddedWalletClient | null>(null);
  /**
   * What the app knows of the open wallet: the state it opened on from the
   * cache, merged with every read since. A wallet never shows less than it
   * already knew, so a read lands through `land`, which puts back what the
   * read lost (activityMerge) before it goes on the page and into the cache.
   * It belongs to one wallet id, and is forgotten wherever the page is
   * cleared, so nothing known of one wallet crosses to another.
   */
  const known = useRef<{ walletId: string; snapshot: WalletSnapshot } | null>(
    null,
  );
  // The engine reports the primary answering through its diagnostic hook.
  // That is the moment the balance changes from "reconnecting" to a figure
  // that can be sent, so it is read then, through a ref because the reader
  // is defined further down and must not rebuild the connect callback.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const connectRefreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearConnectRefresh = () => {
    for (const timer of connectRefreshTimers.current) clearTimeout(timer);
    connectRefreshTimers.current = [];
  };
  const onDeviceDiagnostic = useCallback(
    (event: { phase: string; message: string; code?: string }) => {
      recordDiagnostic(event);
      // The engine's own timings, for the boot report (services/perf). They
      // are logged like any other event, so the copied report carries them;
      // the Diagnostics page lists only the app's own errors, so they never
      // show there as one.
      if (event.phase === 'engine-perf') {
        markEngine(event.message);
        return;
      }
      // Only the primary's connection changes what can be spent. A peer
      // connect names the peer by its public key; while the primary's is
      // not known yet, as before a wallet's first read, any connect counts.
      const primary = primaryPubkey(known.current?.snapshot);
      const connected =
        (event.phase === 'peer:connect' &&
          (!primary || String(event.message).toLowerCase() === primary)) ||
        (event.phase === 'primary-redial' && event.message === 'reconnected');
      if (!connected) return;
      markBoot('primary-connected');
      // The handshake is done but the channel only counts as spendable once
      // reestablishment finishes a moment later, so read soon and once more
      // a few seconds on, instead of waiting for the next 12 second poll.
      clearConnectRefresh();
      connectRefreshTimers.current = [1500, 6000].map(ms =>
        setTimeout(() => {
          refreshRef.current().catch(() => {});
        }, ms),
      );
    },
    [],
  );
  const closingInFlight = useRef(false);
  const [closing, setClosing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [activeProfile, setActiveProfile] = useState<NetworkProfile>(
    defaultProfile('mainnet'),
  );
  const [switching, setSwitching] = useState(false);
  const [networkEditor, setNetworkEditor] = useState(false);
  const [client, setClient] = useState<WalletAdapter | null>(null);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [walletId, setWalletId] = useState('');
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  // Background polls read through these refs so a failed read can decide
  // whether anything is on screen without rebuilding the poll.
  const snapshotRef = useRef<WalletSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const pollFailures = useRef(0);
  /** The engine call a recovery is waiting on has not settled. */
  const recovering = useRef(false);
  /**
   * A read that succeeded and still leaves the staleness gate closed, since
   * the figures it carries are already old, is written down once for each
   * stretch the gate stays closed, with the time they carry. It tells a read
   * answered every twelve seconds apart from none at all when the page has
   * said "not confirmed recently" for half an hour.
   */
  const staleReadNoted = useRef(false);
  const [initializing, setInitializing] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceVisible, setDeviceVisible] = useState(false);
  const [error, setError] = useState('');
  // A switch outlives the screen that started it: the switching page replaces
  // whatever was showing, so the form's own error state is unmounted before it
  // can be read. These two live here so the reason survives to the other side.
  const [switchError, setSwitchError] = useState('');
  const [switchTarget, setSwitchTarget] = useState<Network | null>(null);
  const generation = useRef(0);
  const restoreStarted = useRef(false);
  const restoreActive = useRef(true);
  /**
   * Held by any action that opens a wallet, so two opens cannot race, until
   * it commits. Each holds the token of the action that took it, and is let
   * go only by that action.
   */
  const connectInFlight = useRef<object | null>(null);
  /** Held by a selection until it commits, and by a switch until it opens. */
  const selectionInFlight = useRef<object | null>(null);
  const invalidateSession = useCallback(() => {
    generation.current += 1;
  }, []);
  /**
   * The busy flags of an open, selection or retry that a lock, an erase or a
   * switch has just taken over from. That action's own clean-up clears them
   * only while its generation is current, which it no longer is, so without
   * this the opening wait or a turning retry would stay up for good.
   */
  const standDown = useCallback(() => {
    setConnecting(false);
    setSelecting(false);
    setRefreshing(false);
  }, []);

  /**
   * A successful read of wallet `id`, onto the page and into the cache, kept
   * whole against what the app knew. The balance, the primary's state, the
   * notes and the read's time are the read's own; only the history the read
   * lost is put back. A read taken while the engine is resyncing answers with
   * what it has so far, which can be less than it had, so on that path the
   * last figures stay, still marked as old, until the resync has settled and
   * an ordinary read confirms them.
   */
  const land = useCallback(
    (id: string, read: WalletSnapshot, resyncing = false) => {
      const age = Date.now() - read.updatedAt;
      if (age <= STALE_AFTER_MS) staleReadNoted.current = false;
      else if (!staleReadNoted.current) {
        staleReadNoted.current = true;
        recordDiagnostic({
          phase: 'balance',
          message: `read answered with figures already ${Math.round(
            age / 1000,
          )}s old, updatedAt ${new Date(read.updatedAt).toISOString()}`,
        });
      }
      const before =
        known.current?.walletId === id ? known.current.snapshot : null;
      let next = mergeSnapshot(before, read);
      if (resyncing && before && shrank(before.balance, next.balance))
        next = {
          ...next,
          balance: before.balance,
          updatedAt: before.updatedAt,
        };
      known.current = { walletId: id, snapshot: next };
      setSnapshot(next);
      setError('');
      saveCachedSnapshot(id, next);
    },
    [],
  );

  /**
   * Put the last state this wallet was seen in on the page while its engine
   * starts. A live snapshot that lands first is never replaced by the cache;
   * the rows the cache knew and that read did not are kept beside it. It
   * answers whether the cache had anything to put there.
   */
  const hydrate = useCallback(async (id: string, current: number) => {
    const cached = await loadCachedSnapshot(id);
    if (!cached || generation.current !== current) return false;
    const live = known.current?.walletId === id ? known.current.snapshot : null;
    const next = live ? mergeSnapshot(cached, live) : cached;
    known.current = { walletId: id, snapshot: next };
    setSnapshot(next);
    return true;
  }, []);

  /**
   * The wallet's reads under way, for the boot report's count of reads that
   * overlapped (services/perf).
   */
  const readsOut = useRef(0);

  /** One read of the wallet, onto the page. `refresh` decides when. */
  const readOnce = useCallback(async () => {
    if (
      !client ||
      !walletId ||
      runtimeStarting.current ||
      closingInFlight.current
    ) {
      return;
    }
    const current = generation.current;
    // A background read shows no spinner: the figures on screen stay put and
    // are replaced when the new ones arrive.
    try {
      const next = await timeRead(client.snapshot(), readsOut);
      if (generation.current === current) {
        pollFailures.current = 0;
        const before = snapshotRef.current;
        if (
          !before ||
          before.balance.availableSats !== next.balance.availableSats ||
          before.primary.connected !== next.primary.connected
        )
          recordDiagnostic({
            phase: 'balance',
            message: `ready ${next.balance.availableSats}, arriving ${
              next.balance.pendingSats
            }, primary ${
              next.primary.connected ? 'connected' : 'not connected'
            }`,
          });
        land(walletId, next, recovering.current);
      }
    } catch (e) {
      if (generation.current === current) {
        pollFailures.current += 1;
        // One missed read behind a live balance is not worth a banner; the
        // staleness gate already closes Send and Receive when the figures
        // age out. Without a balance on screen the failure is the screen.
        if (!snapshotRef.current || pollFailures.current >= POLL_FAILURE_LIMIT)
          setError(errorMessage(e));
        // Identity and its saved diagnostic must stay reachable when balances
        // cannot load, so the offline screen can explain and offer a retry
        // instead of showing a bare "connecting" spinner forever.
        try {
          const records = await client.listWallets();
          if (generation.current === current) setWallets(records);
        } catch {
          // Keep the previously known records rather than emptying the picker.
        }
      }
    }
  }, [client, walletId, land]);

  /**
   * The read under way, and whether anyone asked for another while it ran.
   * It belongs to one session generation, wallet and client.
   */
  const reading = useRef<{
    key: string;
    client: WalletAdapter;
    again: boolean;
    done: Promise<void>;
  } | null>(null);

  /**
   * Read the wallet onto the page, joining a read already under way rather
   * than starting a second beside it. The twelve second poll, the reads
   * after the primary connects, a manual refresh and a recovery can all ask
   * at once, and every read the engine answers costs the JS thread the same
   * again, which on a launch is the thread the page is waiting on.
   *
   * A call that joins does not take the answer already on its way: it asks
   * for one more read, which starts once the current one lands, and its
   * promise settles after that. So a caller that has just had the engine
   * resync, as a manual refresh and a recovery do, still gets a read begun
   * after its resync, and any number of calls during one read add exactly
   * one more. A new generation, wallet or client starts afresh, and a read
   * of the old one asks for nothing more.
   */
  const refresh = useCallback((): Promise<void> => {
    if (
      !client ||
      !walletId ||
      runtimeStarting.current ||
      closingInFlight.current
    ) {
      return Promise.resolve();
    }
    const current = generation.current;
    const key = `${current}:${walletId}`;
    const joined = reading.current;
    if (joined && joined.key === key && joined.client === client) {
      joined.again = true;
      return joined.done;
    }
    const entry = { key, client, again: false, done: Promise.resolve() };
    reading.current = entry;
    entry.done = (async () => {
      try {
        do {
          entry.again = false;
          await readOnce();
        } while (
          entry.again &&
          reading.current === entry &&
          generation.current === current
        );
      } finally {
        if (reading.current === entry) reading.current = null;
      }
    })();
    return entry.done;
  }, [client, walletId, readOnce]);
  refreshRef.current = refresh;

  const manualRefresh = useCallback(async () => {
    if (
      !client ||
      !walletId ||
      closingInFlight.current ||
      runtimeStarting.current
    ) {
      return;
    }
    const current = generation.current;
    setRefreshing(true);
    try {
      await client.startWallet();
      await client.refreshWallet();
      if (generation.current === current) {
        await refresh();
      }
    } catch (e) {
      if (generation.current === current) {
        setError(errorMessage(e));
      }
    } finally {
      if (generation.current === current) {
        setRefreshing(false);
      }
    }
  }, [client, walletId, refresh]);

  /**
   * The same work the manual refresh does, run by the app on its own behalf,
   * timed and bounded.
   *
   * Latched on the engine call itself: a resync that is slow to answer must
   * not have another stacked on top of it every twelve seconds. The latch
   * lifts as soon as the engine has answered or failed, so the read that
   * follows is an ordinary one.
   *
   * No call on this path has a deadline of its own on the phone, so one that
   * never settled used to hold the app's reads for good with nothing written
   * down. After RECOVERY_DEADLINE_MS the step it is stuck in goes to the
   * diagnostic log with how long it has run, the session error is set so the
   * failure is logged under its code, and the poll goes on without it; what
   * the call does in the end is written down too. A recovery that settles
   * in time writes nothing.
   */
  const recover = useCallback(async () => {
    if (
      recovering.current ||
      !client ||
      !walletId ||
      closingInFlight.current ||
      runtimeStarting.current
    )
      return;
    recovering.current = true;
    const current = generation.current;
    const begun = Date.now();
    const ran = () => `${((Date.now() - begun) / 1000).toFixed(1)}s`;
    let step: RecoveryStep = 'startWallet';
    let overdue = false;
    const deadline = setTimeout(() => {
      overdue = true;
      recordDiagnostic({
        phase: 'recovery',
        message: `${step} still running after ${ran()}`,
      });
      if (generation.current === current) {
        setError(
          `The wallet did not finish ${step} within ${
            RECOVERY_DEADLINE_MS / 1000
          } seconds.`,
        );
        setRefreshing(false);
      }
    }, RECOVERY_DEADLINE_MS);
    setRefreshing(true);
    try {
      await client.startWallet();
      step = 'refreshWallet';
      await client.refreshWallet();
      recovering.current = false;
      step = 'snapshot';
      if (generation.current === current) await refresh();
      if (overdue)
        recordDiagnostic({
          phase: 'recovery',
          message: `recovery settled after ${ran()}`,
        });
    } catch (e) {
      recordDiagnostic({
        phase: 'recovery',
        message: `${step} failed after ${ran()}: ${errorMessage(e)}`,
      });
      if (generation.current === current) setError(errorMessage(e));
    } finally {
      clearTimeout(deadline);
      recovering.current = false;
      if (generation.current === current) setRefreshing(false);
    }
  }, [client, walletId, refresh]);

  /** Ask the wallet to run its setup again, from wherever it failed. */
  const retrySetup = useCallback(async () => {
    if (!client || closingInFlight.current) return;
    const current = generation.current;
    setRefreshing(true);
    setError('');
    try {
      await client.retrySetup();
      if (generation.current === current) await refresh();
    } catch (e) {
      if (generation.current === current) setError(errorMessage(e));
    } finally {
      if (generation.current === current) setRefreshing(false);
    }
  }, [client, refresh]);

  useEffect(() => {
    if (!client || !walletId) {
      return;
    }
    /**
     * The ordinary background read, or a real recovery when the figures have
     * aged past the point of being spendable.
     *
     * A plain read is only a question; if the answers have stopped arriving,
     * asking the same question again is not going to help. Once the staleness
     * gate has closed Send and Receive, the poll escalates to starting the
     * wallet and resyncing it, which is what the manual refresh does. The app
     * can do that itself, so it does, rather than putting a "pull to refresh"
     * on the page and waiting to be asked.
     *
     * While a recovery is still waiting on the engine, the poll keeps asking
     * the plain question beside it: a read the engine can answer is not held
     * back behind a resync it cannot finish.
     */
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      const current = snapshotRef.current;
      const aged = current && Date.now() - current.updatedAt > STALE_AFTER_MS;
      if (aged && !recovering.current) recover().catch(() => {});
      else refresh().catch(() => {});
    };
    refresh();
    const timer = setInterval(tick, 12000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      clearConnectRefresh();
      subscription.remove();
    };
  }, [client, walletId, refresh, recover]);

  const selectWallet = useCallback(
    async (
      wallet: WalletRecord,
      backupAcknowledged = false,
      backupPending = false,
    ) => {
      // A selection lets go of its latch as it commits, so the start it runs
      // is what still has to refuse a second one: two selections never race
      // for one engine.
      if (
        !client ||
        selectionInFlight.current ||
        closingInFlight.current ||
        runtimeStarting.current
      ) {
        return;
      }
      const token = {};
      selectionInFlight.current = token;
      setSelecting(true);
      const current = ++generation.current;
      try {
        const session: WalletSession = {
          mode: 'device',
          network: wallet.network,
          walletId: wallet.id,
          locked: false,
          ...(backupPending ||
          (!backupAcknowledged && rememberedSession?.backupPending)
            ? { backupPending: true }
            : {}),
        };
        await saveWalletSession(session);
        if (generation.current !== current) return;
        setRememberedSession(session);
        setDeviceHint(true);
        client.selectWallet(wallet.id);
        runtimeStarting.current = token;
        setWalletId(wallet.id);
        setSnapshot(null);
        known.current = null;
        setError('');
        onCloseSheet();
        onTab('Wallet');
        setWallets(previous =>
          previous.some(existing => existing.id === wallet.id)
            ? previous
            : [...previous, wallet],
        );
        // Committed: the wallet's page is up, and the lock on it works from
        // here on. The start below holds `runtimeStarting` instead.
        if (selectionInFlight.current === token)
          selectionInFlight.current = null;
        await hydrate(wallet.id, current);
        try {
          if (wallet.status !== 'running') await client.startWallet();
          const value = await timeRead(client.snapshot(), readsOut);
          if (generation.current === current) land(wallet.id, value);
        } catch (e) {
          if (generation.current === current) setError(errorMessage(e));
        } finally {
          if (runtimeStarting.current === token) runtimeStarting.current = null;
        }
      } catch (e) {
        if (generation.current === current) setError(errorMessage(e));
        throw e;
      } finally {
        if (selectionInFlight.current === token)
          selectionInFlight.current = null;
        // An action that took over has already stood this down.
        if (generation.current === current) setSelecting(false);
      }
    },
    [client, rememberedSession, onCloseSheet, onTab, hydrate, land],
  );

  const openDevice = useCallback(
    async (
      settings: DeviceSettings,
      options?: {
        existingOnly?: boolean;
        allowEmpty?: boolean;
        walletId?: string;
        prepared?: boolean;
        backupPending?: boolean;
        returnTo?: Tab;
        /** An empty vault gets a wallet with the profile's defaults. */
        createIfEmpty?: boolean;
        /**
         * The engine exists and the page can be drawn. Everything after this
         * is the chain catching up, which the wallet page shows on its own, so
         * a caller holding a full-screen wait can stand down here rather than
         * at the end.
         */
        onCommitted?: () => void;
        /**
         * Continue a caller's session rather than starting one. A switch is a
         * single action: if this minted a generation of its own, the caller's
         * own checks would compare against one this call had already moved
         * past, and would quietly skip the rollback a failed switch depends on.
         */
        generation?: number;
      },
    ) => {
      if (connectInFlight.current || closingInFlight.current) return;
      const token = {};
      connectInFlight.current = token;
      const current = options?.generation ?? ++generation.current;
      setConnecting(true);
      setError('');
      recordDiagnostic({
        phase: 'session',
        message: `opening the ${settings.network} wallet`,
      });
      let next: EmbeddedWalletClient | undefined;
      let committed = false;
      try {
        if (detachedDevice) {
          // The last wallet is still closing, or its close failed or ran out
          // of time and is asked again here, which waits on the same engine
          // close. Its storage is released either way; what this waits for
          // is the engine letting go of the realm, which it does when that
          // close settles, however it settles. A second failure does not stop
          // the open: whatever still holds the vault says so in its own error.
          const previous = detachedDevice;
          await previous.close().catch(e =>
            recordDiagnostic({
              phase: 'session',
              message: `the last wallet did not finish closing: ${errorMessage(
                e,
              )}`,
            }),
          );
          if (detachedDevice === previous) detachedDevice = null;
        }
        if (generation.current !== current) return;
        const allowEmpty =
          !options?.walletId && (options?.prepared || options?.allowEmpty);
        next = await openDeviceWallet(settings, onDeviceDiagnostic, {
          existingOnly: options?.existingOnly ?? false,
          ...(allowEmpty ? { allowEmpty: true } : {}),
        });
        let records = await next.listWallets();
        assertWalletNetwork(records, settings.network);
        // Opening the app is meant to end on a wallet page, not on a form. An
        // empty vault gets its wallet here, from the network profile's
        // defaults, and the recovery phrase waits behind the backup banner on
        // the wallet page. A failure leaves the empty vault as it was, with
        // the error shown beside the manual way in.
        let createdNow = false;
        let creationError = '';
        if (records.length === 0 && options?.createIfEmpty) {
          try {
            const created = await next.createWallet({
              name: 'My wallet',
              network: settings.network,
              primaryUri: settings.primaryUri,
            });
            if (generation.current !== current) {
              await next.close();
              return;
            }
            // The phrase stays in the vault; the wallet page's backup banner
            // reveals it on request.
            const record = { ...created };
            delete record.mnemonic;
            delete record.warnings;
            records = [record];
            createdNow = true;
          } catch (e) {
            creationError = errorMessage(e);
          }
        }
        if (options?.existingOnly && !allowEmpty && records.length === 0)
          throw new Error(
            'The saved wallet could not be found. No new wallet was created.',
          );
        const selected = options?.walletId
          ? records.find(record => record.id === options.walletId)
          : records.length === 1
          ? records[0]
          : undefined;
        if (options?.walletId && !selected)
          throw new Error(
            'The saved wallet identity is unavailable. Existing storage was preserved.',
          );
        if (generation.current !== current) {
          await next.close();
          return;
        }
        const session: WalletSession = {
          mode: 'device',
          network: settings.network,
          walletId: selected?.id,
          // `locked` means the owner locked it, and it is what stops the next
          // launch from reopening. Opening a vault that simply had no wallet to
          // select is not a lock: recording it as one made the app come back to
          // the welcome screen instead of the wallet. An empty vault is already
          // described by `prepared`.
          locked: false,
          ...(records.length === 0 ? { prepared: true } : {}),
          ...(selected &&
          (createdNow || options?.prepared || options?.backupPending)
            ? { backupPending: true }
            : {}),
        };
        await saveWalletSession(session);
        if (generation.current !== current) {
          await next.close();
          return;
        }
        setRememberedSession(session);
        setDeviceHint(records.length > 0);
        if (selected) next.selectWallet(selected.id);
        runtimeStarting.current = selected ? token : null;
        setActiveProfile(settings);
        setClient(next);
        setWallets(records);
        setWalletId(selected?.id || '');
        setSnapshot(null);
        known.current = null;
        if (creationError) setError(creationError);
        onTab(options?.returnTo || 'Wallet');
        setDeviceVisible(false);
        setNetworkEditor(false);
        committed = true;
        ownedDevice.current = next;
        // Committed: the page is drawn and Settings works, so the lock, the
        // erase and a switch made from them must be heard now, not after a
        // start that may take minutes. The start is held by
        // `runtimeStarting` instead.
        if (connectInFlight.current === token) connectInFlight.current = null;
        setInitializing(false);
        options?.onCommitted?.();
        if (selected) {
          // The wallet page opens now, on the last state this wallet was seen
          // in, and the live figures replace it when the engine is up. Each
          // step is a mark in the boot report (services/perf).
          const cached = await hydrate(selected.id, current);
          markBoot('page-hydrated', cached ? undefined : 'nothing cached');
          try {
            await next.startWallet();
            markBoot('engine-started');
            const value = await timeRead(next.snapshot(), readsOut);
            if (generation.current === current) {
              land(selected.id, value);
              markBoot('first-live-read');
            }
          } catch (e) {
            if (generation.current === current) setError(errorMessage(e));
          } finally {
            if (runtimeStarting.current === token)
              runtimeStarting.current = null;
          }
        }
      } catch (e) {
        if (next && !committed) {
          detachedDevice = next;
          await next.close();
          if (detachedDevice === next) detachedDevice = null;
        }
        if (generation.current === current) setError(errorMessage(e));
        // The caller decides what a failure means. A switch has to roll back
        // and say why, and the restore link must not open the create sheet on
        // top of a wallet that never opened. Swallowing here hid both.
        throw e;
      } finally {
        if (connectInFlight.current === token) connectInFlight.current = null;
        // An action that took over has already stood this down.
        if (generation.current === current) setConnecting(false);
      }
    },
    [onTab, hydrate, land, onDeviceDiagnostic],
  );

  // The owned runtime must be closed when the app goes away, whether or not a
  // restore ever ran, so this is registered once and never re-registered.
  useEffect(() => {
    return () => {
      restoreActive.current = false;
      invalidateSession();
      if (ownedDevice.current) {
        const previous = ownedDevice.current;
        ownedDevice.current = null;
        detachedDevice = previous;
        previous
          .close()
          .then(() => {
            if (detachedDevice === previous) detachedDevice = null;
          })
          .catch(() => {});
      }
    };
  }, [invalidateSession]);

  useEffect(() => {
    if (paused || restoreStarted.current) return;
    restoreStarted.current = true;
    const active = restoreActive;
    const restore = async () => {
      const saved = await loadWalletSession();
      if (!active.current) return;
      setRememberedSession(saved);
      if (saved) {
        setDeviceHint(!saved.prepared);
        const preferences = await loadNetworkPreferences();
        if (!active.current) return;
        setActiveProfile(preferences.profiles[saved.network]);
        if (!saved.locked && !saved.prepared)
          // The error is already on the page; a rejection here would replace
          // the engine's own sentence with a vaguer one about restoring.
          await openDevice(preferences.profiles[saved.network], {
            existingOnly: true,
            walletId: saved.walletId,
            backupPending: saved.backupPending,
          }).catch(() => {});
        return;
      }
      const hint = await hasSavedDeviceHint();
      if (!active.current) return;
      setDeviceHint(hint);
      if (hint) return;
      // Nothing is saved and no vault exists. There is no choice left to put
      // to anyone, so the wallet opens itself rather than asking permission to
      // be the only thing it can be.
      const preferences = await DevicePreferences();
      if (!active.current) return;
      setActiveProfile(preferences.profiles[preferences.selectedNetwork]);
      await openDevice(preferences.profiles[preferences.selectedNetwork], {
        allowEmpty: true,
        createIfEmpty: canCreateOn(
          preferences.profiles[preferences.selectedNetwork],
        ),
      }).catch(() => {});
    };
    restore()
      .catch(e => {
        if (active.current)
          setError(`Could not restore your saved wallet: ${errorMessage(e)}`);
      })
      .finally(() => {
        if (active.current) setInitializing(false);
      });
  }, [paused, openDevice]);

  const openWallet = useCallback(
    async (options?: { restore?: boolean }) => {
      if (rememberedSession) {
        const preferences = await loadNetworkPreferences();
        await openDevice(preferences.profiles[rememberedSession.network], {
          existingOnly: true,
          walletId: rememberedSession.walletId,
          prepared: rememberedSession.prepared,
          backupPending: rememberedSession.backupPending,
          createIfEmpty:
            !options?.restore &&
            canCreateOn(preferences.profiles[rememberedSession.network]),
        });
      } else {
        // The saved defaults are the setup. Mainnet comes with its server and
        // primary, so there is nothing to type before the wallet exists; a
        // network that still needs a server fails here with that one sentence
        // and the settings link beside it.
        const preferences = await DevicePreferences();
        await openDevice(preferences.profiles[preferences.selectedNetwork], {
          existingOnly: deviceHint,
          allowEmpty: true,
          createIfEmpty:
            !options?.restore &&
            canCreateOn(preferences.profiles[preferences.selectedNetwork]),
        });
      }
    },
    [rememberedSession, deviceHint, openDevice],
  );

  /** Create a wallet with the open profile's defaults and land on it. */
  const createDefaultWallet = useCallback(async () => {
    if (!client || selectionInFlight.current) return;
    setSelecting(true);
    setError('');
    let created;
    try {
      created = await client.createWallet({
        name: 'My wallet',
        network: activeProfile.network,
        primaryUri: activeProfile.primaryUri,
      });
    } catch (e) {
      setError(errorMessage(e));
      setSelecting(false);
      return;
    }
    setSelecting(false);
    const record = { ...created };
    delete record.mnemonic;
    delete record.warnings;
    await selectWallet(record, false, true).catch(() => {});
  }, [client, activeProfile, selectWallet]);

  const switchNetwork = useCallback(
    async (profile: NetworkProfile, returnTo?: Tab) => {
      // A switch opens a wallet, so it waits for another open to commit. A
      // start still running after its commit does not hold it: this takes
      // over from it, as a lock does.
      if (
        selectionInFlight.current ||
        connectInFlight.current ||
        switching ||
        closingInFlight.current
      )
        return;
      const previousProfile = activeProfile;
      const target = returnTo ?? tabRef.current;
      const token = {};
      selectionInFlight.current = token;
      const current = ++generation.current;
      standDown();
      setSwitching(true);
      setSwitchTarget(profile.network);
      setSwitchError('');
      try {
        if (client instanceof EmbeddedWalletClient) {
          const previous = client;
          // Given up before the await, so the unmount cleanup cannot start a
          // second close on the same client while this one is running.
          ownedDevice.current = null;
          await closeDevice(previous);
        }
        if (generation.current !== current) return;
        setClient(null);
        setWalletId('');
        setWallets([]);
        setSnapshot(null);
        known.current = null;
        onCloseSheet();
        setError('');
        setActiveProfile(profile);
        // The open holds its own latch, and it is where the rest of the wait
        // lives; holding this one across it would make the open look like a
        // second switch to every guard that checks it.
        if (selectionInFlight.current === token)
          selectionInFlight.current = null;
        await openDevice(profile, {
          generation: current,
          returnTo: target,
          allowEmpty: true,
          createIfEmpty: canCreateOn(profile),
          // The engine object exists and the page can be drawn. Everything
          // after this is the chain catching up, which the wallet page already
          // knows how to show, so the switching screen steps out of the way
          // instead of holding the app until the network answers.
          onCommitted: () => setSwitching(false),
        });
      } catch (e) {
        // Whatever state the old client is in, it is not usable: it marks
        // itself closed before its runtime finishes, so a close that failed
        // leaves an object that answers every later call with "unlock your
        // local wallet". Dropping it is the only honest option, while this
        // switch is still the last action; after a newer one, the client on
        // the page is that action's to keep or drop. A close that failed is
        // waited on again by the next open (`closeDevice`).
        if (generation.current === current) {
          setClient(null);
          setActiveProfile(previousProfile);
          setError('');
          setSwitchError(errorMessage(e));
        }
        throw e;
      } finally {
        if (selectionInFlight.current === token)
          selectionInFlight.current = null;
        // A second switch made while this one's wallet was starting owns the
        // switching page now, and keeps it until its own wallet is drawn.
        if (generation.current === current) {
          setSwitching(false);
          setSwitchTarget(null);
        }
      }
    },
    [client, switching, activeProfile, openDevice, onCloseSheet, standDown],
  );

  const disconnect = useCallback(async () => {
    // An open or a selection lets go of its latch as it commits, and a switch
    // of its own once its old wallet is closed, so these refuse only an
    // action still on its way to a page. There is no page to lock until then,
    // and taking over a half-made open would leave its latch held and the
    // next open refused. A wallet that is starting is locked at once.
    if (
      selectionInFlight.current ||
      connectInFlight.current ||
      closingInFlight.current
    )
      return;
    closingInFlight.current = true;
    setClosing(true);
    const current = ++generation.current;
    standDown();
    try {
      if (client instanceof EmbeddedWalletClient) {
        const session: WalletSession = {
          mode: 'device',
          network: activeProfile.network,
          walletId: walletId || rememberedSession?.walletId,
          locked: true,
          ...(wallets.length === 0 ? { prepared: true } : {}),
          ...(rememberedSession?.backupPending ? { backupPending: true } : {}),
        };
        await saveWalletSession(session);
        // During a start this waits for the engine to stop, up to the close
        // deadline (`openDeviceWallet`), on the closing page.
        await closeDevice(client);
        ownedDevice.current = null;
        setRememberedSession(session);
        setDeviceHint(!session.prepared);
      }
      if (generation.current !== current) return;
      setClient(null);
      setWalletId('');
      setWallets([]);
      setSnapshot(null);
      known.current = null;
      onCloseSheet();
      setError('');
      setDeviceVisible(false);
      setNetworkEditor(false);
    } catch (e) {
      setError(`Could not close the wallet: ${errorMessage(e)}`);
    } finally {
      closingInFlight.current = false;
      setClosing(false);
    }
  }, [
    client,
    activeProfile,
    walletId,
    rememberedSession,
    wallets,
    onCloseSheet,
    standDown,
  ]);

  /**
   * Remove the device wallet from this phone so a new one can be created or
   * an existing one restored from its phrase. The engine is closed first, the
   * session is marked locked so a half-finished erase cannot be reopened as if
   * nothing happened, and only a complete erase forgets the wallet.
   */
  const eraseDevice = useCallback(async () => {
    // Refused, as the lock is, only while an action is still on its way to a
    // page; a wallet that is starting is erased at once.
    if (
      selectionInFlight.current ||
      connectInFlight.current ||
      closingInFlight.current ||
      !(client instanceof EmbeddedWalletClient)
    )
      return;
    closingInFlight.current = true;
    setClosing(true);
    setErasing(true);
    const current = ++generation.current;
    standDown();
    try {
      await saveWalletSession({
        mode: 'device',
        network: activeProfile.network,
        locked: true,
      });
      await closeDevice(client);
      ownedDevice.current = null;
      setClient(null);
      setWalletId('');
      setWallets([]);
      setSnapshot(null);
      known.current = null;
      onCloseSheet();
      const [{ eraseDeviceStorage }, { clearSeedSource }] = await Promise.all([
        import('../embedded/storage'),
        import('../embedded/seed'),
      ]);
      await eraseDeviceStorage();
      await clearSeedSource();
      await clearCachedSnapshot();
      await clearOfflineReceiveDrafts();
      await clearWalletSession();
      if (generation.current !== current) return;
      setRememberedSession(null);
      setDeviceHint(false);
      setError('');
      setDeviceVisible(false);
      setNetworkEditor(false);
    } catch (e) {
      if (generation.current === current) {
        setDeviceHint(true);
        setError(`Could not erase the wallet: ${errorMessage(e)}`);
      }
      throw e;
    } finally {
      closingInFlight.current = false;
      setClosing(false);
      setErasing(false);
    }
  }, [client, activeProfile, onCloseSheet, standDown]);

  const acknowledgeBackup = useCallback(() => {
    if (!rememberedSession) return;
    const next: WalletSession = { ...rememberedSession, backupPending: false };
    saveWalletSession(next)
      .then(() => setRememberedSession(next))
      .catch(e => setError(errorMessage(e)));
  }, [rememberedSession]);

  return {
    // state
    rememberedSession,
    deviceHint,
    closing,
    erasing,
    activeProfile,
    switching,
    switchTarget,
    switchError,
    networkEditor,
    client,
    wallets,
    walletId,
    snapshot,
    initializing,
    connecting,
    selecting,
    refreshing,
    deviceVisible,
    error,
    // actions
    setError,
    setSwitchError,
    setNetworkEditor,
    setDeviceVisible,
    refresh,
    manualRefresh,
    retrySetup,
    selectWallet,
    openDevice,
    openWallet,
    createDefaultWallet,
    switchNetwork,
    disconnect,
    eraseDevice,
    acknowledgeBackup,
  };
}
