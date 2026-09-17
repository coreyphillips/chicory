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
 * The wallet runs on this phone. There is no second kind of connection to
 * choose between, so there is no chooser: a launch with nothing saved opens the
 * wallet itself.
 */

/** Survives a remount so an interrupted close can still be awaited. */
let detachedDevice: EmbeddedWalletClient | null = null;

export type Tab = 'Wallet' | 'Activity' | 'Settings';

/** Stale wallet data must not be spendable. Matches the browser client. */
export const STALE_AFTER_MS = 45000;

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

export function useWalletSession(view: WalletSessionView) {
  const { onTab, onCloseSheet, paused = false } = view;
  // Read through a ref so the action callbacks do not have to be rebuilt on
  // every tab change, which would restart the snapshot poll.
  const tabRef = useRef(view.tab);
  tabRef.current = view.tab;
  const [rememberedSession, setRememberedSession] =
    useState<WalletSession | null>(null);
  const [deviceHint, setDeviceHint] = useState(false);
  const runtimeStarting = useRef(false);
  const ownedDevice = useRef<EmbeddedWalletClient | null>(null);
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
      const connected =
        event.phase === 'peer:connect' ||
        (event.phase === 'primary-redial' && event.message === 'reconnected');
      if (!connected) return;
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
  /** Held by any action that opens a wallet, so two opens cannot race. */
  const connectInFlight = useRef(false);
  const selectionInFlight = useRef(false);
  const invalidateSession = useCallback(() => {
    generation.current += 1;
  }, []);

  /**
   * Put the last state this wallet was seen in on the page while its engine
   * starts. A live snapshot that lands first is never replaced by the cache.
   */
  const hydrate = useCallback(async (id: string, current: number) => {
    const cached = await loadCachedSnapshot(id);
    if (cached && generation.current === current)
      setSnapshot(previous => previous ?? cached);
  }, []);

  const refresh = useCallback(async () => {
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
      const next = await client.snapshot();
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
            }, primary ${next.primary.connected ? 'connected' : 'not connected'}`,
          });
        setSnapshot(next);
        setError('');
        saveCachedSnapshot(walletId, next);
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
  }, [client, walletId]);
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
   * The same work the manual refresh does, run by the app on its own behalf.
   *
   * Latched, because a recovery that is slow to answer must not have another
   * stacked on top of it every twelve seconds.
   */
  const recovering = useRef(false);
  const recover = useCallback(async () => {
    if (recovering.current) return;
    recovering.current = true;
    try {
      await manualRefresh();
    } finally {
      recovering.current = false;
    }
  }, [manualRefresh]);

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
     */
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      const current = snapshotRef.current;
      if (current && Date.now() - current.updatedAt > STALE_AFTER_MS)
        recover().catch(() => {});
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
      if (!client || selectionInFlight.current || closingInFlight.current) {
        return;
      }
      selectionInFlight.current = true;
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
        runtimeStarting.current = true;
        setWalletId(wallet.id);
        setSnapshot(null);
        setError('');
        onCloseSheet();
        onTab('Wallet');
        setWallets(previous =>
          previous.some(existing => existing.id === wallet.id)
            ? previous
            : [...previous, wallet],
        );
        await hydrate(wallet.id, current);
        try {
          if (wallet.status !== 'running') await client.startWallet();
          const value = await client.snapshot();
          if (generation.current === current) {
            setSnapshot(value);
            setError('');
            saveCachedSnapshot(wallet.id, value);
          }
        } catch (e) {
          if (generation.current === current) setError(errorMessage(e));
        } finally {
          runtimeStarting.current = false;
        }
      } catch (e) {
        if (generation.current === current) setError(errorMessage(e));
        throw e;
      } finally {
        selectionInFlight.current = false;
        setSelecting(false);
      }
    },
    [client, rememberedSession, onCloseSheet, onTab, hydrate],
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
         * single action: if this minted its own token, the caller's own checks
         * would compare against a generation this call had already moved past,
         * and would quietly skip the rollback a failed switch depends on.
         */
        generation?: number;
      },
    ) => {
      if (connectInFlight.current || closingInFlight.current) return;
      connectInFlight.current = true;
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
          const previous = detachedDevice;
          await previous.close();
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
        runtimeStarting.current = !!selected;
        setActiveProfile(settings);
        setClient(next);
        setWallets(records);
        setWalletId(selected?.id || '');
        setSnapshot(null);
        if (creationError) setError(creationError);
        onTab(options?.returnTo || 'Wallet');
        setDeviceVisible(false);
        setNetworkEditor(false);
        committed = true;
        ownedDevice.current = next;
        setInitializing(false);
        options?.onCommitted?.();
        if (selected) {
          // The wallet page opens now, on the last state this wallet was seen
          // in, and the live figures replace it when the engine is up.
          await hydrate(selected.id, current);
          try {
            await next.startWallet();
            const value = await next.snapshot();
            if (generation.current === current) {
              setSnapshot(value);
              setError('');
              saveCachedSnapshot(selected.id, value);
            }
          } catch (e) {
            if (generation.current === current) setError(errorMessage(e));
          } finally {
            runtimeStarting.current = false;
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
        connectInFlight.current = false;
        if (generation.current === current) setConnecting(false);
      }
    },
    [onTab, hydrate, onDeviceDiagnostic],
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
      if (
        selectionInFlight.current ||
        connectInFlight.current ||
        switching ||
        closingInFlight.current
      )
        return;
      const previousProfile = activeProfile;
      const target = returnTo ?? tabRef.current;
      setSwitching(true);
      setSwitchTarget(profile.network);
      setSwitchError('');
      selectionInFlight.current = true;
      const current = ++generation.current;
      try {
        if (client instanceof EmbeddedWalletClient) {
          const previous = client;
          // Given up before the await, so the unmount cleanup cannot start a
          // second close on the same client while this one is running.
          ownedDevice.current = null;
          await previous.close();
        }
        if (generation.current !== current) return;
        setClient(null);
        setWalletId('');
        setWallets([]);
        setSnapshot(null);
        onCloseSheet();
        setError('');
        setActiveProfile(profile);
        // The open holds its own latch, and it is where the rest of the wait
        // lives; holding this one across it would make the open look like a
        // second switch to every guard that checks it.
        selectionInFlight.current = false;
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
        // local wallet". Dropping it is the only honest option.
        setClient(null);
        if (generation.current === current) {
          setActiveProfile(previousProfile);
          setError('');
          setSwitchError(errorMessage(e));
        }
        throw e;
      } finally {
        selectionInFlight.current = false;
        setSwitching(false);
        setSwitchTarget(null);
      }
    },
    [client, switching, activeProfile, openDevice, onCloseSheet],
  );

  const disconnect = useCallback(async () => {
    if (
      selectionInFlight.current ||
      connectInFlight.current ||
      closingInFlight.current
    )
      return;
    closingInFlight.current = true;
    setClosing(true);
    const current = ++generation.current;
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
        await client.close();
        ownedDevice.current = null;
        setRememberedSession(session);
        setDeviceHint(!session.prepared);
      }
      if (generation.current !== current) return;
      setClient(null);
      setWalletId('');
      setWallets([]);
      setSnapshot(null);
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
  ]);

  /**
   * Remove the device wallet from this phone so a new one can be created or
   * an existing one restored from its phrase. The engine is closed first, the
   * session is marked locked so a half-finished erase cannot be reopened as if
   * nothing happened, and only a complete erase forgets the wallet.
   */
  const eraseDevice = useCallback(async () => {
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
    try {
      await saveWalletSession({
        mode: 'device',
        network: activeProfile.network,
        locked: true,
      });
      await client.close();
      ownedDevice.current = null;
      setClient(null);
      setWalletId('');
      setWallets([]);
      setSnapshot(null);
      onCloseSheet();
      const [{ eraseDeviceStorage }, { clearSeedSource }] = await Promise.all([
        import('../embedded/storage'),
        import('../embedded/seed'),
      ]);
      await eraseDeviceStorage();
      await clearSeedSource();
      await clearCachedSnapshot();
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
  }, [client, activeProfile, onCloseSheet]);

  const chooseWallet = useCallback(() => {
    if (
      closingInFlight.current ||
      selectionInFlight.current ||
      connectInFlight.current
    )
      return;
    ++generation.current;
    setWalletId('');
    setSnapshot(null);
    onCloseSheet();
    setError('');
  }, [onCloseSheet]);

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
    chooseWallet,
    acknowledgeBackup,
  };
}
