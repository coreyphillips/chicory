import { open, isSQLCipher } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';
import { NativeSqliteDatabase } from './sqlite';
import { secureRandomBytes } from './random';
import type { Network } from '@beignet/wallet-core';
export type StorageNamespace = Network | 'legacy';
export const databaseKeyService = (namespace: StorageNamespace) =>
  namespace === 'legacy' ? KEY_SERVICE : `${KEY_SERVICE}.${namespace}`;

const KEY_SERVICE = 'com.beignet.wallet.embedded.database-key';
const activeDatabases = new Set<string>();
let opening = false;

export interface EncryptedVolume {
  read(path: string): Uint8Array | null;
  write(path: string, data: Uint8Array): void;
  remove(path: string): void;
  rename(from: string, to: string): void;
  list(prefix?: string): string[];
}
export function safeDatabaseName(
  path: string,
  namespace: StorageNamespace = 'legacy',
): string {
  if (!path || path === ':memory:' || path.includes('\0')) {
    throw new Error('An embedded wallet requires a persistent database path.');
  }
  const name = `engine-${
    namespace === 'legacy' ? '' : `${namespace}-`
  }${encodeURIComponent(path)}.sqlite`;
  if (name.length > 240) {
    throw new Error('Wallet database path is too long.');
  }
  return name;
}

export async function hasLegacyDeviceKey(): Promise<boolean> {
  return !!(await Keychain.getGenericPassword({ service: KEY_SERVICE }));
}
async function getDatabaseKey(
  namespace: StorageNamespace,
  existingOnly: boolean,
): Promise<string> {
  const service = databaseKeyService(namespace);
  const existing = await Keychain.getGenericPassword({ service });
  if (existing) {
    if (!/^[a-f0-9]{64}$/.test(existing.password)) {
      throw new Error('The device wallet encryption key is invalid.');
    }
    return existing.password;
  }
  if (existingOnly)
    throw new Error(
      'The saved wallet encryption key is unavailable. No new key or wallet was created.',
    );
  const key = Buffer.from(secureRandomBytes(32)).toString('hex');
  const stored = await Keychain.setGenericPassword(
    'beignet-device-wallet',
    key,
    {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (!stored) {
    throw new Error('The device could not protect the wallet encryption key.');
  }
  return key;
}

const NAMESPACES: StorageNamespace[] = ['legacy', 'mainnet', 'testnet', 'regtest'];

/**
 * Remove every device wallet from this phone: the encrypted databases of
 * every network slot and the keys that opened them. Nothing is read first and
 * nothing is kept. This is the owner's explicit choice to start over, made
 * with the wallet closed; it never runs while storage is open.
 */
export async function eraseDeviceStorage(): Promise<void> {
  if (opening || activeDatabases.size > 0)
    throw new Error('Close the device wallet before erasing it.');
  const failures: string[] = [];
  for (const namespace of NAMESPACES) {
    const paths = [
      'device-volume',
      '/probe-db',
      ...(['mainnet', 'testnet', 'regtest'] as const).map(
        network => `/wallet/${network}.db`,
      ),
    ];
    for (const path of paths) {
      const name = safeDatabaseName(path, namespace);
      try {
        // Opening a name that does not exist creates an empty file, which the
        // delete then removes along with any journal, so a slot that was never
        // used costs nothing and a slot that was is gone.
        open({ name }).delete();
      } catch {
        failures.push(name);
      }
    }
    const cleared = await Keychain.resetGenericPassword({
      service: databaseKeyService(namespace),
    }).catch(() => false);
    if (!cleared) failures.push(databaseKeyService(namespace));
  }
  try {
    open({ name: 'beignet-runtime-lease.sqlite' }).delete();
  } catch {
    // The lease holds no wallet data.
  }
  // The original unnamespaced vault's settings entry is also what the launch
  // screen reads as evidence that a device wallet exists; a phone that has
  // just been erased must not say "welcome back".
  await Keychain.resetGenericPassword({
    service: 'com.beignet.wallet.embedded.settings',
  }).catch(() => false);
  if (failures.length)
    throw new Error(
      `Some wallet data could not be removed (${failures.length} item${
        failures.length === 1 ? '' : 's'
      }). Try again before creating a new wallet.`,
    );
}

/** All seed, metadata and channel writes are synchronous encrypted SQLite commits. */
export async function openEncryptedDeviceStorage(
  namespace: StorageNamespace = 'legacy',
  existingOnly = false,
  allowEmpty = false,
) {
  if (opening || activeDatabases.size > 0) {
    throw new Error('The device wallet is already open.');
  }
  opening = true;
  try {
    return await initializeStorage(namespace, existingOnly, allowEmpty);
  } finally {
    opening = false;
  }
}
async function initializeStorage(
  namespace: StorageNamespace,
  existingOnly: boolean,
  allowEmpty: boolean,
) {
  if (!isSQLCipher()) {
    throw new Error(
      'This build is missing SQLCipher. Device wallets require encrypted storage.',
    );
  }
  // A separate SQLite write lock excludes another runtime/process before keys
  // are read. This database contains no wallet data and is never used for state.
  const lease = open({ name: 'beignet-runtime-lease.sqlite' });
  let leaseOpen = true;
  try {
    lease.executeSync('PRAGMA busy_timeout = 0');
    lease.executeSync('BEGIN EXCLUSIVE');
  } catch {
    lease.close();
    throw new Error('The device wallet is already open in another runtime.');
  }
  function releaseLease() {
    if (!leaseOpen) return;
    leaseOpen = false;
    try {
      lease.executeSync('ROLLBACK');
    } finally {
      lease.close();
    }
  }
  let encryptionKey: string;
  try {
    encryptionKey = await getDatabaseKey(namespace, existingOnly);
    if (existingOnly) {
      // SQLITE_OPEN_READONLY cannot create a missing vault. Check before any writable open.
      const probe = open({
        name: safeDatabaseName('device-volume', namespace),
        encryptionKey,
        readOnly: true,
      });
      try {
        const row = probe.executeSync(
          'SELECT content FROM files WHERE path = ?',
          ['/wallet/registry.json'],
        ).rows[0];
        if (!row?.content && !allowEmpty)
          throw new Error(
            'The saved wallet record is unavailable. No replacement wallet was created.',
          );
      } finally {
        probe.close();
      }
    }
  } catch (error) {
    releaseLease();
    throw error;
  }
  const databases = new Map<string, NativeSqliteDatabase>();
  function databaseFactory(path: string): NativeSqliteDatabase {
    const name = safeDatabaseName(path, namespace);
    if (activeDatabases.has(name)) {
      throw new Error('This device wallet is already open.');
    }
    const native = open({ name, encryptionKey });
    let database: NativeSqliteDatabase;
    try {
      const cipher = native.executeSync('PRAGMA cipher_version').rows[0];
      if (!cipher || !Object.values(cipher)[0]) {
        throw new Error('Encrypted database support is unavailable.');
      }
      native.executeSync('SELECT count(*) AS count FROM sqlite_master');
      database = new NativeSqliteDatabase(native);
    } catch (error) {
      native.close();
      throw error;
    }
    const close = database.close.bind(database);
    database.close = () => {
      close();
      activeDatabases.delete(name);
      databases.delete(name);
    };
    activeDatabases.add(name);
    databases.set(name, database);
    return database;
  }
  let files: NativeSqliteDatabase;
  try {
    files = databaseFactory('device-volume');
    files.exec(
      'CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, content BLOB NOT NULL)',
    );
  } catch (error) {
    for (const database of [...databases.values()]) database.close();
    releaseLease();
    throw error;
  }
  const volume: EncryptedVolume = {
    read(path) {
      const row = files
        .prepare('SELECT content FROM files WHERE path = ?')
        .get(path);
      if (!row) {
        return null;
      }
      const value = row.content;
      if (value instanceof ArrayBuffer) {
        return new Uint8Array(value).slice();
      }
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).slice();
      }
      throw new Error('Wallet file storage returned invalid binary data.');
    },
    write(path, data) {
      files
        .prepare(
          'INSERT INTO files(path, content) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content',
        )
        .run(path, data);
    },
    remove(path) {
      files.prepare('DELETE FROM files WHERE path = ?').run(path);
    },
    rename(from, to) {
      if (from === to) {
        return;
      }
      files.transaction(() => {
        const row = files
          .prepare('SELECT content FROM files WHERE path = ?')
          .get(from);
        if (!row) {
          throw new Error('The wallet file to rename does not exist.');
        }
        files
          .prepare(
            'INSERT INTO files(path, content) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content',
          )
          .run(to, row.content);
        files.prepare('DELETE FROM files WHERE path = ?').run(from);
      })();
    },
    list(prefix = '') {
      return files
        .prepare('SELECT path FROM files ORDER BY path')
        .all()
        .map(row => String(row.path))
        .filter(path => path.startsWith(prefix));
    },
  };
  return {
    databaseFactory,
    volume,
    async existingRegistryNamespaces(): Promise<StorageNamespace[]> {
      if (!leaseOpen) throw new Error('The device wallet storage is closed.');
      const namespaces: StorageNamespace[] = [
        'legacy',
        'mainnet',
        'testnet',
        'regtest',
      ];
      // Ask for each key by name rather than enumerating the keychain. What
      // enumeration returns varies by platform and by keychain library version,
      // and a namespace missed here is not a small error: it makes the seed
      // lookup conclude there is no original wallet, so a wallet created on
      // another network silently gets a brand new recovery phrase instead of
      // sharing the existing one. Four direct reads cannot miss.
      const found: StorageNamespace[] = [];
      for (const value of namespaces) {
        const key = await Keychain.getGenericPassword({
          service: databaseKeyService(value),
        });
        if (!leaseOpen)
          throw new Error('The device wallet storage is closed.');
        if (key) found.push(value);
      }
      return found;
    },
    async readRegistry(
      sourceNamespace: StorageNamespace,
    ): Promise<Uint8Array | null> {
      if (!leaseOpen) throw new Error('The device wallet storage is closed.');
      if (sourceNamespace === namespace)
        return volume.read('/wallet/registry.json');
      // The current exclusive lease protects all network slots. A sibling read never creates a key or database.
      const sourceKey = await getDatabaseKey(sourceNamespace, true);
      if (!leaseOpen) throw new Error('The device wallet storage is closed.');
      const source = open({
        name: safeDatabaseName('device-volume', sourceNamespace),
        encryptionKey: sourceKey,
        readOnly: true,
      });
      try {
        const row = source.executeSync(
          'SELECT content FROM files WHERE path = ?',
          ['/wallet/registry.json'],
        ).rows[0];
        if (!row) return null;
        if (row.content instanceof ArrayBuffer)
          return new Uint8Array(row.content).slice();
        if (ArrayBuffer.isView(row.content))
          return new Uint8Array(
            row.content.buffer,
            row.content.byteOffset,
            row.content.byteLength,
          ).slice();
        throw new Error(
          'The original wallet returned invalid encrypted storage data.',
        );
      } finally {
        source.close();
      }
    },
    close() {
      try {
        for (const database of [...databases.values()]) database.close();
      } finally {
        releaseLease();
      }
    },
  };
}
