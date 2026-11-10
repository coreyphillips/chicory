import { AppState, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import { installNativeCrypto } from './random';
import type { Network } from '@beignet/wallet-core';
import {
  loadNetworkPreferences,
  saveNetworkPreferences,
  isNetwork,
  storageNamespace,
  assertWalletNetwork,
  validateProfile,
} from '../services/networks';
import type { NetworkProfile, NetworkPreferences } from '../services/networks';
import { withDeviceSeedSource } from './seed';
import { ensureTorReady, isOnionHost } from '../services/tor';
import { markBoot } from '../services/perf';

export type DeviceSettings = NetworkProfile;
const LEGACY_SERVICE = 'com.beignet.wallet.embedded.settings';

/**
 * A hung engine must not keep the vault. This clears the engine's own stop
 * deadline and its in-flight drain with room to spare; past it the storage
 * lease is released regardless, because holding it strands every later open.
 */
const CLOSE_DEADLINE_MS = 20000;

function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * `text-encoding` carries half a megabyte of literal index tables. Reading the
 * decoder through the global keeps that off the cold start path: this module is
 * imported before the first render, and `installNativeCrypto` installs the
 * polyfill on `globalThis` before either call site below runs.
 */
function decoder(): { decode(input: Uint8Array): string } {
  return new (
    globalThis as unknown as {
      TextDecoder: new () => { decode(input: Uint8Array): string };
    }
  ).TextDecoder();
}

/** Map the original unnamespaced vault to its actual chain once, without copying state. */
export async function loadDevicePreferences(): Promise<NetworkPreferences> {
  const preferences = await loadNetworkPreferences();
  if (preferences.legacyNetwork !== undefined) return preferences;
  installNativeCrypto();
  const { hasLegacyDeviceKey, openEncryptedDeviceStorage } = await import(
    './storage'
  );
  let legacyNetwork: Network | null = null;
  if (await hasLegacyDeviceKey()) {
    const storage = await openEncryptedDeviceStorage('legacy', true, true);
    try {
      const bytes = storage.volume.read('/wallet/registry.json');
      if (bytes) {
        try {
          const registry = JSON.parse(decoder().decode(bytes));
          if (!isNetwork(registry?.record?.network))
            throw new Error(
              'The existing device wallet has an unsupported network.',
            );
          legacyNetwork = registry.record.network;
          preferences.profiles[legacyNetwork!].primaryUri =
            registry.record.lfbw?.primaryUri ||
            preferences.profiles[legacyNetwork!].primaryUri;
        } finally {
          bytes.fill(0);
        }
      }
    } finally {
      storage.close();
    }
  }
  preferences.legacyNetwork = legacyNetwork;
  if (legacyNetwork) {
    const old = await Keychain.getGenericPassword({ service: LEGACY_SERVICE });
    if (old) {
      const settings = JSON.parse(old.password);
      preferences.profiles[legacyNetwork] = {
        ...preferences.profiles[legacyNetwork],
        ...settings,
        network: legacyNetwork,
      };
    }
    preferences.selectedNetwork = legacyNetwork;
  }
  await saveNetworkPreferences(preferences);
  return preferences;
}
export async function loadDeviceSettings(): Promise<DeviceSettings> {
  const preferences = await loadDevicePreferences();
  return preferences.profiles[preferences.selectedNetwork];
}
export function validateDeviceSettings(value: DeviceSettings) {
  validateProfile(value, true);
  if (
    !value.electrum?.host?.trim() ||
    !Number.isInteger(value.electrum.port) ||
    value.electrum.port < 1 ||
    value.electrum.port > 65535
  ) {
    throw new Error('Enter an Electrum server and a valid port.');
  }
  if (value.transport !== 'native' && value.transport !== 'relay')
    throw new Error('Choose a connection method.');
  if (isOnionHost(value.electrum.host) && value.electrum.tls)
    throw new Error(
      'An onion Electrum server connects through Tor without TLS. Turn off TLS for this server.',
    );
  if (value.transport === 'relay') {
    const url = new URL(value.relayUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(
      url.hostname,
    );
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'wss:' &&
        !(url.protocol === 'ws:' && loopback && __DEV__))
    ) {
      throw new Error(
        'Use a WSS relay address without credentials or query parameters.',
      );
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value.relayToken))
      throw new Error('Enter the relay’s private connection token.');
  }
}

/** A pre-ranking wallet stores its single primary and fallback directly. */
function primaryHosts(lfbw: unknown) {
  const block = lfbw as
    | {
        primaries?: Array<{ uri?: unknown; fallbackUri?: unknown }>;
        primaryUri?: unknown;
        primaryFallbackUri?: unknown;
      }
    | undefined;
  const entries =
    Array.isArray(block?.primaries) && block.primaries.length
      ? block.primaries
      : [{ uri: block?.primaryUri, fallbackUri: block?.primaryFallbackUri }];
  return entries
    .map(entry => ({
      host: uriHost(entry.uri),
      fallback: uriHost(entry.fallbackUri),
    }))
    .filter(entry => entry.host || entry.fallback);
}

/** The host of a `pubkey@host:port` node URI, or an empty string. */
function uriHost(uri: unknown): string {
  if (typeof uri !== 'string') return '';
  const at = uri.indexOf('@');
  if (at < 0) return '';
  const hostPort = uri.slice(at + 1);
  if (/^iroh:/i.test(hostPort)) return 'iroh';
  const colon = hostPort.lastIndexOf(':');
  return (colon > 0 ? hostPort.slice(0, colon) : hostPort).trim();
}

/**
 * Requests that start the engine, which dials the primary once it has synced:
 * create, import, start and the setup retry.
 */
const STARTS_ENGINE =
  /^\/api\/wallets(?:\/import|\/[^/]+\/(?:start|lfbw\/retry|lfbw\/setup))?$/;

/**
 * The request that ranks another primary node (coreyphillips/beignet#1924).
 * The engine dials the new node at once, under the same fixed budget as a
 * start's dial.
 */
const ADDS_PRIMARY = /^\/wallets\/[^/]+\/api\/primaries\/add$/;

/** The host an add names: a clearnet or onion `host`, else the host of its `uri`. */
function addedHost(body: unknown): string {
  const named = body as { host?: unknown; uri?: unknown } | undefined;
  if (typeof named?.host === 'string') return named.host.trim();
  return uriHost(named?.uri);
}

/** Open a real in-process Beignet node. No host API or wallet secrets cross the transport. */
export async function openDeviceWallet(
  settings: DeviceSettings,
  onDiagnostic?: (event: {
    phase: string;
    message: string;
    stack?: string;
  }) => void,
  options?: { existingOnly?: boolean; allowEmpty?: boolean },
) {
  validateDeviceSettings(settings);
  installNativeCrypto();
  // Keep engine evaluation after the native CSPRNG is installed. Loading native
  // storage here also lets host-only users open the app without touching a vault.
  const [
    { createPortableRuntime, createRelaySocketFactory },
    { openEncryptedDeviceStorage },
    { nativeSocketFactory },
    { createNativeIrohEndpoint },
  ] = await Promise.all([
    import('@beignet/portable-engine'),
    import('./storage'),
    import('./network'),
    import('./iroh'),
  ]);
  // Steps of the boot report (services/perf): the engine's code evaluated,
  // which on Hermes is a cost of its own, then the vault open, then the
  // runtime made.
  markBoot('engine-loaded');
  const preferences = await loadDevicePreferences();
  const storage = await openEncryptedDeviceStorage(
    storageNamespace(settings.network, preferences.legacyNetwork),
    options?.existingOnly ?? false,
    options?.allowEmpty ?? false,
  );
  markBoot('vault-opened');
  let engine:
    | Awaited<
        ReturnType<
          typeof import('@beignet/portable-engine').createPortableRuntime
        >
      >
    | undefined;
  let lifecycle: ReturnType<typeof AppState.addEventListener> | undefined;
  let committed = false;
  try {
    const registryBytes = storage.volume.read('/wallet/registry.json');
    let primaries: ReturnType<typeof primaryHosts> = [];
    if (registryBytes) {
      try {
        const record = JSON.parse(decoder().decode(registryBytes)).record;
        assertWalletNetwork([record], settings.network);
        primaries = primaryHosts(record?.lfbw);
      } finally {
        registryBytes.fill(0);
      }
    }
    const profileHost = uriHost(settings.primaryUri);
    if (!primaries.length) primaries = [{ host: profileHost, fallback: '' }];
    if (
      settings.transport === 'relay' &&
      (primaries.some(p => p.host === 'iroh' || p.fallback === 'iroh') ||
        profileHost === 'iroh')
    ) {
      throw new Error(
        'Iroh requires Native networking. Select Native in Network settings before opening this wallet.',
      );
    }
    preferences.profiles[settings.network] = settings;
    preferences.selectedNetwork = settings.network;
    await saveNetworkPreferences(preferences);

    const socketFactory =
      settings.transport === 'relay'
        ? createRelaySocketFactory({
            electrumUrl: `${settings.relayUrl.replace(/\/$/, '')}/electrum`,
            peerUrl: `${settings.relayUrl.replace(/\/$/, '')}/peer`,
            token: settings.relayToken,
            electrum: settings.electrum,
            WebSocket,
          })
        : nativeSocketFactory;
    // Opening the wallet verifies the chain against Electrum under a short
    // fixed deadline. A cold Tor start does not fit inside it, so an onion
    // Electrum server waits for Tor here and fails with a Tor error rather
    // than an unexplained unverified network.
    if (
      settings.transport === 'native' &&
      isOnionHost(settings.electrum.host)
    ) {
      await ensureTorReady();
    }
    // The primary is usually an onion service. Start Tor as early as the
    // vault says it is needed, so the bootstrap overlaps the engine's load
    // and whatever else the app does before the start. An Iroh primary with
    // an onion fallback warms it too, but its start does not wait.
    if (
      settings.transport === 'native' &&
      primaries.some(p => isOnionHost(p.host) || isOnionHost(p.fallback))
    ) {
      void ensureTorReady().catch(() => {});
    }
    // A wallet with only onion primaries waits for Tor before start, including
    // its restored-channel dials. A mixed list can start over its direct peers.
    const needsTorBeforeStart = (requested: unknown) => {
      const host = uriHost(requested);
      return (
        settings.transport === 'native' &&
        (host
          ? isOnionHost(host)
          : primaries.every(primary => isOnionHost(primary.host)))
      );
    };
    let closing = false;
    engine = await createPortableRuntime({
      ...storage,
      socketFactory,
      ...(settings.transport === 'native'
        ? {
            iroh: { factory: createNativeIrohEndpoint, discovery: false },
            // Give each onion primary its full dial budget after bootstrap.
            // The dial reports a Tor failure through the native socket.
            preparePrimaryDial: async (host: string) => {
              if (isOnionHost(host)) await ensureTorReady().catch(() => {});
            },
          }
        : {}),
      electrum: settings.electrum,
      onDiagnostic,
    });
    markBoot('runtime-created');
    const runtime = withDeviceSeedSource(
      engine,
      storage,
      storageNamespace(settings.network, preferences.legacyNetwork),
    );
    const client = new EmbeddedWalletClient({
      runtime: {
        request: async request => {
          if (
            (request.path === '/api/wallets' ||
              request.path === '/api/wallets/import') &&
            request.method === 'POST'
          ) {
            const body = request.body as { network?: string } | undefined;
            if (body?.network !== settings.network)
              throw new Error(
                'Create this wallet on the selected network. Switch networks in Settings first.',
              );
          }
          if (request.method === 'POST' && STARTS_ENGINE.test(request.path)) {
            const body = request.body as
              | {
                  lfbw?: { primaryUri?: unknown };
                  primaryNodeUri?: unknown;
                  lfbwPrimaryNode?: unknown;
                }
              | undefined;
            const requested =
              body?.lfbw?.primaryUri ??
              body?.primaryNodeUri ??
              body?.lfbwPrimaryNode;
            if (needsTorBeforeStart(requested)) {
              await ensureTorReady().catch(() => {});
              // A close during the wait has already stopped the engine.
              if (closing)
                throw new Error('The wallet closed before it started.');
            }
          }
          // Adding a primary dials it at once, inside the engine's 15 second
          // budget. An onion node waits for Tor first, as a start does, so a
          // cold bootstrap does not fail the dial and leave the node marked
          // failed until a redial; an Iroh node's onion fallback warms Tor
          // without waiting, as it does at open.
          if (
            request.method === 'POST' &&
            settings.transport === 'native' &&
            ADDS_PRIMARY.test(request.path)
          ) {
            const body = request.body as { fallbackUri?: unknown } | undefined;
            if (isOnionHost(addedHost(body))) {
              await ensureTorReady().catch(() => {});
              if (closing)
                throw new Error('The wallet closed before the node was added.');
            } else if (isOnionHost(uriHost(body?.fallbackUri))) {
              void ensureTorReady().catch(() => {});
            }
          }
          return runtime.request(request);
        },
        // Every stage runs, whatever the one before it did. Releasing the
        // storage lease is not optional: an engine that fails to stop used to
        // take the vault with it, and every later open, every network switch
        // included, then answered "The device wallet is already open" until
        // the app was killed. The first failure is still reported.
        close: async () => {
          closing = true;
          const failures: unknown[] = [];
          try {
            lifecycle?.remove();
          } catch (error) {
            failures.push(error);
          }
          try {
            await withDeadline(
              runtime.close(),
              CLOSE_DEADLINE_MS,
              'The wallet engine did not finish closing. Its storage was released.',
            );
          } catch (error) {
            failures.push(error);
          }
          try {
            storage.close();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length) throw failures[0];
        },
      },
    });
    if (Platform.OS === 'android') {
      const onAppState = (state: typeof AppState.currentState) => {
        if (state === 'active' || state === 'background') {
          runtime.setAppBackgrounded(state === 'background');
        }
      };
      lifecycle = AppState.addEventListener('change', onAppState);
      onAppState(AppState.currentState);
    }
    committed = true;
    return client;
  } finally {
    // This call owns both the storage lease and the engine's one-per-realm
    // claim. Neither may outlive a failure: an orphaned realm makes every
    // later runtime throw, for the life of the process.
    if (!committed) {
      try {
        lifecycle?.remove();
      } catch {
        // The engine and its storage still need to close.
      }
      if (engine) await engine.close().catch(() => {});
      try {
        storage.close();
      } catch {
        // Already closed, or closing is what failed. The throw stands.
      }
    }
  }
}
