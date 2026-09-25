import { activityOf, hex } from '../../../../test-support/fixtures';
import {
  heldRequest,
  holdRequest,
  normalizeRequest,
  paymentHashOf,
} from '../../../stage/heldRequests';

/**
 * The held set (REDESIGN.md rule 6): a request whose payment is pending or
 * of unknown outcome cannot be paid again. Each test uses requests of its
 * own, since the set lives as long as the process.
 */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** Bytes as five-bit words, zero padded, as bolt11 writes a field. */
function words(bytes: string): number[] {
  const bits = [...bytes.match(/../g)!]
    .map(byte => parseInt(byte, 16).toString(2).padStart(8, '0'))
    .join('');
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
  return padded.match(/.{5}/g)!.map(group => parseInt(group, 2));
}

/** A tagged field: its type, its length in two words, then its data. */
const field = (tag: number, data: number[]) => [
  tag,
  Math.floor(data.length / 32),
  data.length % 32,
  ...data,
];

/**
 * An invoice shaped as bolt11 lays one out, carrying `hash` as its payment
 * hash after a payment secret. The signature and checksum are not real.
 */
function invoice(hash: string, seed = 0): string {
  const data = [
    ...Array(7).fill(seed % 32),
    ...field(16, words(hex(seed + 900))),
    ...field(1, words(hash)),
    ...Array(104).fill(0),
    ...Array(6).fill(0),
  ];
  return `lnbcrt10u1${data.map(word => CHARSET[word]).join('')}`;
}

test('a request is one request however it was copied', () => {
  const bare = invoice(hex(1));
  expect(normalizeRequest(`  LIGHTNING:${bare.toUpperCase()} `)).toBe(bare);
  expect(normalizeRequest('bitcoin:BCRT1QXYZ?amount=0.001')).toBe(
    'bcrt1qxyz?amount=0.001',
  );
});

test('reads the payment hash of an invoice, bare or inside a Bitcoin link', () => {
  const hash = hex(2);
  const bare = invoice(hash, 2);
  expect(paymentHashOf(bare)).toBe(hash);
  expect(paymentHashOf(`lightning:${bare.toUpperCase()}`)).toBe(hash);
  expect(paymentHashOf(`bitcoin:bcrt1qaddress?lightning=${bare}`)).toBe(hash);
  expect(paymentHashOf('bcrt1qaddress')).toBeNull();
  expect(paymentHashOf('lnbc-request')).toBeNull();
  expect(paymentHashOf('')).toBeNull();
});

test('a payment of unknown outcome holds its request, in every spelling', () => {
  const request = invoice(hex(3), 3);
  holdRequest(request, { status: 'uncertain' });
  for (const spelling of [
    request,
    ` ${request} `,
    request.toUpperCase(),
    `lightning:${request}`,
  ]) {
    expect(heldRequest(spelling)).toEqual({ status: 'uncertain' });
  }
});

test('a pending payment holds too, and an outcome lets it go', () => {
  for (const status of ['completed', 'failed'] as const) {
    const request = `bitcoin:bcrt1q${status}`;
    holdRequest(request, { status: 'pending', txid: hex(40) });
    expect(heldRequest(request)).toEqual({ status: 'pending' });
    holdRequest(request, { status });
    expect(heldRequest(request)).toBeNull();
  }
});

test('the history holds a request whose invoice it shows unsettled', () => {
  const hash = hex(5);
  const request = invoice(hash, 5);
  for (const status of ['pending', 'uncertain'] as const) {
    const item = activityOf('sent', status, { paymentHash: hash });
    expect(heldRequest(request, [item])).toEqual({ status, item });
  }
  // Settled, or money that came in rather than went out, holds nothing.
  expect(
    heldRequest(request, [
      activityOf('sent', 'completed', { paymentHash: hash }),
    ]),
  ).toBeNull();
  expect(
    heldRequest(request, [
      activityOf('received', 'pending', { paymentHash: hash }),
    ]),
  ).toBeNull();
});

test('the history lets go of a request once it shows the payment settled', () => {
  const hash = hex(6);
  const request = invoice(hash, 6);
  holdRequest(request, { status: 'uncertain', paymentHash: hash });
  const item = activityOf('sent', 'uncertain', { paymentHash: hash });
  expect(heldRequest(request, [item])).toEqual({ status: 'uncertain', item });
  expect(heldRequest(request, [{ ...item, status: 'completed' }])).toBeNull();
  // Settled for good: without the history, it stays let go.
  expect(heldRequest(request)).toBeNull();
});

test('an on-chain payment is found in the history by its transaction', () => {
  const txid = hex(7);
  const request = 'bitcoin:bcrt1qonchain?amount=0.0001';
  holdRequest(request, { status: 'pending', txid });
  const item = activityOf('sent', 'pending', { rail: 'chain', txid });
  expect(heldRequest(request, [item])).toEqual({ status: 'pending', item });
  expect(heldRequest(request, [{ ...item, status: 'completed' }])).toBeNull();
});

test('nothing holds an empty request', () => {
  holdRequest('  ', { status: 'uncertain' });
  expect(heldRequest('  ')).toBeNull();
});
