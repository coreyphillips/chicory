import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import * as DeviceWallet from '../src/embedded/client';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../src/services/diagnosticLog';
import { defaultPreferences } from '../src/services/networks';
import {
  primaryPubkey,
  useWalletSession,
} from '../src/services/useWalletSession';
jest.mock('../src/embedded/storage', () => ({
  eraseDeviceStorage: jest.fn().mockResolvedValue(undefined),
}));

/**
 * How the session reads the wallet: one read at a time, however many ask,
 * and the reads after a connection only for the primary's. The session is
 * drawn on its own, opening a saved regtest wallet whose engine is a mock,
 * and every test runs on fake timers, so the poll and the reads after a
 * connection run only when the test moves the clock.
 */

const SESSION = 'com.beignet.wallet.last-session';
const PROFILES = 'com.beignet.wallet.network-profiles';
const PRIMARY = `03${'a'.repeat(64)}`;
const STRANGER = `02${'b'.repeat(64)}`;

let records: Map<string, string>;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  clearDiagnostics();
  records = new Map();
  const prefs = defaultPreferences();
  prefs.legacyNetwork = null;
  prefs.profiles.regtest.electrum = {
    host: 'localhost',
    port: 60001,
    tls: false,
  };
  prefs.profiles.regtest.primaryUri = `${PRIMARY}@127.0.0.1:9735`;
  records.set(PROFILES, JSON.stringify(prefs));
  records.set(
    SESSION,
    JSON.stringify({
      mode: 'device',
      network: 'regtest',
      walletId: 'saved-regtest',
      locked: false,
    }),
  );
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
      return { service: options?.service } as never;
    });
  jest.mocked(Keychain.getAllGenericPasswordServices).mockResolvedValue([]);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** What the engine answers a read with: a wallet whose primary is known. */
const reading = (over: Partial<WalletSnapshot> = {}): WalletSnapshot => ({
  wallet: {
    id: 'saved-regtest',
    name: 'My saved wallet',
    network: 'regtest',
    status: 'running',
    lfbw: { enabled: true, primaryPubkey: PRIMARY },
  },
  balance: {
    totalSats: 1000,
    availableSats: 1000,
    pendingSats: 0,
    receivableSats: 0,
  },
  activity: [],
  primary: {
    uri: `${PRIMARY}@127.0.0.1:9735`,
    connected: true,
    setup: 'ready',
  },
  notes: [],
  updatedAt: Date.now(),
  demo: false,
  ...over,
});

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
  client.refreshWallet = jest.fn().mockResolvedValue(undefined) as never;
  client.snapshot = jest.fn(async () => reading());
  return client;
}

let session!: ReturnType<typeof useWalletSession>;
const noop = () => {};
function Session() {
  session = useWalletSession({
    tab: 'Wallet',
    onTab: noop,
    onCloseSheet: noop,
  });
  return null;
}

/**
 * Opens the saved wallet on `client`, and hands back the engine's
 * diagnostic hook, through which it reports a peer connecting.
 */
async function open(client: EmbeddedWalletClient) {
  let hook!: (event: { phase: string; message: string }) => void;
  jest
    .spyOn(DeviceWallet, 'openDeviceWallet')
    .mockImplementation(async (_settings, onDiagnostic) => {
      hook = onDiagnostic!;
      return client;
    });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Session />);
  });
  expect(session.walletId).toBe('saved-regtest');
  expect(session.snapshot).not.toBeNull();
  const report = (phase: string, message: string) =>
    act(async () => hook({ phase, message }));
  return { tree, report };
}

/** Holds every read from here on until the test answers it, in order. */
function holdReads(client: EmbeddedWalletClient) {
  const answers: (() => void)[] = [];
  jest.mocked(client.snapshot).mockImplementation(
    () =>
      new Promise<WalletSnapshot>(resolve => {
        answers.push(() => resolve(reading()));
      }),
  );
  return answers;
}

const reads = (client: EmbeddedWalletClient) =>
  jest.mocked(client.snapshot).mock.calls.length;

describe('reads that overlap', () => {
  test('calls made while a read is out join it, and add exactly one read after it', async () => {
    const client = device();
    const { tree } = await open(client);
    const opened = reads(client);
    const answers = holdReads(client);
    const answered: string[] = [];
    await act(async () => {
      session.refresh().then(() => answered.push('first'));
      session.refresh().then(() => answered.push('second'));
      session.refresh().then(() => answered.push('third'));
    });
    // One read out, however many asked.
    expect(reads(client)).toBe(opened + 1);
    // It lands, and one more starts, begun after every call above. None of
    // them is answered by the read that was already on its way.
    await act(async () => answers[0]());
    expect(reads(client)).toBe(opened + 2);
    expect(answered).toEqual([]);
    // That one lands, nobody asked again, and every caller is answered.
    await act(async () => answers[1]());
    expect(reads(client)).toBe(opened + 2);
    expect(answered).toEqual(['first', 'second', 'third']);
    // And the next call is a read of its own again.
    await act(async () => {
      session.refresh();
    });
    expect(reads(client)).toBe(opened + 3);
    await act(async () => answers[2]());
    await act(async () => tree.unmount());
  });

  test('a manual refresh made while a read is out gets a read begun after its resync', async () => {
    const client = device();
    const { tree } = await open(client);
    const answers = holdReads(client);
    let refreshed = false;
    await act(async () => {
      session.refresh();
    });
    await act(async () => {
      session.manualRefresh().then(() => {
        refreshed = true;
      });
    });
    expect(client.refreshWallet).toHaveBeenCalledTimes(1);
    // The read under way began before the resync, so it is not the answer.
    await act(async () => answers[0]());
    expect(refreshed).toBe(false);
    const order = jest.mocked(client.snapshot).mock.invocationCallOrder;
    expect(order[order.length - 1]).toBeGreaterThan(
      jest.mocked(client.refreshWallet).mock.invocationCallOrder[0],
    );
    await act(async () => answers[1]());
    expect(refreshed).toBe(true);
    expect(session.refreshing).toBe(false);
    await act(async () => tree.unmount());
  });
});

describe('reads after a connection', () => {
  test('only the primary connecting brings the reads forward', async () => {
    const client = device();
    const { tree, report } = await open(client);
    const opened = reads(client);
    // Another peer: nothing is read before the poll would have.
    await report('peer:connect', STRANGER);
    await act(async () => jest.advanceTimersByTime(6000));
    expect(reads(client)).toBe(opened);
    // The primary: a read 1.5s on, and one more at 6s.
    await report('peer:connect', PRIMARY);
    await act(async () => jest.advanceTimersByTime(1500));
    expect(reads(client)).toBe(opened + 1);
    await act(async () => jest.advanceTimersByTime(4500));
    expect(reads(client)).toBe(opened + 2);
    await act(async () => tree.unmount());
  });

  test('a redial that reconnected the primary brings them forward too', async () => {
    const client = device();
    const { tree, report } = await open(client);
    const opened = reads(client);
    await report('primary-redial', 'reconnected');
    await act(async () => jest.advanceTimersByTime(1500));
    expect(reads(client)).toBe(opened + 1);
    await act(async () => tree.unmount());
  });

  test('with no primary known yet, any connection brings them forward, as before', async () => {
    const client = device();
    // A wallet whose record and address name no primary key yet.
    client.snapshot = jest.fn(async () =>
      reading({
        wallet: {
          id: 'saved-regtest',
          name: 'My saved wallet',
          network: 'regtest',
          status: 'running',
        },
        primary: { uri: '', connected: false, setup: 'pending' },
      }),
    );
    const { tree, report } = await open(client);
    const opened = reads(client);
    await report('peer:connect', STRANGER);
    await act(async () => jest.advanceTimersByTime(1500));
    expect(reads(client)).toBe(opened + 1);
    await act(async () => tree.unmount());
  });

  test('the engine’s timings are logged and read nothing', async () => {
    const client = device();
    const { tree, report } = await open(client);
    const opened = reads(client);
    await report('engine-perf', 'create 812ms');
    await act(async () => jest.advanceTimersByTime(6000));
    expect(reads(client)).toBe(opened);
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({
        phase: 'engine-perf',
        message: 'create 812ms',
      }),
    );
    await act(async () => tree.unmount());
  });
});

describe('the primary’s key', () => {
  test('comes from the wallet record, or else from the front of its address', () => {
    expect(primaryPubkey(reading())).toBe(PRIMARY);
    const upper = PRIMARY.toUpperCase();
    expect(
      primaryPubkey(
        reading({
          wallet: {
            ...reading().wallet,
            lfbw: { enabled: true, primaryPubkey: upper },
          },
        }),
      ),
    ).toBe(PRIMARY);
    const bare = { ...reading().wallet, lfbw: undefined };
    expect(
      primaryPubkey(
        reading({
          wallet: bare,
          primary: {
            uri: `${STRANGER}@iroh:abc`,
            connected: false,
            setup: 'ready',
          },
        }),
      ),
    ).toBe(STRANGER);
  });

  test('is unknown when neither names a public key', () => {
    const bare = { ...reading().wallet, lfbw: undefined };
    for (const uri of ['', 'node', '@127.0.0.1:9735', 'abc@127.0.0.1:9735'])
      expect(
        primaryPubkey(
          reading({
            wallet: bare,
            primary: { uri, connected: false, setup: 'ready' },
          }),
        ),
      ).toBe('');
    expect(primaryPubkey(null)).toBe('');
    expect(primaryPubkey(undefined)).toBe('');
  });
});
