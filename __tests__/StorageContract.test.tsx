import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import App from '../App';
import * as DeviceWallet from '../src/embedded/client';
import { defaultPreferences } from '../src/services/networks';
import { env, filesUnder, fs, path, ROOT } from '../test-support/node';
jest.mock('../src/embedded/storage', () => ({
  eraseDeviceStorage: jest.fn().mockResolvedValue(undefined),
}));

/**
 * The redesign branch installs over the main build under the same app id and
 * opens the same wallet, so it must read and write the secure store exactly as
 * main does. The fixture was recorded on main's code before any redesign
 * change: which services are written, with which top-level fields, and which
 * are cleared. A UI change that adds a key, renames one, or changes a record's
 * shape fails here. Re-record only for a deliberate, reviewed storage change:
 * RECORD_CONTRACT=1 npx jest StorageContract
 */
const FIXTURE = path.join(ROOT, 'test-support', 'storage-contract.json');
const SESSION = 'com.beignet.wallet.last-session';
const SNAPSHOT = 'com.beignet.wallet.last-snapshot';
const PROFILES = 'com.beignet.wallet.network-profiles';
/**
 * Services the redesign adds on purpose. Main never reads them, so a build of
 * main installed over the redesign ignores them.
 */
const ADDED_BY_REDESIGN = ['com.beignet.wallet.haptics'];

type Write = string;
let records: Map<string, string>;
let log: Write[];

function shape(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return `{${Object.keys(parsed).sort().join(',')}}`;
    }
    return typeof parsed;
  } catch {
    return 'text';
  }
}
function service(name: string | undefined) {
  // Per-wallet and per-network slots share one contract.
  return (name || '')
    .replace(/^(com\.beignet\.wallet\.last-snapshot)\..+$/, '$1.<wallet>')
    .replace(
      /^(com\.beignet\.wallet\.embedded\.database-key)\..+$/,
      '$1.<network>',
    );
}

beforeEach(() => {
  jest.clearAllMocks();
  records = new Map();
  log = [];
  const prefs = defaultPreferences();
  prefs.legacyNetwork = null;
  prefs.profiles.regtest.electrum = {
    host: 'localhost',
    port: 60001,
    tls: false,
  };
  prefs.profiles.regtest.primaryUri = `03${'a'.repeat(64)}@127.0.0.1:9735`;
  records.set(PROFILES, JSON.stringify(prefs));
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      records.has(options?.service || '')
        ? ({ password: records.get(options?.service || '') } as never)
        : false,
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      records.set(options?.service || '', value);
      log.push(`set ${service(options?.service)} ${shape(value)}`);
      return { service: options?.service } as never;
    });
  jest
    .mocked(Keychain.resetGenericPassword)
    .mockImplementation(async options => {
      records.delete(options?.service || '');
      log.push(`reset ${service(options?.service)}`);
      return true;
    });
  jest.mocked(Keychain.getAllGenericPasswordServices).mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function');
}
async function press(tree: ReactTestRenderer, value: string) {
  const target = label(tree, value);
  if (!target) throw new Error(`No control labelled "${value}"`);
  await act(async () => {
    await target.props.onPress();
  });
}
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 10));
    });
  }
}

const savedSnapshot = {
  wallet: {
    id: 'saved-regtest',
    name: 'My saved wallet',
    network: 'regtest',
    status: 'running',
  },
  balance: {
    totalSats: 123456,
    availableSats: 100000,
    pendingSats: 23456,
    receivableSats: 50000,
  },
  activity: [],
  primary: { uri: 'node', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: Date.now() - 60000,
  demo: false,
};

function device() {
  const client = new EmbeddedWalletClient({
    runtime: { request: jest.fn(), close: jest.fn() },
  });
  client.listWallets = jest.fn().mockResolvedValue([
    {
      id: 'saved-regtest',
      name: 'My saved wallet',
      network: 'regtest',
      status: 'stopped',
    },
  ]);
  client.startWallet = jest.fn().mockResolvedValue(undefined);
  client.snapshot = jest
    .fn()
    .mockResolvedValue({ ...savedSnapshot, updatedAt: Date.now() });
  client.getRecoveryPhrase = jest
    .fn()
    .mockResolvedValue('test fixture words only');
  jest.spyOn(client, 'close').mockResolvedValue(undefined);
  return client;
}

async function firstRun() {
  const prefs = JSON.parse(records.get(PROFILES)!);
  jest.spyOn(DeviceWallet, 'loadDevicePreferences').mockResolvedValue(prefs);
  const client = device();
  client.listWallets = jest.fn().mockResolvedValue([]);
  client.createWallet = jest.fn().mockResolvedValue({
    id: 'new-mainnet',
    name: 'My wallet',
    network: 'mainnet',
    status: 'running',
    mnemonic: 'fixture words never shown',
  });
  client.snapshot = jest.fn().mockResolvedValue({
    ...(await new DemoWalletClient().snapshot()),
    wallet: {
      id: 'new-mainnet',
      name: 'My wallet',
      network: 'mainnet',
      status: 'running',
    },
    demo: false,
    updatedAt: Date.now(),
  });
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await settle();
  // The backup reminder leads to the reveal. On main it sits on the page; the
  // redesign may put one tap in front of it, which this follows.
  if (!label(tree, 'Reveal recovery phrase'))
    await press(tree, 'Save your recovery phrase.');
  await press(tree, 'Reveal recovery phrase');
  await press(tree, 'I saved my recovery phrase');
  await settle();
  await act(async () => {
    tree.unmount();
  });
}

async function returning() {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  records.set(
    SNAPSHOT,
    JSON.stringify({
      version: 1,
      walletId: 'saved-regtest',
      snapshot: savedSnapshot,
    }),
  );
  const client = device();
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await settle();
  await press(tree, 'Settings');
  await press(tree, 'Lock device wallet');
  await settle();
  await act(async () => {
    tree.unmount();
  });
}

async function erase() {
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
  const client = device();
  jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(client);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  await settle();
  await press(tree, 'Settings');
  await press(tree, 'Erase wallet from this phone');
  await press(tree, 'Erase wallet');
  await settle();
  await act(async () => {
    tree.unmount();
  });
}

const FLOWS: Record<string, () => Promise<void>> = {
  firstRun,
  returning,
  erase,
};

test('the app writes and clears the secure store exactly as main does', async () => {
  const observed: Record<string, string[]> = {};
  for (const [name, flow] of Object.entries(FLOWS)) {
    log = [];
    await flow();
    observed[name] = Array.from(new Set(log)).sort();
    jest.restoreAllMocks();
  }
  if (env.RECORD_CONTRACT) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(observed, null, 2)}\n`);
  }
  const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  expect(observed).toEqual(expected);
});

test('no secure-store service is named in the source beyond main and the redesign additions', () => {
  const files = [
    path.join(ROOT, 'App.tsx'),
    ...filesUnder(path.join(ROOT, 'src'), /\.(ts|tsx)$/),
  ];
  const found = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /com\.beignet\.wallet(?:\.[A-Za-z0-9_-]+)*/g,
    )) {
      found.add(match[0]);
    }
  }
  const allowed = [
    'com.beignet.wallet.connection',
    'com.beignet.wallet.device-seed-source',
    'com.beignet.wallet.embedded.database-key',
    'com.beignet.wallet.embedded.settings',
    'com.beignet.wallet.last-session',
    'com.beignet.wallet.last-snapshot',
    'com.beignet.wallet.lock',
    'com.beignet.wallet.lock-guard',
    'com.beignet.wallet.network-profiles',
    // Prefixes that the code composes with a suffix at runtime.
    'com.beignet.wallet',
    ...ADDED_BY_REDESIGN,
  ];
  const unexpected = Array.from(found).filter(name => !allowed.includes(name));
  expect(unexpected).toEqual([]);
});
