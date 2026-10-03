import { AppState, NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { createNativeIrohEndpoint } from '../src/embedded/iroh';

const pending = () => new Promise<never>(() => {});
const id = 'ab'.repeat(32);
const peer = 'cd'.repeat(32);
const key = new Uint8Array(32).fill(7);
const bridge = {
  bind: jest.fn().mockResolvedValue(id),
  connect: jest.fn().mockResolvedValue(undefined),
  read: jest.fn(pending),
  write: jest.fn().mockResolvedValue(undefined),
  closed: jest.fn(pending),
  diagnostics: jest
    .fn()
    .mockResolvedValue(
      JSON.stringify({ endpointId: peer, path: 'relay', rttMs: 35 }),
    ),
  closeConnection: jest.fn().mockResolvedValue(undefined),
  closeEndpoint: jest.fn().mockResolvedValue(undefined),
};
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  AppState.currentState = 'active';
  NativeModules.ChicoryIroh = bridge;
  bridge.bind.mockResolvedValue(id);
  bridge.connect.mockResolvedValue(undefined);
  bridge.closeEndpoint.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('native bind receives the wallet identity and one connection carries ordered byte writes', async () => {
  const endpoint = await createNativeIrohEndpoint({
    secretKey: key,
    relays: ['https://relay.example/'],
    discovery: false,
  });
  try {
    expect(bridge.bind).toHaveBeenCalledWith(
      expect.any(String),
      Buffer.from(key).toString('base64'),
      '["https://relay.example/"]',
      false,
    );
    const socket = await endpoint.connect(
      { endpointId: peer, relayUrl: 'https://relay.example/' },
      1000,
    );
    expect(bridge.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      peer,
      'https://relay.example/',
      '[]',
    );
    const bytes = Buffer.alloc(70000, 42);
    await new Promise<void>((resolve, reject) =>
      socket.write(bytes, error => (error ? reject(error) : resolve())),
    );
    const written = bridge.write.mock.calls.map(call =>
      Buffer.from(call[1], 'base64'),
    );
    expect(Buffer.concat(written)).toEqual(bytes);
    expect(written.every(chunk => chunk.length <= 65536)).toBe(true);
    expect(socket.getIrohDiagnostics()).toEqual({
      endpointId: peer,
      path: 'relay',
      rttMs: 35,
    });
    socket.destroy();
    expect(bridge.closeConnection).toHaveBeenCalled();
  } finally {
    await endpoint.close();
  }
  expect(bridge.closeEndpoint).toHaveBeenCalled();
});

test('a timed out dial is cancelled through the native bridge', async () => {
  jest.useFakeTimers();
  const endpoint = await createNativeIrohEndpoint({ secretKey: key });
  bridge.connect.mockImplementationOnce(pending);
  const attempt = endpoint.connect({ endpointId: peer }, 100);
  const refused = expect(attempt).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(101);
  await refused;
  expect(bridge.closeConnection).toHaveBeenCalled();
  await endpoint.close();
});

test('foreground rebind closes suspended sockets and keeps the identity', async () => {
  const before = jest.mocked(AppState.addEventListener).mock.calls.length;
  const endpoint = await createNativeIrohEndpoint({ secretKey: key });
  const socket = await endpoint.connect({ endpointId: peer }, 1000);
  const closed = jest.fn();
  socket.on('close', closed);
  const listener = jest.mocked(AppState.addEventListener).mock.calls[before][1];
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  listener('background');
  now.mockReturnValue(32000);
  listener('active');
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(closed).toHaveBeenCalled();
  expect(bridge.bind).toHaveBeenCalledTimes(2);
  expect(bridge.bind.mock.calls[1][1]).toBe(bridge.bind.mock.calls[0][1]);
  expect(bridge.bind.mock.calls[1][0]).not.toBe(bridge.bind.mock.calls[0][0]);
  expect(endpoint.address().endpointId).toBe(id);
  await endpoint.close();
});

test('a build missing the native module reports an explicit error', async () => {
  delete NativeModules.ChicoryIroh;
  await expect(createNativeIrohEndpoint({ secretKey: key })).rejects.toThrow(
    'does not include',
  );
});

test('closing during resume cleanup cannot bind an endpoint afterward', async () => {
  const before = jest.mocked(AppState.addEventListener).mock.calls.length;
  const endpoint = await createNativeIrohEndpoint({ secretKey: key });
  let finish!: () => void;
  bridge.closeEndpoint.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const listener = jest.mocked(AppState.addEventListener).mock.calls[before][1];
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  listener('background');
  now.mockReturnValue(32000);
  listener('active');
  await Promise.resolve();
  const closing = endpoint.close();
  finish();
  await closing;
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(bridge.bind).toHaveBeenCalledTimes(1);
});

test('a resume bind that times out during cleanup cannot start later', async () => {
  jest.useFakeTimers();
  const before = jest.mocked(AppState.addEventListener).mock.calls.length;
  const endpoint = await createNativeIrohEndpoint({ secretKey: key });
  let finish!: () => void;
  bridge.closeEndpoint.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const listener = jest.mocked(AppState.addEventListener).mock.calls[before][1];
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  listener('background');
  now.mockReturnValue(32000);
  listener('active');
  await jest.advanceTimersByTimeAsync(15001);
  finish();
  await jest.advanceTimersByTimeAsync(0);
  expect(bridge.bind).toHaveBeenCalledTimes(1);
  await endpoint.close();
});

test.each([
  ['ios', 2000],
  ['android', 60000],
] as const)(
  'keeps %s connections alive after %d ms away',
  async (os, elapsed) => {
    Platform.OS = os;
    const before = jest.mocked(AppState.addEventListener).mock.calls.length;
    const endpoint = await createNativeIrohEndpoint({ secretKey: key });
    const socket = await endpoint.connect({ endpointId: peer }, 1000);
    const closed = jest.fn();
    socket.on('close', closed);
    const listener = jest.mocked(AppState.addEventListener).mock.calls[
      before
    ][1];
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    listener('background');
    now.mockReturnValue(1000 + elapsed);
    listener('active');
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    expect(bridge.bind).toHaveBeenCalledTimes(1);
    await endpoint.close();
  },
);
