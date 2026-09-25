import { activityOf, hex } from '../../../../test-support/fixtures';
import {
  clearHeldRequests,
  heldRequest,
  heldVersion,
  holdRequest,
  normalizeRequest,
  paymentHashOf,
  subscribeHeld,
} from '../../../stage/heldRequests';

/**
 * The held set (REDESIGN.md rule 6): a request whose payment is pending or
 * of unknown outcome cannot be paid again. The set lives as long as the
 * process, so each test starts with it empty.
 */
beforeEach(() => clearHeldRequests());
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

test('reads the payment hash of a real invoice, as the BOLT 11 examples give it', () => {
  // The specification's example invoices, whose payment hash is the bytes
  // 00 to 09 over and over, ending 01 02.
  const hash =
    '0001020304050607080900010203040506070809000102030405060708090102';
  const donation =
    'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
  const coffee =
    'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';
  expect(paymentHashOf(donation)).toBe(hash);
  expect(paymentHashOf(coffee)).toBe(hash);
  expect(paymentHashOf(`bitcoin:bc1qaddress?lightning=${coffee}`)).toBe(hash);
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

test('a payment going out is held against an earlier attempt the history shows settled', () => {
  const hash = hex(8);
  const request = invoice(hash, 8);
  const earlier = activityOf('sent', 'failed', { paymentHash: hash });
  holdRequest(request, { status: 'pending', calling: true });
  // The call has not answered: the failed attempt is an older one.
  expect(heldRequest(request, [earlier])).toEqual({ status: 'pending' });
  expect(heldRequest(request)).toEqual({ status: 'pending' });
  // Its answer is what lets it go.
  holdRequest(request, { status: 'failed' });
  expect(heldRequest(request, [earlier])).toBeNull();
});

test('a screen is told each time this app holds or lets go of a request', () => {
  const heard = jest.fn();
  const stop = subscribeHeld(heard);
  const before = heldVersion();
  holdRequest('lnbc-told', { status: 'pending', calling: true });
  holdRequest('lnbc-told', { status: 'failed' });
  clearHeldRequests();
  expect(heard).toHaveBeenCalledTimes(3);
  expect(heldVersion()).toBe(before + 3);
  stop();
  holdRequest('lnbc-told', { status: 'uncertain' });
  expect(heard).toHaveBeenCalledTimes(3);
});

test('nothing holds an empty request', () => {
  holdRequest('  ', { status: 'uncertain' });
  expect(heldRequest('  ')).toBeNull();
});
