import { activityOf, hex } from '../../../../test-support/fixtures';
import {
  clearHeldRequests,
  heldRequest,
  heldVersion,
  holdRequest,
  normalizeRequest,
  paidOnce,
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

test('a pending payment holds too, and an outcome lets a request that may be paid again go', () => {
  for (const status of ['completed', 'failed'] as const) {
    const request = `bitcoin:bcrt1q${status}`;
    holdRequest(request, { status: 'pending', txid: hex(40) });
    expect(heldRequest(request)).toEqual({ status: 'pending' });
    holdRequest(request, { status });
    expect(heldRequest(request)).toBeNull();
  }
});

test('an invoice, or a Bitcoin request that names its amount, is paid once', () => {
  expect(paidOnce(invoice(hex(9), 9))).toBe(true);
  expect(paidOnce(`LIGHTNING:${invoice(hex(9), 9).toUpperCase()}`)).toBe(true);
  expect(paidOnce('bitcoin:bcrt1qonce?amount=0.0001')).toBe(true);
  expect(paidOnce('BITCOIN:BCRT1QONCE?label=x&amount=0.5')).toBe(true);
  expect(paidOnce(`bitcoin:bcrt1qonce?lightning=${invoice(hex(9), 9)}`)).toBe(
    true,
  );
  // An address, or a request that leaves the amount to the payer, may be
  // paid again, and so may an offer.
  expect(paidOnce('bcrt1qagain')).toBe(false);
  expect(paidOnce('bitcoin:bcrt1qagain')).toBe(false);
  expect(paidOnce('bitcoin:bcrt1qagain?label=amount')).toBe(false);
  expect(paidOnce('bitcoin:bcrt1qagain?amount=0')).toBe(false);
  expect(paidOnce('lno1offer')).toBe(false);
});

test('a request paid once is held paid for good as soon as its payment completes, before the history shows it', () => {
  const hash = hex(10);
  const request = invoice(hash, 10);
  holdRequest(request, { status: 'pending', calling: true });
  holdRequest(request, { status: 'completed' });
  // The history has not been read since: nothing shows the payment yet.
  expect(heldRequest(request)).toEqual({ status: 'completed' });
  expect(heldRequest(`lightning:${request}`, [])).toEqual({
    status: 'completed',
  });
  // Or it still shows it going out, from a read made before it landed.
  const going = activityOf('sent', 'pending', { paymentHash: hash });
  expect(heldRequest(request, [going])).toEqual({ status: 'completed' });
  // Once the history shows it done, the request points at that payment.
  const done = { ...going, status: 'completed' as const };
  expect(heldRequest(request, [done])).toEqual({
    status: 'completed',
    item: done,
  });
});

test('a Bitcoin request that names its amount is held paid, and a bare address is let go', () => {
  const priced = 'bitcoin:bcrt1qpriced?amount=0.0001';
  holdRequest(priced, { status: 'completed', txid: hex(11) });
  expect(heldRequest(priced)).toEqual({ status: 'completed' });
  const bare = 'bcrt1qbare';
  holdRequest(bare, { status: 'pending', txid: hex(12) });
  holdRequest(bare, { status: 'completed', txid: hex(12) });
  expect(heldRequest(bare)).toBeNull();
});

test('a failed payment moved no money, so its request may be paid again', () => {
  const request = invoice(hex(13), 13);
  holdRequest(request, { status: 'pending', calling: true });
  holdRequest(request, { status: 'failed' });
  expect(heldRequest(request)).toBeNull();
});

test('the history holds a request whose invoice it shows unsettled', () => {
  const hash = hex(5);
  const request = invoice(hash, 5);
  for (const status of ['pending', 'uncertain'] as const) {
    const item = activityOf('sent', status, { paymentHash: hash });
    expect(heldRequest(request, [item])).toEqual({ status, item });
  }
  // Failed, or money that came in rather than went out, holds nothing.
  expect(
    heldRequest(request, [activityOf('sent', 'failed', { paymentHash: hash })]),
  ).toBeNull();
  expect(
    heldRequest(request, [
      activityOf('received', 'pending', { paymentHash: hash }),
    ]),
  ).toBeNull();
});

test('the history lets go of a request once it shows the payment failed', () => {
  const hash = hex(6);
  const request = invoice(hash, 6);
  holdRequest(request, { status: 'uncertain', paymentHash: hash });
  const item = activityOf('sent', 'uncertain', { paymentHash: hash });
  expect(heldRequest(request, [item])).toEqual({ status: 'uncertain', item });
  // The row as it reads once the attempt has failed, which is after it began.
  const failed = { ...item, status: 'failed' as const, timestamp: Date.now() };
  expect(heldRequest(request, [failed])).toBeNull();
  // Settled for good: without the history, it stays let go.
  expect(heldRequest(request)).toBeNull();
});

test('the history alone knows an invoice paid, and holds it paid from then on', () => {
  const hash = hex(14);
  const request = invoice(hash, 14);
  const paid = activityOf('sent', 'completed', { paymentHash: hash });
  // Paid before this process, or from another device: this app saw nothing.
  expect(heldRequest(request, [paid])).toEqual({
    status: 'completed',
    item: paid,
  });
  expect(heldRequest(request)).toEqual({ status: 'completed' });
});

test('an on-chain payment is found in the history by its transaction', () => {
  const txid = hex(7);
  const request = 'bitcoin:bcrt1qonchain?amount=0.0001';
  holdRequest(request, { status: 'pending', txid });
  const item = activityOf('sent', 'pending', { rail: 'chain', txid });
  expect(heldRequest(request, [item])).toEqual({ status: 'pending', item });
  // It names its amount, so once confirmed it is paid.
  const done = { ...item, status: 'completed' as const };
  expect(heldRequest(request, [done])).toEqual({
    status: 'completed',
    item: done,
  });
  // A bare address is let go once its payment completes.
  const bare = 'bcrt1qonchainbare';
  holdRequest(bare, { status: 'pending', txid: hex(15) });
  const sent = activityOf('sent', 'completed', {
    rail: 'chain',
    txid: hex(15),
  });
  expect(heldRequest(bare, [sent])).toBeNull();
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

test('an answered attempt is held against an older failed attempt the history still shows', () => {
  for (const status of ['pending', 'uncertain'] as const) {
    clearHeldRequests();
    const hash = hex(16);
    const request = invoice(hash, 16);
    // The usual retry: the history shows the attempt that failed before.
    const earlier = activityOf('sent', 'failed', {
      paymentHash: hash,
      timestamp: Date.now() - 60_000,
    });
    holdRequest(request, { status: 'pending', calling: true });
    holdRequest(request, { status });
    expect(heldRequest(request, [earlier])).toEqual({ status });
    expect(heldRequest(request, [])).toEqual({ status });
    // A row as new as this attempt speaks for it.
    const now = { ...earlier, timestamp: Date.now() };
    expect(heldRequest(request, [now])).toBeNull();
  }
});

test('an invoice is one request bare, with its scheme, or inside a Bitcoin link', () => {
  const hash = hex(17);
  const bare = invoice(hash, 17);
  const unified = `bitcoin:bcrt1qunified?amount=0.00001&lightning=${bare}`;
  holdRequest(unified, { status: 'pending', calling: true });
  expect(heldRequest(bare)).toEqual({ status: 'pending' });
  expect(heldRequest(`LIGHTNING:${bare.toUpperCase()}`)).toEqual({
    status: 'pending',
  });
  holdRequest(unified, { status: 'completed' });
  expect(heldRequest(bare)).toEqual({ status: 'completed' });
  clearHeldRequests();
  holdRequest(bare, { status: 'completed' });
  expect(heldRequest(unified)).toEqual({ status: 'completed' });
});

test('a Bitcoin request is its address and amount, whatever its label or order', () => {
  const priced = 'bitcoin:bcrt1qpricedkey?amount=0.0001';
  holdRequest(priced, { status: 'uncertain' });
  for (const spelling of [
    'bitcoin:bcrt1qpricedkey?label=coffee&amount=0.0001',
    'BITCOIN:BCRT1QPRICEDKEY?amount=0.00010000&message=hi',
    'bcrt1qpricedkey?amount=.0001',
  ]) {
    expect(heldRequest(spelling)).toEqual({ status: 'uncertain' });
  }
  // Another amount, or the bare address, is another request.
  expect(heldRequest('bitcoin:bcrt1qpricedkey?amount=0.0002')).toBeNull();
  expect(heldRequest('bcrt1qpricedkey')).toBeNull();
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
