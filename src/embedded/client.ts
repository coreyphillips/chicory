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
  return new (globalThis as unknown as {
    TextDecoder: new () => { decode(input: Uint8Array): string };
  }).TextDecoder();
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

/** The host of a `pubkey@host:port` node URI, or an empty string. */
function uriHost(uri: unknown): string {
  if (typeof uri !== 'string') return '';
  const at = uri.indexOf('@');
  if (at < 0) return '';
  const hostPort = uri.slice(at + 1);
  const colon = hostPort.lastIndexOf(':');
  return (colon > 0 ? hostPort.slice(0, colon) : hostPort).trim();
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
  ] = await Promise.all([
    import('@beignet/portable-engine'),
    import('./storage'),
    import('./network'),
  ]);
  const preferences = await loadDevicePreferences();
  const storage = await openEncryptedDeviceStorage(
    storageNamespace(settings.network, preferences.legacyNetwork),
    options?.existingOnly ?? false,
    options?.allowEmpty ?? false,
  );
  let engine:
    | Awaited<
        ReturnType<
          typeof import('@beignet/portable-engine').createPortableRuntime
        >
      >
    | undefined;
  let committed = false;
  try {
    const registryBytes = storage.volume.read('/wallet/registry.json');
    let storedPrimaryHost = '';
    if (registryBytes) {
      try {
        const record = JSON.parse(decoder().decode(registryBytes)).record;
        assertWalletNetwork([record], settings.network);
        storedPrimaryHost = uriHost(record?.lfbw?.primaryUri);
      } finally {
        registryBytes.fill(0);
      }
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
    // The primary is usually an onion service. Tor used to start only when
    // the engine first dialled it, which comes after the database opens and
    // the chain syncs, so a cold bootstrap sat on the critical path to the
    // first live balance. Warm it now, alongside the engine's own start; the
    // dial awaits the same promise and a bootstrap failure is reported there.
    if (
      settings.transport === 'native' &&
      (isOnionHost(storedPrimaryHost) || isOnionHost(uriHost(settings.primaryUri)))
    ) {
      void ensureTorReady().catch(() => {});
    }
    engine = await createPortableRuntime({
      ...storage,
      socketFactory,
      electrum: settings.electrum,
      onDiagnostic,
    });
    const runtime = withDeviceSeedSource(
      engine,
      storage,
      storageNamespace(settings.network, preferences.legacyNetwork),
    );
    const client = new EmbeddedWalletClient({
      runtime: {
        request: request => {
          if (
            (request.path === '/api/wallets' ||
              request.path === '/api/wallets/import') &&
            request.method === 'POST'
          ) {
            const body = request.body as { network?: string } | undefined;
            if (body?.network !== settings.network)
              return Promise.reject(
                new Error(
                  'Create this wallet on the selected network. Switch networks in Settings first.',
                ),
              );
          }
          return runtime.request(request);
        },
        // Every stage runs, whatever the one before it did. Releasing the
        // storage lease is not optional: an engine that fails to stop used to
        // take the vault with it, and every later open, every network switch
        // included, then answered "The device wallet is already open" until
        // the app was killed. The first failure is still reported.
        close: async () => {
          const failures: unknown[] = [];
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
    committed = true;
    return client;
  } finally {
    // This call owns both the storage lease and the engine's one-per-realm
    // claim. Neither may outlive a failure: an orphaned realm makes every
    // later runtime throw, for the life of the process.
    if (!committed) {
      if (engine) await engine.close().catch(() => {});
      try {
        storage.close();
      } catch {
        // Already closed, or closing is what failed. The throw stands.
      }
    }
  }
}
