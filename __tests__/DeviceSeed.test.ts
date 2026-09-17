import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';
import type { PortableRuntime } from '@beignet/portable-engine';
import type { Network } from '@beignet/wallet-core';
import type { StorageNamespace } from '../src/embedded/storage';
import { DeviceSeedStorage, withDeviceSeedSource } from '../src/embedded/seed';

const SOURCE = 'com.beignet.wallet.device-seed-source';
const REGISTRY = '/wallet/registry.json';
const FIRST =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DISTINCT =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
let secure: Map<string, string>;
let vaults: Map<StorageNamespace, Map<string, Uint8Array>>;
/** What the engine was actually handed on each create, before the wrapper wipes it. */
const suppliedMnemonics: (string | undefined)[] = [];

beforeEach(() => {
  suppliedMnemonics.length = 0;
  jest.clearAllMocks();
  secure = new Map();
  vaults = new Map();
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      secure.has(options!.service!)
        ? ({ password: secure.get(options!.service!) } as never)
        : false,
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_user, value, options) => {
      secure.set(options!.service!, value);
      return { service: options!.service } as never;
    });
});
function registry(namespace: StorageNamespace) {
  const value = vaults.get(namespace)?.get(REGISTRY);
  return value ? JSON.parse(Buffer.from(value).toString('utf8')) : null;
}
function saveWallet(
  namespace: StorageNamespace,
  network: Network,
  mnemonic: string,
  createdAt: number,
) {
  const files = vaults.get(namespace) || new Map();
  files.set(
    REGISTRY,
    Buffer.from(
      JSON.stringify({
        record: { id: `wallet-${namespace}`, network, createdAt },
        mnemonic,
      }),
    ),
  );
  files.set(
    '/wallet/channels.sqlite',
    Buffer.from(`unchanged channel state for ${namespace}`),
  );
  files.set(
    '/wallet/activity.json',
    Buffer.from(`unchanged history for ${namespace}`),
  );
  vaults.set(namespace, files);
}
function sourceReference(namespace: StorageNamespace) {
  const record = registry(namespace).record;
  return {
    version: 1,
    namespace,
    network: record.network,
    walletId: record.id,
    createdAt: record.createdAt,
  };
}
function open(namespace: StorageNamespace, network: Network) {
  if (!vaults.has(namespace)) vaults.set(namespace, new Map());
  const files = vaults.get(namespace)!;
  const storage: DeviceSeedStorage = {
    volume: {
      read: path => (files.has(path) ? new Uint8Array(files.get(path)!) : null),
    },
    existingRegistryNamespaces: jest.fn(async () => [...vaults.keys()]),
    readRegistry: jest.fn(async source => {
      const sourceFiles = vaults.get(source);
      if (!sourceFiles) throw new Error('Original encrypted database missing');
      return sourceFiles.has(REGISTRY)
        ? new Uint8Array(sourceFiles.get(REGISTRY)!)
        : null;
    }),
  };
  const engine: PortableRuntime = {
    request: jest.fn(async request => {
      if (request.method === 'POST' && request.path === '/api/wallets') {
        if (registry(namespace)) throw new Error('Wallet already exists');
        suppliedMnemonics.push(request.body.mnemonic);
        const mnemonic = request.body.mnemonic || FIRST;
        saveWallet(namespace, network, mnemonic, 100);
        return { record: registry(namespace).record, mnemonic };
      }
      return registry(namespace);
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    client: withDeviceSeedSource(engine, storage, namespace),
    engine,
    storage,
  };
}
const createRequest = (network: Network) => ({
  method: 'POST',
  path: '/api/wallets',
  body: { network, lfbw: { enabled: true, trusted: false } },
});

test('cold network creation reuses the original phrase while all existing channel/history bytes remain untouched', async () => {
  let first = open('mainnet', 'mainnet');
  await first.client.request(createRequest('mainnet'));
  expect(registry('mainnet').mnemonic).toBe(FIRST);
  const reference = JSON.parse(secure.get(SOURCE)!);
  expect(reference).toEqual(sourceReference('mainnet'));
  expect(secure.get(SOURCE)).not.toContain('abandon');
  const firstBytes = [...vaults.get('mainnet')!.entries()].map(
    ([key, value]) => [key, Buffer.from(value).toString('hex')],
  );
  await first.client.close();
  // A new wrapper has no in-memory seed or reference from the previous network.
  const next = open('regtest', 'regtest');
  await next.client.request(createRequest('regtest'));
  expect(registry('regtest').mnemonic).toBe(FIRST);
  expect(registry('regtest').record.network).toBe('regtest');
  expect(
    [...vaults.get('mainnet')!.entries()].map(([key, value]) => [
      key,
      Buffer.from(value).toString('hex'),
    ]),
  ).toEqual(firstBytes);
  expect(vaults.get('regtest')!.get('/wallet/channels.sqlite')).not.toEqual(
    vaults.get('mainnet')!.get('/wallet/channels.sqlite'),
  );
  expect(vaults.get('regtest')!.get('/wallet/activity.json')).not.toEqual(
    vaults.get('mainnet')!.get('/wallet/activity.json'),
  );
  const wireBody = jest.mocked(next.engine.request).mock.calls[0][0].body;
  expect(wireBody.mnemonic).toBeUndefined();
  expect(wireBody.lfbw.trusted).toBe(false);
  await next.client.close();
  first = open('mainnet', 'mainnet');
  expect(
    (
      await first.client.request({
        path: '/api/wallets/wallet-mainnet/mnemonic',
      })
    ).mnemonic,
  ).toBe(FIRST);
  await first.client.close();
});

test('migration selects the oldest actual local wallet, retaining distinct existing phrases and legacy namespace bytes', async () => {
  saveWallet('mainnet', 'mainnet', DISTINCT, 30);
  saveWallet('legacy', 'testnet', FIRST, 10);
  const originals = ['mainnet', 'legacy'].map(namespace =>
    Buffer.from(
      vaults.get(namespace as StorageNamespace)!.get(REGISTRY)!,
    ).toString('hex'),
  );
  const next = open('regtest', 'regtest');
  await next.client.request(createRequest('regtest'));
  expect(JSON.parse(secure.get(SOURCE)!)).toEqual(sourceReference('legacy'));
  expect(registry('regtest').mnemonic).toBe(FIRST);
  expect(
    ['mainnet', 'legacy'].map(namespace =>
      Buffer.from(
        vaults.get(namespace as StorageNamespace)!.get(REGISTRY)!,
      ).toString('hex'),
    ),
  ).toEqual(originals);
  await next.client.close();
  // A damaged source reference does not hide/reseed another already-created wallet.
  secure.set(SOURCE, '{corrupt');
  const existing = open('mainnet', 'mainnet');
  expect(
    (
      await existing.client.request({
        path: '/api/wallets/wallet-mainnet/mnemonic',
      })
    ).mnemonic,
  ).toBe(DISTINCT);
  await expect(
    existing.client.request(createRequest('mainnet')),
  ).rejects.toThrow('already exists');
  expect(existing.storage.readRegistry).not.toHaveBeenCalled();
  expect(registry('mainnet').mnemonic).toBe(DISTINCT);
  await existing.client.close();
});

test.each(['missing', 'identity', 'corrupt-registry', 'corrupt-reference'])(
  'new-network creation fails closed when the original source is %s',
  async failure => {
    saveWallet('mainnet', 'mainnet', FIRST, 10);
    secure.set(SOURCE, JSON.stringify(sourceReference('mainnet')));
    if (failure === 'missing') vaults.delete('mainnet');
    if (failure === 'identity') saveWallet('mainnet', 'mainnet', DISTINCT, 11);
    if (failure === 'corrupt-registry')
      vaults.get('mainnet')!.set(REGISTRY, Buffer.from('{broken'));
    if (failure === 'corrupt-reference') secure.set(SOURCE, '{broken');
    const next = open('testnet', 'testnet');
    await expect(
      next.client.request(createRequest('testnet')),
    ).rejects.toThrow();
    expect(next.engine.request).not.toHaveBeenCalled();
    expect(registry('testnet')).toBeNull();
    await next.client.close();
  },
);

test('a failed source-reference write blocks migration without changing existing wallet data', async () => {
  saveWallet('mainnet', 'mainnet', FIRST, 10);
  const original = vaults.get('mainnet')!.get(REGISTRY)!.slice();
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
  const next = open('testnet', 'testnet');
  await expect(next.client.request(createRequest('testnet'))).rejects.toThrow(
    'securely',
  );
  expect(next.engine.request).not.toHaveBeenCalled();
  expect(vaults.get('mainnet')!.get(REGISTRY)).toEqual(original);
  expect(registry('testnet')).toBeNull();
  await next.client.close();
});

test('failed post-commit source metadata preserves the backup result and rediscovers that same original seed', async () => {
  const first = open('mainnet', 'mainnet');
  jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
  const result = await first.client.request(createRequest('mainnet'));
  expect(result.mnemonic).toBe(FIRST);
  expect(result.record.id).toBe('wallet-mainnet');
  expect(result.warnings).toEqual([
    expect.stringContaining('reference for other networks could not be saved'),
  ]);
  expect(registry('mainnet').mnemonic).toBe(FIRST);
  expect(secure.has(SOURCE)).toBe(false);
  await first.client.close();
  const next = open('testnet', 'testnet');
  await next.client.request(createRequest('testnet'));
  expect(registry('testnet').mnemonic).toBe(FIRST);
  expect(JSON.parse(secure.get(SOURCE)!)).toEqual(sourceReference('mainnet'));
  await next.client.close();
});

test('close cancels an unfinished source read before engine creation and keeps storage owned until it settles', async () => {
  saveWallet('mainnet', 'mainnet', FIRST, 10);
  secure.set(SOURCE, JSON.stringify(sourceReference('mainnet')));
  const next = open('testnet', 'testnet');
  let finishRead!: (bytes: Uint8Array) => void;
  jest.mocked(next.storage.readRegistry).mockImplementation(
    () =>
      new Promise(resolve => {
        finishRead = resolve;
      }),
  );
  const pending = next.client.request(createRequest('testnet'));
  const outcome = pending.then(
    () => null,
    (error: unknown) => error,
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await expect(next.client.request(createRequest('testnet'))).rejects.toThrow(
    'already being created',
  );
  const closing = next.client.close();
  expect(next.engine.close).not.toHaveBeenCalled();
  finishRead(new Uint8Array(vaults.get('mainnet')!.get(REGISTRY)!));
  expect(await outcome).toMatchObject({
    message: expect.stringContaining('closing'),
  });
  await closing;
  expect(next.engine.request).not.toHaveBeenCalled();
  expect(next.engine.close).toHaveBeenCalledTimes(1);
  expect(registry('testnet')).toBeNull();
});

test('corrupt local registry during initial migration cannot cause a fresh fallback seed', async () => {
  vaults.set('legacy', new Map([[REGISTRY, Buffer.from('{broken')]]));
  const next = open('mainnet', 'mainnet');
  await expect(next.client.request(createRequest('mainnet'))).rejects.toThrow(
    'No new recovery phrase',
  );
  expect(next.engine.request).not.toHaveBeenCalled();
  expect(secure.has(SOURCE)).toBe(false);
  await next.client.close();
});

test('the original phrase is really handed to the engine, not merely expected of it', async () => {
  // The engine mock falls back to the original phrase when none is supplied, so
  // the reuse assertions elsewhere in this file also pass when the injection is
  // removed entirely. This one fails in that case: it looks at what the engine
  // was actually given.
  const first = open('mainnet', 'mainnet');
  await first.client.request(createRequest('mainnet'));
  const original = registry('mainnet').mnemonic;
  await first.client.close();
  expect(suppliedMnemonics).toEqual([undefined]);

  suppliedMnemonics.length = 0;
  const next = open('regtest', 'regtest');
  await next.client.request(createRequest('regtest'));
  await next.client.close();
  expect(suppliedMnemonics).toEqual([original]);
  expect(original).toMatch(/\S+( \S+){11,}/);
});

test('a phrase the owner supplies is the wallet that is created, and becomes the source when there is none', async () => {
  const typed =
    'typed fixture words only never use this phrase for a real wallet ok';
  const fresh = open('mainnet', 'mainnet');
  await fresh.client.request({
    ...createRequest('mainnet'),
    body: { ...createRequest('mainnet').body, mnemonic: typed },
  });
  expect(registry('mainnet').mnemonic).toBe(typed);
  expect(suppliedMnemonics.at(-1)).toBe(typed);
  // It is now the wallet other networks reuse.
  const sibling = open('regtest', 'regtest');
  await sibling.client.request(createRequest('regtest'));
  expect(registry('regtest').mnemonic).toBe(typed);
  // And a typed phrase on yet another network is not replaced by the source.
  const other = open('testnet', 'testnet');
  await other.client.request({
    ...createRequest('testnet'),
    body: { ...createRequest('testnet').body, mnemonic: DISTINCT },
  });
  expect(registry('testnet').mnemonic).toBe(DISTINCT);
});
