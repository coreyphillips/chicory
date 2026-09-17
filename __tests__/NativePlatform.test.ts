import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import { installNativeBuffer } from '../src/embedded/random';

const { TextDecoder: StrictDecoder, TextEncoder: Encoder } =
  require('text-encoding') as {
    TextDecoder: new (encoding?: string, options?: { fatal?: boolean }) => {
      decode(bytes: Uint8Array): string;
    };
    TextEncoder: new () => { encode(text: string): Uint8Array };
  };

test('the native UTF-8 decoder rejects malformed protocol text and preserves valid Unicode', () => {
  const decoder = new StrictDecoder('utf-8', { fatal: true });
  expect(() => decoder.decode(new Uint8Array([0xc3, 0x28]))).toThrow();
  expect(decoder.decode(new Encoder().encode('Beignet ⚡ café'))).toBe(
    'Beignet ⚡ café',
  );
});

test('native URL parsing preserves WSS hosts, loopback IPv6 and Bitcoin request parameters', () => {
  const relay = new URL('wss://relay.example.com:8790/peer');
  expect(relay.hostname).toBe('relay.example.com');
  expect(relay.protocol).toBe('wss:');
  expect(new URL('https://[::1]:8787').hostname).toBe('[::1]');
  const bitcoin = new URL(
    'bitcoin:bcrt1example?amount=0.00012&lightning=lnbcrt-test',
  );
  expect(bitcoin.searchParams.get('lightning')).toBe('lnbcrt-test');
  expect(bitcoin.searchParams.get('amount')).toBe('0.00012');
});

test('native Buffer subarray preserves binary methods and shares the original byte range', () => {
  const original = Buffer.prototype.subarray;
  const globals = globalThis as unknown as { Buffer: typeof Buffer };
  const originalGlobalBuffer = globals.Buffer;
  try {
    installNativeBuffer();
    const bytes = Buffer.from([0, 18, 52, 99]);
    const view = bytes.subarray(1, 3) as Buffer;
    expect(Buffer.isBuffer(view)).toBe(true);
    expect(view.readUInt16BE(0)).toBe(0x1234);
    view[0] = 42;
    expect(bytes[1]).toBe(42);
    expect(Array.from(bytes.subarray(-2))).toEqual([52, 99]);
    expect(Array.from(bytes.subarray(3, 1))).toEqual([]);
  } finally {
    Buffer.prototype.subarray = original;
    globals.Buffer = originalGlobalBuffer;
  }
});
