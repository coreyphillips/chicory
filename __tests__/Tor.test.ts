import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { RnTor } from 'react-native-nitro-tor';
import { Socks5Client, Socks5Error } from '../src/embedded/socks';
import {
  ensureTorReady,
  isOnionHost,
  stopTor,
  torPhase,
  TOR_SOCKS_PORT,
} from '../src/services/tor';
import { NativeWalletSocket } from '../src/embedded/network';
import {
  openDeviceWallet,
  validateDeviceSettings,
} from '../src/embedded/client';

jest.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: '/device/Library',
  ANDROID_FILES_PATH: '/device/files',
}));
jest.mock('react-native-tcp-socket', () => {
  class FakeSocket {
    static instances: FakeSocket[] = [];
    listeners = new Map<string, ((...values: any[]) => void)[]>();
    written: any[] = [];
    connectOptions: any = null;
    destroyed = false;
    ended = false;
    encoding: string | null = null;
    constructor() {
      FakeSocket.instances.push(this);
    }
    on(event: string, listener: (...values: any[]) => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        listener,
      ]);
      return this;
    }
    emit(event: string, ...values: any[]) {
      for (const listener of this.listeners.get(event) ?? [])
        listener(...values);
    }
    connect(options: any, callback?: () => void) {
      this.connectOptions = options;
      if (callback) this.on('connect', callback);
      return this;
    }
    write(bytes: any, _encoding?: any, callback?: (error?: Error) => void) {
      this.written.push(require('buffer').Buffer.from(bytes));
      callback?.();
      return true;
    }
    setEncoding(value: string) {
      this.encoding = value;
      return this;
    }
    destroy() {
      this.destroyed = true;
      return this;
    }
    end() {
      this.ended = true;
      return this;
    }
    setTimeout() {
      return this;
    }
    setKeepAlive() {
      return this;
    }
    setNoDelay() {
      return this;
    }
    pause() {
      return this;
    }
    resume() {
      return this;
    }
  }
  return {
    Socket: FakeSocket,
    createConnection: jest.fn((options: any, callback?: () => void) => {
      const socket = new FakeSocket();
      socket.connect(options, callback);
      return socket;
    }),
    connectTLS: jest.fn((options: any) => {
      const socket = new FakeSocket();
      socket.connect(options);
      return socket;
    }),
  };
});

const sockets = () => (TcpSocket.Socket as any).instances as any[];
const settle = () =>
  new Promise<void>(resolve => setImmediate(() => resolve()));
const ONION = 'ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ln2ad.onion';

/** A successful SOCKS5 reply for an IPv4-shaped bind address. */
const grantReply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);

beforeEach(async () => {
  await stopTor();
  jest.clearAllMocks();
  jest.mocked(RnTor.startTorIfNotRunning).mockResolvedValue({
    is_success: true,
    onion_address: 'testonionaddress.onion:9050',
    control: '127.0.0.1:9051',
    error_message: '',
  });
  jest.mocked(RnTor.getServiceStatus).mockResolvedValue(1);
  jest.mocked(RnTor.deleteHiddenService).mockResolvedValue(true);
  sockets().length = 0;
});

test('onion hosts are recognised regardless of case or padding, and clearnet hosts are not', () => {
  expect(isOnionHost(ONION)).toBe(true);
  expect(isOnionHost(` ${ONION.toUpperCase()} `)).toBe(true);
  expect(isOnionHost('bitkit.to')).toBe(false);
  expect(isOnionHost('onion.example.com')).toBe(false);
  expect(isOnionHost('')).toBe(false);
});

test('the SOCKS request names the destination host so Tor resolves it, never this device', () => {
  const client = new Socks5Client(ONION, 9735);
  expect(Array.from(client.greeting())).toEqual([0x05, 0x01, 0x00]);
  const progress = client.push(Buffer.from([0x05, 0x00]));
  const request = progress.send as Buffer;
  expect(Array.from(request.subarray(0, 4))).toEqual([0x05, 0x01, 0x00, 0x03]);
  expect(request[4]).toBe(ONION.length);
  expect(
    Buffer.from(request.subarray(5, 5 + ONION.length)).toString('ascii'),
  ).toBe(ONION);
  expect(request.readUInt16BE(5 + ONION.length)).toBe(9735);
  expect(progress.ready).toBeUndefined();
});

test('destination bytes arriving with the final reply are kept and delivered in order', () => {
  const client = new Socks5Client(ONION, 9735);
  client.push(Buffer.from([0x05, 0x00]));
  const progress = client.push(
    Buffer.concat([grantReply, Buffer.from('init', 'ascii')]),
  );
  expect(progress.ready).toBe(true);
  expect(progress.leftover?.toString('ascii')).toBe('init');
});

test('a reply split across chunks completes without consuming destination bytes early', () => {
  const client = new Socks5Client(ONION, 9735);
  expect(client.push(Buffer.from([0x05])).send).toBeUndefined();
  expect(client.push(Buffer.from([0x00])).send).toBeDefined();
  expect(client.push(grantReply.subarray(0, 3)).ready).toBeUndefined();
  expect(client.push(grantReply.subarray(3)).ready).toBe(true);
});

test('a refused connection reports the Tor failure and its destination', () => {
  const client = new Socks5Client(ONION, 9735);
  client.push(Buffer.from([0x05, 0x00]));
  const reply = Buffer.from(grantReply);
  reply[1] = 0x04;
  expect(() => client.push(reply)).toThrow(Socks5Error);
  expect(() =>
    new Socks5Client(ONION, 9735).push(Buffer.from([0x04, 0x00])),
  ).toThrow('did not answer with SOCKS5');
});

test('a proxy demanding authentication is refused rather than answered', () => {
  expect(() =>
    new Socks5Client(ONION, 9735).push(Buffer.from([0x05, 0x02])),
  ).toThrow('unsupported login');
});

test('Tor starts once for concurrent callers and drops the onion service it publishes', async () => {
  await Promise.all([ensureTorReady(), ensureTorReady()]);
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledWith(
    expect.objectContaining({ socks_port: TOR_SOCKS_PORT }),
  );
  expect(RnTor.deleteHiddenService).toHaveBeenCalledWith('testonionaddress');
  expect(torPhase()).toBe('ready');
  await ensureTorReady();
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
});

test('a daemon that never bootstraps fails the connection and stays retryable', async () => {
  jest.mocked(RnTor.getServiceStatus).mockResolvedValue(0);
  jest.mocked(RnTor.startTorIfNotRunning).mockResolvedValue({
    is_success: false,
    onion_address: '',
    control: '',
    error_message: 'Failed to initialize Tor service',
  });
  await expect(ensureTorReady()).rejects.toThrow(
    'Failed to initialize Tor service',
  );
  expect(torPhase()).toBe('failed');
  expect(RnTor.deleteHiddenService).not.toHaveBeenCalled();
  jest.mocked(RnTor.getServiceStatus).mockResolvedValue(1);
  await ensureTorReady();
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(2);
});

test('closing the wallet stops the daemon, and the next onion connection starts it again', async () => {
  await ensureTorReady();
  await stopTor();
  expect(RnTor.shutdownService).toHaveBeenCalledTimes(1);
  expect(torPhase()).toBe('stopped');
  await ensureTorReady();
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(2);
});

test('a native socket error that arrives as a string reaches the engine as an Error', async () => {
  const socket = new NativeWalletSocket({
    host: '127.0.0.1',
    port: 9735,
    tls: false,
  });
  const seen: unknown[] = [];
  socket.on('error', error => seen.push(error));
  await settle();
  const native = sockets().at(-1)!;
  native.emit('error', 'connection reset');
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBeInstanceOf(Error);
  expect((seen[0] as Error).message).toBe('connection reset');
});

test('a clearnet endpoint dials directly and never starts Tor', async () => {
  const socket = new NativeWalletSocket({
    host: 'bitkit.to',
    port: 9999,
    tls: true,
  });
  await settle();
  expect(RnTor.startTorIfNotRunning).not.toHaveBeenCalled();
  expect(TcpSocket.connectTLS).toHaveBeenCalledWith(
    expect.objectContaining({ host: 'bitkit.to', port: 9999 }),
  );
  expect(socket.remoteAddress).toBe('bitkit.to');
});

test('an onion peer starts Tor, tunnels through the local proxy and connects only once the destination answers', async () => {
  const socket = new NativeWalletSocket({
    host: ONION,
    port: 9735,
    tls: false,
  });
  const events: string[] = [];
  socket.on('connect', () => events.push('connect'));
  socket.on('data', (chunk: Buffer) =>
    events.push(`data:${chunk.toString('ascii')}`),
  );
  await settle();
  expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
  const native = sockets()[0];
  expect(native.connectOptions).toEqual(
    expect.objectContaining({ host: '127.0.0.1', port: TOR_SOCKS_PORT }),
  );

  // Bytes written before the tunnel opens must not join the SOCKS conversation.
  socket.write(Buffer.from('act1', 'ascii'));
  native.emit('connect');
  expect(events).toEqual([]);
  expect(native.written).toHaveLength(1);
  expect(Array.from(native.written[0])).toEqual([0x05, 0x01, 0x00]);

  native.emit('data', Buffer.from([0x05, 0x00]));
  expect(native.written[1][3]).toBe(0x03);
  expect(events).toEqual([]);

  native.emit('data', Buffer.concat([grantReply, Buffer.from('hi', 'ascii')]));
  expect(native.written[2].toString('ascii')).toBe('act1');
  expect(events).toEqual(['connect', 'data:hi']);
  expect(socket.readyState).toBe('open');
});

test('an onion endpoint asking for TLS is refused instead of dialling', () => {
  expect(
    () => new NativeWalletSocket({ host: ONION, port: 50002, tls: true }),
  ).toThrow('without TLS');
  expect(RnTor.startTorIfNotRunning).not.toHaveBeenCalled();
});

test('a Tor failure closes the pending connection without touching the native socket', async () => {
  jest
    .mocked(RnTor.startTorIfNotRunning)
    .mockRejectedValue(new Error('Tor is unavailable'));
  const socket = new NativeWalletSocket({
    host: ONION,
    port: 9735,
    tls: false,
  });
  const errors: string[] = [];
  let closed = false;
  socket.on('error', (error: Error) => errors.push(error.message));
  socket.on('close', () => {
    closed = true;
  });
  await settle();
  expect(errors).toEqual(['Tor is unavailable']);
  expect(closed).toBe(true);
  expect(sockets()[0].connectOptions).toBeNull();
  expect(sockets()[0].destroyed).toBe(false);
});

test('closing an onion connection before Tor is ready never dials the proxy', async () => {
  const socket = new NativeWalletSocket({
    host: ONION,
    port: 9735,
    tls: false,
  });
  socket.destroy();
  await settle();
  expect(sockets()[0].connectOptions).toBeNull();
  expect(sockets()[0].destroyed).toBe(false);
  expect(socket.destroyed).toBe(true);
});

test('a proxy that accepts the connection but never answers gives up instead of hanging', async () => {
  jest.useFakeTimers();
  try {
    const socket = new NativeWalletSocket({
      host: ONION,
      port: 9735,
      tls: false,
    });
    const errors: string[] = [];
    socket.on('error', (error: Error) => errors.push(error.message));
    await jest.advanceTimersByTimeAsync(0);
    const native = sockets()[0];
    expect(native.connectOptions).not.toBeNull();
    native.emit('connect');
    await jest.advanceTimersByTimeAsync(180000);
    expect(errors).toEqual([`Tor did not open a connection to ${ONION}:9735.`]);
    expect(socket.destroyed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

const mockRuntime = { request: jest.fn(), close: jest.fn() };
const mockStorage = {
  volume: { read: () => null },
  databaseFactory: jest.fn(),
  close: jest.fn(),
};
jest.mock('@beignet/portable-engine', () => ({
  createPortableRuntime: jest.fn(async () => mockRuntime),
  createRelaySocketFactory: jest.fn(),
}));
jest.mock('../src/embedded/storage', () => ({
  hasLegacyDeviceKey: jest.fn().mockResolvedValue(false),
  openEncryptedDeviceStorage: jest.fn(async () => mockStorage),
}));
jest.mock('../src/embedded/seed', () => ({
  withDeviceSeedSource: (value: unknown) => value,
}));

describe('opening a device wallet', () => {
  const profile = (
    electrum: { host: string; port: number; tls: boolean },
    transport: 'native' | 'relay' = 'native',
  ) => ({
    network: 'regtest' as const,
    electrum,
    primaryUri: '',
    transport,
    relayUrl: '',
    relayToken: '',
  });

  test('an onion Electrum server waits for Tor before the chain check runs', async () => {
    await openDeviceWallet(profile({ host: ONION, port: 50001, tls: false }));
    expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
  });

  const onionPrimary = `${'ab'.repeat(33)}@${ONION}:9735`;
  const registry = (primaryUri: string) =>
    Buffer.from(
      JSON.stringify({
        record: { network: 'regtest', lfbw: { enabled: true, primaryUri } },
      }),
    );

  test('an onion primary in the stored wallet warms Tor at open, without waiting for the dial', async () => {
    const read = mockStorage.volume.read;
    mockStorage.volume.read = (() =>
      registry(onionPrimary)) as unknown as typeof read;
    try {
      await openDeviceWallet(
        profile({ host: '127.0.0.1', port: 60001, tls: false }),
      );
    } finally {
      mockStorage.volume.read = read;
    }
    // Started once here; the engine's own dial later joins the same start.
    expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
  });

  test('an onion primary in the profile warms Tor at open too', async () => {
    await openDeviceWallet({
      ...profile({ host: '127.0.0.1', port: 60001, tls: false }),
      primaryUri: onionPrimary,
    });
    expect(RnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
  });

  test('a clearnet primary does not start Tor at open', async () => {
    const read = mockStorage.volume.read;
    mockStorage.volume.read = (() =>
      registry(`${'ab'.repeat(33)}@127.0.0.1:9735`)) as unknown as typeof read;
    try {
      await openDeviceWallet(
        profile({ host: '127.0.0.1', port: 60001, tls: false }),
      );
    } finally {
      mockStorage.volume.read = read;
    }
    expect(RnTor.startTorIfNotRunning).not.toHaveBeenCalled();
  });

  test('a clearnet Electrum server opens the wallet without starting Tor', async () => {
    await openDeviceWallet(
      profile({ host: '127.0.0.1', port: 60001, tls: false }),
    );
    expect(RnTor.startTorIfNotRunning).not.toHaveBeenCalled();
  });

  test('an onion Electrum server with TLS is rejected before anything opens', () => {
    expect(() =>
      validateDeviceSettings(profile({ host: ONION, port: 50002, tls: true })),
    ).toThrow('without TLS');
  });
});
