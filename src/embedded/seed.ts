import * as Keychain from 'react-native-keychain';
import type { PortableRuntime } from '@beignet/portable-engine';
import type { Network } from '@beignet/wallet-core';
import type { StorageNamespace } from './storage';
import { isNetwork } from '../services/networks';

const { TextDecoder } = require('text-encoding');
const SERVICE = 'com.beignet.wallet.device-seed-source';
const REGISTRY = '/wallet/registry.json';

interface SeedSource {
  version: 1;
  namespace: StorageNamespace;
  network: Network;
  walletId: string;
  createdAt: number;
}
export interface DeviceSeedStorage {
  volume: { read(path: string): Uint8Array | null };
  existingRegistryNamespaces(): Promise<StorageNamespace[]>;
  readRegistry(namespace: StorageNamespace): Promise<Uint8Array | null>;
}

function validReference(value: SeedSource): boolean {
  return !!(
    value &&
    value.version === 1 &&
    (value.namespace === 'legacy' || isNetwork(value.namespace)) &&
    isNetwork(value.network) &&
    (value.namespace === 'legacy' || value.namespace === value.network) &&
    typeof value.walletId === 'string' &&
    value.walletId &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0
  );
}
function readRegistry(bytes: Uint8Array | null, namespace: StorageNamespace) {
  if (!bytes) return null;
  try {
    const registry = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    const reference: SeedSource = {
      version: 1,
      namespace,
      network: registry?.record?.network,
      walletId: registry?.record?.id,
      createdAt: registry?.record?.createdAt,
    };
    if (
      !validReference(reference) ||
      typeof registry.mnemonic !== 'string' ||
      registry.mnemonic.trim().split(/\s+/).length < 12
    )
      throw new Error('Invalid registry');
    return { reference, mnemonic: registry.mnemonic as string };
  } catch {
    throw new Error(
      'The original device wallet record is invalid. No new recovery phrase was generated.',
    );
  } finally {
    bytes.fill(0);
  }
}
async function loadSource(): Promise<SeedSource | null> {
  const saved = await Keychain.getGenericPassword({ service: SERVICE });
  if (!saved) return null;
  try {
    const value = JSON.parse(saved.password) as SeedSource;
    if (!validReference(value)) throw new Error('Invalid reference');
    return value;
  } catch {
    throw new Error(
      'The original device wallet reference is invalid. Existing wallets were preserved.',
    );
  }
}
async function saveSource(value: SeedSource) {
  if (!validReference(value))
    throw new Error('The original wallet identity is unavailable.');
  const saved = await Keychain.setGenericPassword(
    'beignet-device-seed-source',
    JSON.stringify(value),
    {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (!saved)
    throw new Error(
      'Could not save the original wallet reference securely. Reopen the device wallet before creating another network wallet.',
    );
}

/** Only the original local wallet's identity is saved here. Its phrase stays in encrypted storage. */
async function sourceReference(
  storage: DeviceSeedStorage,
): Promise<SeedSource | null> {
  const known = await loadSource();
  if (known) return known;
  const candidates: SeedSource[] = [];
  for (const namespace of await storage.existingRegistryNamespaces()) {
    const value = readRegistry(
      await storage.readRegistry(namespace),
      namespace,
    );
    if (value) {
      candidates.push(value.reference);
      value.mnemonic = '';
    }
  }
  candidates.sort(
    (a, b) =>
      a.createdAt - b.createdAt || a.namespace.localeCompare(b.namespace),
  );
  const original = candidates[0] || null;
  if (original) await saveSource(original);
  return original;
}

/** Seed reuse is confined to native creation; neither the UI nor host requests provide a source. */
/**
 * Which existing wallet supplies the recovery phrase for wallets created on
 * other networks, when one has been recorded. Reads only the Keychain
 * reference: no vault is opened and no phrase is touched.
 */
/** Forget which wallet supplies the phrase, as part of erasing the device. */
export async function clearSeedSource(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => {});
}

export async function seedSourceNetwork(): Promise<Network | null> {
  try {
    const source = await loadSource();
    return source ? source.network : null;
  } catch {
    return null;
  }
}

export function withDeviceSeedSource(
  runtime: PortableRuntime,
  storage: DeviceSeedStorage,
  namespace: StorageNamespace,
): PortableRuntime {
  let closed = false;
  let creating: Promise<unknown> | null = null;
  function assertOpen() {
    if (closed)
      throw new Error('The device wallet is closing. Reopen it to continue.');
  }
  async function create(request: Parameters<PortableRuntime['request']>[0]) {
    // The engine rejects duplicate creation. Never read or apply another wallet's seed to an existing slot.
    const target = readRegistry(storage.volume.read(REGISTRY), namespace);
    if (target) {
      target.mnemonic = '';
      return runtime.request(request);
    }
    // A phrase the owner typed is the wallet they asked for. The recorded
    // source only fills in when nothing was supplied.
    const supplied =
      typeof request.body?.mnemonic === 'string' &&
      request.body.mnemonic.trim().length > 0;
    const existingSource = await sourceReference(storage);
    const source = supplied ? null : existingSource;
    assertOpen();
    let sourceMnemonic = '';
    if (source) {
      const original = readRegistry(
        await storage.readRegistry(source.namespace),
        source.namespace,
      );
      if (
        !original ||
        original.reference.walletId !== source.walletId ||
        original.reference.network !== source.network ||
        original.reference.createdAt !== source.createdAt
      )
        throw new Error(
          'The original device wallet is unavailable or has changed. No replacement recovery phrase was generated.',
        );
      sourceMnemonic = original.mnemonic;
      original.mnemonic = '';
    }
    const body = {
      ...request.body,
      ...(source ? { mnemonic: sourceMnemonic } : {}),
    };
    try {
      assertOpen();
      const result = await runtime.request({ ...request, body });
      if (!existingSource) {
        const created = readRegistry(storage.volume.read(REGISTRY), namespace);
        if (!created)
          throw new Error(
            'The created wallet record is unavailable. Reopen this wallet before continuing.',
          );
        created.mnemonic = '';
        try {
          await saveSource(created.reference);
        } catch {
          // The wallet itself is already committed. Keep its backup flow available;
          // subsequent network creation safely rediscovers the original registry.
          return {
            ...result,
            warnings: [
              ...(Array.isArray(result?.warnings) ? result.warnings : []),
              'Your wallet is saved, but its reference for other networks could not be saved. Keep this wallet on the device and save its recovery phrase.',
            ],
          };
        }
      }
      return result;
    } finally {
      sourceMnemonic = '';
      delete body.mnemonic;
    }
  }
  return {
    request(request) {
      assertOpen();
      if (
        request.method !== 'POST' ||
        !['/api/wallets', '/api/wallets/import'].includes(request.path)
      )
        return runtime.request(request);
      if (creating)
        return Promise.reject(
          new Error('A device wallet is already being created.'),
        );
      creating = create(request).finally(() => {
        creating = null;
      });
      return creating;
    },
    async close() {
      closed = true;
      // Finish or cancel seed lookup before the owner releases the native storage lease.
      await creating?.catch(() => {});
      await runtime.close();
    },
  };
}
