import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { snapshotOf } from '../../../../test-support/fixtures';
import {
  alreadySubmitted,
  amountTone,
  fixedAmount,
  isUncertain,
  requestRail,
  requestRefusal,
  resultVisual,
  reviewRail,
  sendFailure,
  shortRequest,
} from '../model';

/** Send's state-to-visual map (REDESIGN.md 6, Send and Engine errors). */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('a request', () => {
  test('fixes its amount, or leaves it to the payer', () => {
    expect(fixedAmount(INVOICE)).toBe(24_425);
    expect(fixedAmount(`bitcoin:${ADDRESS}?lightning=${INVOICE}`)).toBe(24_425);
    expect(fixedAmount(`bitcoin:${ADDRESS}?amount=0.001`)).toBe(100_000);
    expect(fixedAmount(ADDRESS)).toBeNull();
    expect(fixedAmount('lnbc-typed')).toBeNull();
  });

  test('goes over Lightning when it can, on chain otherwise', () => {
    expect(requestRail(INVOICE)).toBe('bolt');
    expect(requestRail(`bitcoin:${ADDRESS}?lightning=${INVOICE}`)).toBe('bolt');
    expect(requestRail(`bitcoin:${ADDRESS}?amount=0.001`)).toBe('chain');
    expect(requestRail('lnbc-typed')).toBeNull();
  });

  test('shows where it pays, grouped and shortened in the middle', () => {
    expect(shortRequest(`bitcoin:${ADDRESS}?amount=0.001`)).toBe(
      'bc1q ar0s … zzwf 5mdq',
    );
    expect(shortRequest(INVOICE)).toBe('lnbc 2442 … qqw5 3adf');
    expect(shortRequest(' lnbc-typed ')).toBe('lnbc -typ ed');
  });
});

test('an amount is measured against what can be sent and what is held', () => {
  const { balance } = snapshotOf();
  expect(amountTone(0, balance)).toBe('plain');
  expect(amountTone(balance.availableSats, balance)).toBe('plain');
  expect(amountTone(balance.availableSats + 1, balance)).toBe('over-spendable');
  expect(amountTone(balance.totalSats, balance)).toBe('over-spendable');
  expect(amountTone(balance.totalSats + 1, balance)).toBe('over-total');
  expect(amountTone(1_000_000)).toBe('plain');
});

describe('a request as it is entered', () => {
  const LNURL =
    'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS';

  test.each([
    ['an LNURL', LNURL, 'LNURL_UNSUPPORTED'],
    [
      'a Lightning address',
      'user@example.com',
      'LIGHTNING_ADDRESS_UNSUPPORTED',
    ],
    ['words', 'demo', 'NOT_PAYABLE'],
  ])('is refused with a cross when it is %s', (_, request, code) => {
    expect(requestRefusal(request)).toMatchObject({
      code,
      target: 'request',
      tone: 'radish',
      glyphs: ['cross'],
      haptic: 'error',
    });
    expect(requestRefusal(request)?.message).toBeTruthy();
  });

  test('is taken when it reads as a payment, and nothing is nothing to refuse', () => {
    expect(requestRefusal(INVOICE)).toBeNull();
    expect(requestRefusal(`bitcoin:${ADDRESS}?amount=0.001`)).toBeNull();
    expect(requestRefusal(` ${ADDRESS} `)).toBeNull();
    expect(requestRefusal('')).toBeNull();
    expect(requestRefusal('   ')).toBeNull();
  });
});

test('a review names the rail it settled on', () => {
  const review = { route: 'lightning' } as SendReview;
  expect(reviewRail(review)).toEqual({
    glyph: 'bolt',
    label: copy.send.lightning,
  });
  expect(reviewRail({ ...review, route: 'bitcoin' })).toEqual({
    glyph: 'chain',
    label: copy.send.bitcoin,
  });
  expect(
    reviewRail({ ...review, route: 'bitcoin', method: 'direct-funding' }),
  ).toEqual({ glyph: 'fund', label: copy.send.directFunding });
});

describe('an engine error', () => {
  const { balance } = snapshotOf();
  const failure = (code: string, amountSats: number | null = 4_200) =>
    sendFailure(Object.assign(new Error('said'), { code }), {
      message: 'said',
      amountSats,
      balance,
    });
  const shape = (code: string, amountSats?: number | null) => {
    const { target, tone, glyphs, shake } = failure(code, amountSats);
    return { target, tone, glyphs, shake };
  };

  test.each([
    ['BOLT11_CHECKSUM', 'request', 'radish', ['cross']],
    ['ADDR_V0_LENGTH', 'request', 'radish', ['cross']],
    ['LNURL_UNSUPPORTED', 'request', 'radish', ['cross']],
    ['OFFER_NOT_QUOTABLE', 'request', 'radish', ['cross']],
    ['PRIMARY_DOWN', 'control', 'honey', ['unplug']],
    ['NO_ROUTE', 'control', 'radish', ['bolt', 'cross']],
    ['FUNDING_UNCONFIRMED', 'control', 'honey', ['chain', 'clock']],
    ['QUOTE_EXPIRED', 'control', 'honey', ['refresh']],
    ['AMOUNT_REQUIRED', 'amount', 'radish', ['bang']],
    ['SOMETHING_NEW', 'control', 'radish', ['bang']],
    ['', 'control', 'radish', ['bang']],
  ])('%p shows at the %s in %s', (code, target, tone, glyphs) => {
    expect(shape(code)).toEqual({
      target,
      tone,
      glyphs,
      shake: tone === 'radish',
    });
  });

  test('short of funds is honey within what the wallet holds, radish past it', () => {
    expect(shape('INSUFFICIENT_FUNDS', balance.totalSats)).toMatchObject({
      target: 'amount',
      tone: 'honey',
      shake: false,
    });
    expect(shape('INSUFFICIENT_FUNDS', balance.totalSats + 1)).toMatchObject({
      target: 'amount',
      tone: 'radish',
      shake: true,
    });
  });

  test('carries the words and the code, and radish is felt as an error', () => {
    expect(failure('NO_ROUTE')).toMatchObject({
      code: 'NO_ROUTE',
      message: 'said',
      haptic: 'error',
    });
    expect(failure('PRIMARY_DOWN').haptic).toBe('warning');
  });

  test('that means the payment may have gone out is never an error', () => {
    const coded = (code: string) => Object.assign(new Error(), { code });
    expect(isUncertain(coded('RESULT_UNCERTAIN'))).toBe(true);
    expect(isUncertain(coded('ALREADY_SUBMITTED'))).toBe(true);
    expect(isUncertain(coded('NO_ROUTE'))).toBe(false);
    expect(isUncertain(new Error('plain'))).toBe(false);
    expect(isUncertain(null)).toBe(false);
  });

  test('holds a request it prepares only when a payment for it is out', () => {
    const coded = (code: string) => Object.assign(new Error(), { code });
    expect(alreadySubmitted(coded('ALREADY_SUBMITTED'))).toBe(true);
    // Preparing pays nothing, so a prepare without an answer holds nothing.
    expect(alreadySubmitted(coded('RESULT_UNCERTAIN'))).toBe(false);
    expect(alreadySubmitted(new Error('plain'))).toBe(false);
  });
});

describe('a result', () => {
  const STATUSES: SendResult['status'][] = [
    'completed',
    'pending',
    'uncertain',
    'failed',
  ];

  test('each outcome has a shape and a colour of its own', () => {
    const looks = STATUSES.map(status => resultVisual(status));
    expect(new Set(looks.map(look => look.shape)).size).toBe(STATUSES.length);
    expect(new Set(looks.map(look => look.tone)).size).toBe(STATUSES.length);
  });

  test('unknown is held in honey and never reads as done', () => {
    expect(resultVisual('uncertain')).toMatchObject({
      shape: 'held',
      tone: 'honey',
      glyph: 'pause',
      title: copy.send.unknown,
      returnsHome: false,
    });
  });

  test('only a completed payment goes home on its own', () => {
    expect(STATUSES.filter(status => resultVisual(status).returnsHome)).toEqual(
      ['completed'],
    );
  });
});
