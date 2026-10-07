/* eslint-disable no-bitwise -- a seeded byte generator */
import { Buffer } from 'buffer';
import { fromBase64 } from '../src/embedded/base64';

const bytes = (size: number, seed: number) => {
  const out = new Uint8Array(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
};

test('reads every length and byte value exactly as buffer does', () => {
  for (let size = 0; size <= 300; size++) {
    const data = bytes(size, size + 1);
    const text = Buffer.from(data).toString('base64');
    const read = fromBase64(text);
    expect(Buffer.isBuffer(read)).toBe(true);
    expect([...read]).toEqual([...data]);
  }
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  expect([...fromBase64(Buffer.from(all).toString('base64'))]).toEqual([
    ...all,
  ]);
});

test('reads a 64 KiB chunk, the largest a read returns', () => {
  const data = bytes(65536, 7);
  expect(
    fromBase64(Buffer.from(data).toString('base64')).equals(Buffer.from(data)),
  ).toBe(true);
});

test('leaves anything but padded standard base64 to buffer', () => {
  for (const text of [
    'QUJD\nREVG',
    'QUJDREVG ',
    'QUJDRA',
    'QUJDRA=',
    '-_-_',
    'QU=D',
    '====',
    'A===',
    'QUJDéEVG',
    'QR==',
    'QUJ=',
  ]) {
    expect([...fromBase64(text)]).toEqual([...Buffer.from(text, 'base64')]);
  }
});
