import { handleEngineMessage } from '../src/embedded/walletEngineServer';
import { openOwnedDeviceWallet } from '../src/embedded/deviceRuntime';
import { openDeviceWallet, receiveWalletEvent } from '../src/embedded/client';
import { recentDiagnostics } from '../src/services/diagnosticLog';
import { walletHost } from '../src/embedded/walletHostNative';
import { EmbeddedTransportError } from '@beignet/wallet-core';
import { defaultProfile } from '../src/services/networks';
import type { HostRequest } from '../src/embedded/walletHostProtocol';

jest.mock('../src/embedded/deviceRuntime', () => ({
  openOwnedDeviceWallet: jest.fn(),
}));

const settings = defaultProfile('regtest');
const open = (session: string): HostRequest => ({
  op: 'open',
  session,
  perfUntil: 0,
  settings,
});
const request = { method: 'POST' as const, path: '/channel/splice-out' };
const deliver = async (message: HostRequest) =>
  JSON.parse(await handleEngineMessage(JSON.stringify(message)));

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}
function wallet() {
  return {
    request: jest.fn(),
    close: jest.fn(),
    openPaymentNotes: jest.fn(),
    setAppBackgrounded: jest.fn(),
  };
}

test('the vault has one owner across concurrent opens, closes and delayed messages', async () => {
  const a = wallet();
  const b = wallet();
  const closing = gate();
  jest
    .mocked(openOwnedDeviceWallet)
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b);
  a.close.mockReturnValue(closing.wait);
  await expect(deliver(open('first'))).resolves.toEqual({});
  await expect(deliver(open('second'))).resolves.toMatchObject({
    error: { message: 'The device wallet is already open.' },
  });
  await expect(deliver({ op: 'erase' })).resolves.toHaveProperty('error');
  const close = deliver({ op: 'close', session: 'first' });
  const opening = deliver(open('second'));
  await Promise.resolve();
  expect(openOwnedDeviceWallet).toHaveBeenCalledTimes(1);
  closing.release();
  await Promise.all([close, opening]);
  await expect(
    deliver({ op: 'request', session: 'first', request }),
  ).resolves.toMatchObject({ error: { code: 'ENGINE_CLOSED' } });
  await deliver({ op: 'close', session: 'first' });
  b.request.mockResolvedValue({ status: 'pending' });
  await expect(
    deliver({ op: 'request', session: 'second', request }),
  ).resolves.toEqual({ value: { status: 'pending' } });
  expect(b.close).not.toHaveBeenCalled();
  await deliver({ op: 'close', session: 'second' });
});

test('a lost send reply is uncertain and never causes another submission', async () => {
  const owned = wallet();
  jest.mocked(openOwnedDeviceWallet).mockResolvedValueOnce(owned);
  const client = await openDeviceWallet(settings);
  try {
    // Drop the reply after the worker already handled the mutation.
    jest.mocked(walletHost.dispatch).mockImplementationOnce(async payload => {
      await handleEngineMessage(payload);
      throw new Error('Wallet host disconnected');
    });
    const api = client as unknown as {
      _request(path: string, method: string): Promise<unknown>;
    };
    await expect(
      api._request(request.path, request.method),
    ).rejects.toMatchObject({
      code: 'RESULT_UNCERTAIN',
      message: expect.stringContaining('Check Activity'),
      cause: expect.any(EmbeddedTransportError),
    });
    expect(owned.request).toHaveBeenCalledTimes(1);
    jest.mocked(walletHost.dispatch).mockResolvedValueOnce('unreadable');
    await expect(api._request('/api/config', 'GET')).rejects.toMatchObject({
      code: 'ENGINE_UNAVAILABLE',
      cause: expect.any(EmbeddedTransportError),
    });
    // A committed result with an unencodable field is also a lost reply.
    owned.request.mockResolvedValueOnce({ fee: BigInt(1) });
    await expect(
      api._request(request.path, request.method),
    ).rejects.toMatchObject({
      code: 'RESULT_UNCERTAIN',
      cause: expect.any(EmbeddedTransportError),
    });
    owned.request.mockRejectedValueOnce(
      Object.assign(new Error('Channel changed'), {
        code: 'QUOTE_EXPIRED',
        status: 409,
      }),
    );
    await expect(
      api._request(request.path, request.method),
    ).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
      status: 409,
      message: 'Channel changed',
    });
  } finally {
    await client.close();
  }
});

test('only a confirmed missing session signals the owner to unlock again', async () => {
  const owned = wallet();
  jest.mocked(openOwnedDeviceWallet).mockResolvedValueOnce(owned);
  const diagnostic = jest.fn();
  const client = await openDeviceWallet(settings, diagnostic);
  const send = jest.mocked(walletHost.dispatch);
  try {
    send.mockRejectedValueOnce(new Error('Dropped reply'));
    await expect(client.listWallets()).rejects.toMatchObject({
      code: 'ENGINE_UNAVAILABLE',
    });
    expect(diagnostic).not.toHaveBeenCalled();
    const closed = JSON.stringify({
      error: {
        code: 'ENGINE_CLOSED',
        message: 'Unlock the local wallet before continuing.',
      },
    });
    send.mockResolvedValueOnce(closed).mockResolvedValueOnce(closed);
    await expect(client.listWallets()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    await expect(client.listWallets()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledWith({
      phase: 'wallet-session-closed',
      message: 'Unlock the local wallet before continuing.',
    });
  } finally {
    await client.close();
  }
});

test('close accepts the final wallet events without reporting a lost session', async () => {
  const owned = wallet();
  const closing = gate();
  owned.close.mockReturnValue(closing.wait);
  jest.mocked(openOwnedDeviceWallet).mockResolvedValueOnce(owned);
  const diagnostic = jest.fn();
  const client = await openDeviceWallet(settings, diagnostic);
  const notes = client.openPaymentNotes!();
  const closed = client.close();
  try {
    await Promise.resolve();
    await expect(notes.read('mine')).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    const last = jest.mocked(walletHost.dispatch).mock.calls.at(-1)![0];
    const { session } = JSON.parse(last);
    const event = { phase: 'shutdown', message: 'Wallet flushed' };
    receiveWalletEvent(session, JSON.stringify({ type: 'log', event }));
    expect(recentDiagnostics().at(-1)).toMatchObject(event);
    expect(diagnostic).not.toHaveBeenCalled();
  } finally {
    closing.release();
    await closed;
  }
});
