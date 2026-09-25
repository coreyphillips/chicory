/**
 * An in-process Tor client for onion endpoints. It stays stopped until a
 * connection actually needs it, because bootstrapping costs time and battery
 * and a clearnet wallet never touches the network through it.
 *
 * The daemon only dials out. This wallet publishes no service and accepts no
 * inbound connection over Tor.
 */
import { Platform } from 'react-native';

type NativeTor = typeof import('react-native-nitro-tor').RnTor;

/**
 * Loaded on demand. A wallet that never dials an onion address does not touch
 * the Tor native module at all.
 */
function nativeTor(): NativeTor {
  const module = require('react-native-nitro-tor');
  if (!module?.RnTor) {
    throw new Error('This build does not include Tor support.');
  }
  return module.RnTor;
}

export const TOR_SOCKS_HOST = '127.0.0.1';
export const TOR_SOCKS_PORT = 9050;

/** Bootstrapping a cold Tor client over a mobile link is slow but bounded. */
const BOOTSTRAP_TIMEOUT_MS = 120000;
/**
 * The library's start call always publishes a hidden service, so it needs a
 * local target. Nothing listens here; the service is removed on the next line.
 */
const UNUSED_TARGET_PORT = 9051;
/** `getServiceStatus`: 0 bootstrapping, 1 usable, 2 no daemon. */
const STATUS_STARTING = 0;
const STATUS_RUNNING = 1;
/** How often a caller looks again at a daemon that is still bootstrapping. */
const STATUS_POLL_MS = 1000;
/** It names Tor, so the wallet reports the private network as unavailable. */
const TOR_GONE =
  'Tor is not running and cannot start again until the app is reopened.';

export type TorPhase = 'stopped' | 'starting' | 'ready' | 'failed';

let phase: TorPhase = 'stopped';
let started: Promise<void> | null = null;
let failure = '';
/**
 * Whether this process has asked the library to run Tor. Tor runs at most once
 * per process. A failed bootstrap leaves no daemon behind (the library reports
 * 2, as it does before any start), and asking again runs Tor's main a second
 * time, which aborts the whole app from native code:
 *
 *   tor_run_main -> pubsub_install -> tor_abort_ (SIGABRT)
 *
 * So after the first start, callers only ever wait on that daemon.
 */
let launched = false;

export function isOnionHost(host: string): boolean {
  return (
    typeof host === 'string' && host.trim().toLowerCase().endsWith('.onion')
  );
}

export function torPhase(): TorPhase {
  return phase;
}

export function torFailure(): string {
  return failure;
}

/**
 * Tor keeps its consensus cache and state here. Both paths are app-private and
 * are not written by anything else; Tor creates the directory itself with the
 * restrictive permissions it insists on.
 */
export function torDataDirectory(): string {
  // Required here rather than at module scope so that importing this file
  // stays free of native lookups for a wallet that never uses Tor.
  const { IOS_LIBRARY_PATH, ANDROID_FILES_PATH } =
    require('@op-engineering/op-sqlite') as Record<string, string>;
  const root = Platform.OS === 'ios' ? IOS_LIBRARY_PATH : ANDROID_FILES_PATH;
  if (typeof root !== 'string' || !root) {
    throw new Error('This device did not provide a private folder for Tor.');
  }
  return `${root.replace(/\/+$/, '')}/tor`;
}

/**
 * The start call publishes an onion service whether or not one is wanted. Drop
 * it immediately: an unpublished descriptor for a port nothing listens on is
 * useless to callers and needless exposure for this wallet.
 */
async function removePublishedService(address: string) {
  const service = address.split(':')[0].replace(/\.onion$/i, '');
  if (!service) return;
  for (const value of [service, `${service}.onion`]) {
    try {
      if (await nativeTor().deleteHiddenService(value)) return;
    } catch {
      // Best effort. A service that outlives this call reaches nothing.
    }
  }
}

/**
 * Whether the daemon this process launched serves its proxy. One that is still
 * bootstrapping is waited on for as long as a start would have waited.
 */
async function daemonRunning(tor: NativeTor): Promise<boolean> {
  const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS;
  let status = await tor.getServiceStatus();
  while (status === STATUS_STARTING && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, STATUS_POLL_MS));
    status = await tor.getServiceStatus();
  }
  return status === STATUS_RUNNING;
}

async function startTor(): Promise<void> {
  const tor = nativeTor();
  const params = {
    data_dir: torDataDirectory(),
    socks_port: TOR_SOCKS_PORT,
    target_port: UNUSED_TARGET_PORT,
    timeout_ms: BOOTSTRAP_TIMEOUT_MS,
  };
  launched = true;
  const result = await tor.startTorIfNotRunning(params);
  if (result.is_success) {
    await removePublishedService(result.onion_address);
  }
  // A failed reply can still mean a bootstrapped daemon, because the library
  // reports the state of its unwanted onion service. The proxy is what matters.
  if (!(await daemonRunning(tor))) {
    throw new Error(result.error_message?.trim() || TOR_GONE);
  }
}

/** Use the daemon an earlier start launched. This never starts another. */
async function rejoinTor(): Promise<void> {
  if (!(await daemonRunning(nativeTor()))) {
    throw new Error(TOR_GONE);
  }
}

/**
 * Start Tor once and reuse it. After a failure the next connection asks
 * whether that one daemon came up after all; it never starts a second one, so
 * a daemon that is gone stays gone until the app restarts.
 */
export function ensureTorReady(): Promise<void> {
  if (!started) {
    phase = 'starting';
    failure = '';
    started = (launched ? rejoinTor() : startTor()).then(
      () => {
        phase = 'ready';
      },
      error => {
        phase = 'failed';
        failure = error instanceof Error ? error.message : String(error);
        started = null;
        throw error;
      },
    );
  }
  return started;
}

/**
 * Stop the daemon.
 *
 * Nothing in the app calls this, and that is deliberate. The library's
 * `shutdownService` aborts the process from native code when a worker thread is
 * still parked on a condition variable it then destroys, which a JS `catch`
 * cannot intercept:
 *
 *   FORTIFY: pthread_mutex_lock called on a destroyed mutex
 *   Fatal signal 6 (SIGABRT) in tid <mqt_v_js>   libcxx-react-native-nitro-tor.so
 *
 * The daemon is also a process-wide singleton whose proxy is the same whatever
 * network the wallet is on, so stopping it when a wallet closes only bought a
 * second cold bootstrap on the way back in. It now lives as long as the app
 * does. This stays exported for a caller that genuinely owns the process.
 * Tor cannot start again in the same process afterwards (see `launched`).
 */
export async function stopTor(): Promise<void> {
  const pending = started;
  started = null;
  if (phase === 'stopped') return;
  phase = 'stopped';
  failure = '';
  if (pending) {
    // Shutting down mid-bootstrap races the daemon's own startup.
    await pending.catch(() => {});
  }
  try {
    await nativeTor().shutdownService();
  } catch {
    // The daemon is already gone, or never came up.
  }
}
