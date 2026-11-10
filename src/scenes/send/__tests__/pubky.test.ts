import { parsePayment } from '@beignet/wallet-core';
import { refusal } from '../../../components/Scanner';
import { copy } from '../../../design/copy';
import {
  LookupError,
  endpointsOf,
  lookupPaymentList,
  setPaymentListLookup,
} from '../../../services/paykit';
import { invoiceExpiry } from '../../../stage/heldRequests';
import { autoPayCandidate } from '../autoPay';
import {
  fixedAmount,
  lookupFailure,
  requestRail,
  requestRefusal,
  reviewOpensLive,
  shortRequest,
} from '../model';
import {
  EXPIRY_MARGIN_MS,
  fallbacks,
  payableEndpoints,
  pubkyOf,
} from '../pubky';

/**
 * A pubky as Send reads it (REDESIGN.md 6, Send): recognized only in the
 * forms paykit-discovery takes and only where the parser refuses the text,
 * and paid through the first endpoint this wallet can pay.
 */

/** The owner in paykit-discovery's fixtures/discovery.json. */
const KEY = '5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const REGTEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
// BOLT 11's own vectors, both stamped 1496314658: one naming no amount or
// expiry, and 2500u (250,000 sats) expiring a minute on.
const STAMP_MS = 1_496_314_658_000;
const DONATION =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
const COFFEE =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';

const endpoint = (identifier: string, payload: string, appId = 'bitkit') => ({
  appId,
  identifier,
  payload,
});

describe('recognition', () => {
  test.each([
    ['the bare key', KEY],
    ['pubky<key>', `pubky${KEY}`],
    ['pubky://<key>', `pubky://${KEY}`],
    ['space around it', `  pubky://${KEY}\n`],
  ])('%s is a pubky, not a refusal', (_, text) => {
    expect(parsePayment(text.trim()).kind).toBe('invalid');
    expect(pubkyOf(text)).toBe(KEY);
    expect(requestRefusal(text)).toBeNull();
    expect(refusal(text.trim())).toBeNull();
    expect(shortRequest(text)).toBe(shortRequest(KEY));
    // No rail, no amount, no live review and no auto-pay until it resolves.
    expect(requestRail(text)).toBeNull();
    expect(fixedAmount(text)).toBeNull();
    expect(reviewOpensLive(text)).toBe(false);
    expect(autoPayCandidate(text)).toBe(false);
  });

  test.each([
    ['a path', `pubky://${KEY}/pub/paykit`],
    ['a query', `pubky://${KEY}?amount=1`],
    ['a fragment', `${KEY}#top`],
    ['a wrong alphabet', `${KEY.slice(0, 51)}l`],
    ['capitals', KEY.toUpperCase()],
    ['51 characters', KEY.slice(1)],
    ['53 characters', `y${KEY}`],
    ['an ending no key has', `${KEY.slice(0, 51)}b`],
    ['another scheme', `pk:${KEY}`],
  ])('%s is refused as it is today', (_, text) => {
    expect(pubkyOf(text)).toBeNull();
    expect(requestRefusal(text)).toEqual(
      expect.objectContaining({ target: 'request', glyphs: ['cross'] }),
    );
    expect(refusal(text)).toContain(copy.scan.invalid);
  });

  test.each([
    ADDRESS,
    `bitcoin:${ADDRESS}?amount=0.001`,
    DONATION,
    COFFEE,
    `lightning:${COFFEE}`,
    `bitcoin:${ADDRESS}?lightning=${COFFEE}`,
  ])('a request the parser takes is never a pubky: %s', text => {
    expect(parsePayment(text).kind).not.toBe('invalid');
    expect(pubkyOf(text)).toBeNull();
  });
});

describe('an invoice expiry', () => {
  test('is the timestamp and the expiry it names, or an hour', () => {
    expect(invoiceExpiry(COFFEE)).toBe(STAMP_MS + 60_000);
    expect(invoiceExpiry(DONATION)).toBe(STAMP_MS + 3_600_000);
    expect(invoiceExpiry(COFFEE.toUpperCase())).toBe(STAMP_MS + 60_000);
    expect(invoiceExpiry(ADDRESS)).toBeNull();
  });
});

describe('selection', () => {
  const list = [
    endpoint('btc-lightning-bolt12', 'lno1qcp4256ypq'),
    endpoint('btc-bitcoin-p2wpkh', ADDRESS),
    endpoint('lnurl-pay', 'LNURL1DP68GURN8GHJ7'),
    endpoint('btc-lightning-bolt11', JSON.stringify({ value: DONATION })),
    endpoint('btc-regtest-p2wpkh', REGTEST),
    endpoint('usdt-tron', 'TXYZ'),
    endpoint('btc-lightning-bolt11', COFFEE, 'savings'),
  ];

  test('Lightning first, then on chain, each in discovery order, and the rest skipped', () => {
    // A second on, the minute-long invoice is inside the margin.
    const options = payableEndpoints(list, 'mainnet', STAMP_MS + 1_000);
    expect(options.map(option => [option.rail, option.request])).toEqual([
      ['bolt', DONATION],
      ['chain', ADDRESS],
    ]);
    expect(options[0].amountSats).toBeNull();
    expect(options[0].endpoint).toBe(list[3]);
  });

  test('an invoice with time to run is offered with its amount, and one about to run out is not', () => {
    const early = STAMP_MS + 60_000 - EXPIRY_MARGIN_MS - 1;
    expect(
      payableEndpoints([list[6]], 'mainnet', early).map(o => o.amountSats),
    ).toEqual([250_000]);
    expect(payableEndpoints([list[6]], 'mainnet', early + 2)).toEqual([]);
  });

  test('an expired invoice beside an address leaves the address', () => {
    const options = payableEndpoints(list, 'mainnet', STAMP_MS + 7_200_000);
    expect(options.map(option => option.request)).toEqual([ADDRESS]);
  });

  test('only the wallet network is payable', () => {
    expect(
      payableEndpoints(list, 'regtest', STAMP_MS).map(o => o.request),
    ).toEqual([REGTEST]);
    expect(payableEndpoints(list, 'testnet', STAMP_MS)).toEqual([]);
  });

  test('a payload on another rail than its identifier names is not payable', () => {
    expect(
      payableEndpoints(
        [
          endpoint('btc-lightning-bolt11', ADDRESS),
          endpoint('btc-bitcoin-p2wpkh', DONATION),
          endpoint('btc-bitcoin-p2tr', '{"value":7}'),
          endpoint('btc-bitcoin-p2tr', '{broken'),
        ],
        'mainnet',
        STAMP_MS,
      ),
    ).toEqual([]);
  });

  test('later endpoints are fallen back on only when Lightning could not carry the amount', () => {
    const options = payableEndpoints(
      [
        endpoint('btc-lightning-bolt11', DONATION),
        endpoint('btc-bitcoin-p2wpkh', `bitcoin:${ADDRESS}?amount=0.00001`),
        endpoint('btc-bitcoin-p2tr', ADDRESS),
        endpoint('btc-lightning-bolt11', COFFEE),
      ],
      'mainnet',
      STAMP_MS - 1,
    );
    expect(options.map(option => option.rail)).toEqual([
      'bolt',
      'bolt',
      'chain',
      'chain',
    ]);
    expect(fallbacks(options, 0, 'NO_ROUTE', 5_000)).toEqual([3]);
    // The other invoice comes before the addresses.
    expect(fallbacks(options, 0, 'NO_ROUTE', 250_000)).toEqual([1, 3]);
    expect(fallbacks(options, 0, 'INSUFFICIENT_FUNDS', 1_000)).toEqual([2, 3]);
    expect(fallbacks(options, 0, 'INVOICE_EXPIRED', 5_000)).toEqual([3]);
    expect(fallbacks(options, 0, 'PRIMARY_DOWN', 5_000)).toEqual([]);
    expect(fallbacks(options, 3, 'NO_ROUTE', 5_000)).toEqual([]);
  });
});

describe('the lookup boundary', () => {
  afterEach(() => {
    setPaymentListLookup(null);
    jest.useRealTimers();
  });

  // The records of paykit-discovery's fixtures/discovery.json, in its order.
  const fixture = [
    endpoint('btc-bitcoin-p2tr', 'fixture:savings:p2tr', 'savings'),
    endpoint('btc-lightning-bolt12', 'fixture:bitkit:bolt12'),
    endpoint('btc-bitcoin-p2tr', 'fixture:bitkit:p2tr'),
    endpoint('btc-lightning-bolt12', 'fixture:savings:bolt12', 'savings'),
  ];

  test('keeps every record, field and the order it was given', async () => {
    const lookup = jest.fn().mockResolvedValue(fixture);
    setPaymentListLookup(lookup);
    await expect(lookupPaymentList(KEY)).resolves.toEqual(fixture);
    expect(lookup).toHaveBeenCalledWith(KEY);
    expect(endpointsOf(JSON.stringify(fixture))).toEqual(fixture);
    expect(endpointsOf('[]')).toEqual([]);
  });

  test('refuses an answer that is not a list of endpoints', () => {
    for (const answer of ['', '{}', 'null', '[{"appId":"a"}]', undefined]) {
      expect(() => endpointsOf(answer)).toThrow(LookupError);
    }
  });

  test('without the native module the lookup fails, and names why', async () => {
    await expect(lookupPaymentList(KEY)).rejects.toMatchObject({
      code: 'LOOKUP_UNAVAILABLE',
    });
  });

  test('a rejection is passed on, and no answer in time is a timeout', async () => {
    setPaymentListLookup(() => Promise.reject(new LookupError('X', 'x')));
    await expect(lookupPaymentList(KEY)).rejects.toMatchObject({ code: 'X' });
    jest.useFakeTimers();
    setPaymentListLookup(() => new Promise(() => {}));
    const pending = lookupPaymentList(KEY, 5_000).catch(
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ code: 'LOOKUP_TIMEOUT' });
  });
});

describe('a lookup that ends without a review', () => {
  test('each end has its own mark, and an outage is never the empty one', () => {
    const empty = lookupFailure('PUBKY_NO_ENDPOINTS');
    const unpayable = lookupFailure('PUBKY_NOT_PAYABLE');
    const failed = lookupFailure('PUBKY_LOOKUP_FAILED');
    for (const end of [empty, unpayable, failed]) {
      expect(end.target).toBe('request');
    }
    expect(empty).toMatchObject({
      tone: 'radish',
      glyphs: ['key', 'question'],
    });
    expect(unpayable).toMatchObject({
      tone: 'radish',
      glyphs: ['key', 'cross'],
    });
    expect(failed).toMatchObject({ tone: 'honey', glyphs: ['key', 'unplug'] });
    expect(
      new Set([empty.message, unpayable.message, failed.message]).size,
    ).toBe(3);
  });
});
