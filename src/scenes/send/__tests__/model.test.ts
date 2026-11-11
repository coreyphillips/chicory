import type { FeeRates, SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { snapshotOf } from '../../../../test-support/fixtures';
import {
  alreadySubmitted,
  failureExplanation,
  amountTone,
  amountWords,
  chainStage,
  feeRange,
  fixedAmount,
  heldVisual,
  isRatedReview,
  isUncertain,
  previewFee,
  previewReview,
  rateRefusal,
  rateText,
  requestRail,
  requestRefusal,
  resultVisual,
  reviewFigures,
  reviewOpensLive,
  reviewRail,
  reviewWaiting,
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

  test('shows where it pays, its prefix whole, grouped and shortened in the middle', () => {
    // As every chip draws a value (`chipText`): grouped from the first
    // character, a link's invoice read "lnbc rt30 …" on Send's chip (P10,
    // 23b-link-send-prefilled).
    expect(shortRequest(`bitcoin:${ADDRESS}?amount=0.001`)).toBe(
      'bc1 qar0 … zzwf 5mdq',
    );
    expect(shortRequest(INVOICE)).toBe('lnbc244250n1 qqqq … qqw5 3adf');
    expect(shortRequest(`lightning:${INVOICE}`)).toBe(shortRequest(INVOICE));
    expect(shortRequest(`bitcoin:${ADDRESS}?lightning=${INVOICE}`)).toBe(
      'bc1 qar0 … zzwf 5mdq',
    );
    for (const request of [
      `bitcoin:${ADDRESS}?amount=0.001`,
      INVOICE,
      `lightning:${INVOICE}`,
    ]) {
      expect(shortRequest(request)).not.toMatch(/^(bitc|lnbc )/);
    }
    // The regtest invoice the finding saw, read or not.
    const regtest = `lnbcrt30u1p4td83kp${'x'.repeat(40)}qpw5f2ku`;
    expect(shortRequest(`lightning:${regtest}`)).toBe(
      'lnbcrt30u1 p4td … qpw5 f2ku',
    );
    // What does not read as a request is grouped from its first character.
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

describe('an amount past what can be sent', () => {
  // As the P7 walk found it: the channel's reserve sits between what can be
  // sent and the total, and nothing is on its way.
  const reserved = snapshotOf({
    balance: { totalSats: 67_235, availableSats: 66_543, pendingSats: 0 },
  }).balance;
  // 5,000 on its way, and a 5,000 reserve that never will be.
  const arriving = snapshotOf({
    balance: { totalSats: 70_000, availableSats: 60_000, pendingSats: 5_000 },
  }).balance;

  test('is honey, with its clock, only while what is arriving would cover it', () => {
    expect(amountTone(67_000, reserved)).toBe('over-total');
    expect(amountTone(64_000, arriving)).toBe('over-spendable');
    expect(amountTone(66_000, arriving)).toBe('over-total');
    expect(amountTone(70_001, arriving)).toBe('over-total');
  });

  test('never says the rest is arriving when it is not', () => {
    expect(amountWords('over-total', 67_000, reserved)).toBe(
      `${copy.home.split(66_543, 0)}.`,
    );
    expect(amountWords('over-spendable', 64_000, arriving)).toBe(
      copy.amount.overSpendable,
    );
    expect(amountWords('over-total', 66_000, arriving)).toBe(
      `${copy.home.split(60_000, 5_000)}.`,
    );
    expect(amountWords('over-total', 70_001, arriving)).toBe(
      copy.amount.overTotal,
    );
    expect(amountWords('plain', 1_000, arriving)).toBeNull();
  });

  test('refused by the engine, is radish unless what is arriving would cover it', () => {
    const short = (amountSats: number | null, balance = reserved) =>
      sendFailure(
        Object.assign(new Error('short'), { code: 'INSUFFICIENT_FUNDS' }),
        {
          message: 'short',
          amountSats,
          balance,
        },
      );
    expect(short(67_000)).toMatchObject({
      tone: 'radish',
      glyphs: ['bang'],
      shake: true,
    });
    expect(short(null)).toMatchObject({ tone: 'radish', glyphs: ['bang'] });
    expect(short(64_000, arriving)).toMatchObject({
      tone: 'honey',
      glyphs: ['clock'],
      shake: false,
    });
    expect(short(null, arriving)).toMatchObject({ tone: 'honey' });
  });
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

  test('holds the review back until it can be paid and has an amount', () => {
    expect(reviewWaiting('', false, 0)).toBe(copy.send.reviewWaits);
    expect(reviewWaiting('  ', false, 500)).toBe(copy.send.reviewWaits);
    expect(reviewWaiting(LNURL, true, 500)).toBe(copy.send.reviewRefused);
    expect(reviewWaiting(ADDRESS, false, 0)).toBe(copy.send.amountWaits);
    expect(reviewWaiting(ADDRESS, false, 500)).toBeNull();
  });

  test('opens on a live review only when it names its own amount', () => {
    // Send opens with the amount empty, so only a request's own amount
    // counts; Home draws the landing circle from this.
    expect(reviewOpensLive(INVOICE)).toBe(true);
    expect(reviewOpensLive(`bitcoin:${ADDRESS}?amount=0.001`)).toBe(true);
    expect(reviewOpensLive(`bitcoin:${ADDRESS}?lightning=${INVOICE}`)).toBe(
      true,
    );
    expect(reviewOpensLive(ADDRESS)).toBe(false);
    expect(reviewOpensLive(LNURL)).toBe(false);
    expect(reviewOpensLive('demo')).toBe(false);
    expect(reviewOpensLive('')).toBe(false);
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
    ['WRONG_NETWORK', 'request', 'radish', ['cross']],
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

  test.each([
    ['INVOICE_EXPIRED', copy.send.invoiceExpired],
    ['QUOTE_EXPIRED', copy.send.quoteExpired],
    ['WRONG_NETWORK', copy.send.wrongNetwork],
    ['INSUFFICIENT_FUNDS', 'said'],
    ['UNKNOWN_CODE', 'said'],
  ])(
    '%s offers the applicable explanation and preserves the diagnostic detail',
    (code, explanation) => {
      const refused = failure(code);
      expect(failureExplanation(refused)).toBe(explanation);
      expect(refused.message).toBe('said');
    },
  );

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

  test('only a completed payment goes home on its own, as its status stands', () => {
    expect(STATUSES.filter(status => resultVisual(status).returnsHome)).toEqual(
      ['completed'],
    );
  });

  test('broadcast on chain, a pending payment rests on the done disc with a clock, and goes home', () => {
    // The splice-out of issue 91: the engine answers once the transaction
    // is out, and the orbit stayed up until the screen was closed by hand.
    const sent = resultVisual('pending', 'broadcast');
    expect(sent).toMatchObject({
      shape: 'disc',
      tone: 'cream',
      glyph: 'clock',
      title: copy.send.confirming,
      returnsHome: true,
    });
    // Told from a settled payment by its glyph, with no colour to go on,
    // and from one still in flight by its shape and its words.
    const settled = resultVisual('completed');
    expect(sent.glyph).not.toBe(settled.glyph);
    expect(sent.title).not.toBe(settled.title);
    const flying = resultVisual('pending');
    expect(sent.shape).not.toBe(flying.shape);
    expect(sent.title).not.toBe(flying.title);
    expect(flying.returnsHome).toBe(false);
    // No other outcome reads the stage.
    for (const status of ['completed', 'uncertain', 'failed'] as const) {
      for (const stage of ['broadcast', 'broadcasting'] as const) {
        expect(resultVisual(status, stage, 'chain')).toEqual(
          resultVisual(status),
        );
      }
    }
  });

  test.each(['chain', 'fund'] as const)(
    'broadcasting on the %s rail, a pending payment orbits its rail, not the Lightning arrow, and stays',
    rail => {
      // The engine took the payment and has not named its transaction yet:
      // the splice is still being put together and broadcast.
      const going = resultVisual('pending', 'broadcasting', rail);
      expect(going).toMatchObject({
        shape: 'orbit',
        tone: 'bloom',
        glyph: rail,
        title: copy.send.broadcasting,
        returnsHome: false,
      });
      // Told from a Lightning payment in flight by its glyph and its words,
      // and from the broadcast disc by its shape.
      const flying = resultVisual('pending');
      expect(going.glyph).not.toBe(flying.glyph);
      expect(going.title).not.toBe(flying.title);
      const sent = resultVisual('pending', 'broadcast', rail);
      expect(going.shape).not.toBe(sent.shape);
      expect(going.title).not.toBe(sent.title);
    },
  );

  test('a pending payment off Lightning is broadcasting until its transaction is named, by its answer or by the history', () => {
    const pending = (over: Partial<SendResult>): SendResult => ({
      id: 'p-chain',
      status: 'pending',
      amountSats: 4_200,
      feeSats: 20,
      message: 'Payment submitted. Follow its progress in Activity.',
      ...over,
    });
    const txid = 'a'.repeat(64);
    const paymentHash = 'b'.repeat(64);
    // A splice-out, and a direct funding, whose answer names it.
    expect(chainStage(pending({ txid }), 'chain')).toBe('broadcast');
    expect(chainStage(pending({ txid }), 'fund')).toBe('broadcast');
    // One the engine answered as the splice started: still going out.
    expect(chainStage(pending({}), 'chain')).toBe('broadcasting');
    expect(chainStage(pending({ paymentHash }), 'chain')).toBe('broadcasting');
    expect(chainStage(pending({}), 'fund')).toBe('broadcasting');
    // The history names its transaction, or has seen it confirm.
    expect(chainStage(pending({}), 'chain', { txid, status: 'pending' })).toBe(
      'broadcast',
    );
    expect(chainStage(pending({}), 'chain', { status: 'completed' })).toBe(
      'broadcast',
    );
    // A row that names nothing yet leaves it going out.
    expect(chainStage(pending({}), 'chain', { status: 'pending' })).toBe(
      'broadcasting',
    );
    expect(chainStage(pending({}), 'chain', null)).toBe('broadcasting');
    // A Lightning payment still in flight can settle within seconds.
    expect(chainStage(pending({ paymentHash }), 'bolt')).toBeNull();
    expect(chainStage(pending({ txid }), 'bolt')).toBeNull();
    // Only a pending answer has a stage.
    for (const status of ['completed', 'uncertain', 'failed'] as const) {
      expect(chainStage(pending({ txid, status }), 'chain')).toBeNull();
      expect(chainStage(pending({ status }), 'chain')).toBeNull();
    }
  });

  test('a request paid before rests, and one seen to complete on its held ring resolves, worded as sent and going home', () => {
    expect(heldVisual('completed')).toMatchObject({
      shape: 'disc',
      title: copy.send.paidAlready,
      resting: true,
      returnsHome: false,
    });
    // Seen to go, it is a completed result: home on its own too.
    const watched = heldVisual('completed', true);
    expect(watched).toMatchObject({
      shape: 'disc',
      title: copy.send.sent,
      resolves: true,
      returnsHome: true,
    });
    expect(watched.resting).toBeFalsy();
    // Held, watched or not, it is the ring: only paid resolves.
    expect(heldVisual('pending', true)).toEqual(heldVisual('pending'));
  });
});

describe('a rated review', () => {
  const RATES: FeeRates = { fast: 8, normal: 2, slow: 1, minimum: 1 };
  const splice: SendReview = {
    id: 'review-rated',
    destination: ADDRESS,
    description: '',
    amountSats: 4_200,
    feeSats: 500,
    feeLabel: 'Estimated network fee',
    totalSats: 4_700,
    route: 'bitcoin',
    feeRate: 2,
    feeRates: RATES,
    expiresAt: Date.now() + 60_000,
    warnings: [],
  };

  test('is a Bitcoin splice that says its rate and the estimates, and nothing else', () => {
    expect(isRatedReview(splice)).toBe(true);
    expect(isRatedReview({ ...splice, route: 'lightning' })).toBe(false);
    expect(isRatedReview({ ...splice, method: 'direct-funding' })).toBe(false);
    expect(isRatedReview({ ...splice, method: 'drain' })).toBe(false);
    expect(isRatedReview({ ...splice, feeRate: undefined })).toBe(false);
    expect(isRatedReview({ ...splice, feeRates: undefined })).toBe(false);
    expect(isRatedReview({ ...splice, feeRate: 0 })).toBe(false);
  });

  test('previews its fee by scaling the reviewed fee with the rate, rounded up', () => {
    const rated = splice as SendReview & { feeRate: number; feeRates: FeeRates };
    expect(previewFee(rated, 4)).toBe(1_000);
    expect(previewFee(rated, 1)).toBe(250);
    expect(previewFee({ ...rated, feeSats: 225 }, 3)).toBe(338);
    expect(previewFee({ ...rated, feeSats: 225 }, 1)).toBe(113);
    expect(previewFee({ ...rated, feeSats: 1 }, 1)).toBe(1);
  });

  test('previews a fixed amount with its total following the fee', () => {
    const rated = splice as SendReview & { feeRate: number; feeRates: FeeRates };
    expect(previewReview(rated, 4)).toMatchObject({
      feeRate: 4,
      feeSats: 1_000,
      amountSats: 4_200,
      totalSats: 5_200,
    });
  });

  test('says its rate on the fee line, which follows a preview; no other line, and no review priced without one, says a rate', () => {
    const rated = splice as SendReview & { feeRate: number; feeRates: FeeRates };
    expect(reviewFigures(splice).map(figure => [figure.key, figure.rate])).toEqual([
      ['fee', 2],
      ['total', undefined],
    ]);
    expect(reviewFigures(previewReview(rated, 4))[0].rate).toBe(4);
    for (const review of [
      { ...splice, route: 'lightning' as const },
      { ...splice, method: 'direct-funding' as const },
      { ...splice, method: 'drain' as const },
      { ...splice, feeRate: undefined },
    ]) {
      expect(reviewFigures(review).every(figure => figure.rate === undefined)).toBe(true);
    }
  });

  test('draws its rate as a whole number and its unit, in one string', () => {
    expect(rateText(1)).toBe('1 sat/vB');
    expect(rateText(2)).toBe('2 sat/vB');
    expect(rateText(400)).toBe('400 sat/vB');
  });

  test("previews a max review with its amount giving way to the fee and its total holding", () => {
    const max = {
      ...splice,
      max: true as const,
      keptSats: 1_402,
      keptReason: 'commitment-cost' as const,
      amountSats: 99_500,
      totalSats: 100_000,
    } as SendReview & { feeRate: number; feeRates: FeeRates };
    expect(previewReview(max, 8)).toMatchObject({
      feeRate: 8,
      feeSats: 2_000,
      amountSats: 98_000,
      totalSats: 100_000,
      keptSats: 1_402,
    });
    expect(previewReview({ ...max, amountSats: 100, feeSats: 100 }, 400).amountSats).toBe(0);
  });

  test("reaches from the engine's minimum to twice its fast estimate, within the ceiling", () => {
    expect(feeRange(RATES, 2)).toEqual({ min: 1, max: 18 });
    expect(feeRange({ fast: 30, normal: 20, slow: 10, minimum: 5 }, 20)).toEqual({ min: 5, max: 60 });
    expect(feeRange({ fast: 300, normal: 200, slow: 100, minimum: 50 }, 200)).toEqual({ min: 50, max: 400 });
  });

  test('is always wide enough to hold the rate the review stands at', () => {
    expect(feeRange(RATES, 50)).toEqual({ min: 1, max: 50 });
    expect(feeRange({ fast: 30, normal: 20, slow: 10, minimum: 5 }, 3)).toEqual({ min: 3, max: 60 });
    expect(feeRange({ fast: 1, normal: 1, slow: 1, minimum: 1 }, 1)).toEqual({ min: 1, max: 11 });
  });

  test("a refused rate keeps the engine's tone and glyphs, beside the hold, with no shake", () => {
    const refused = rateRefusal(
      sendFailure(Object.assign(new Error('short'), { code: 'INSUFFICIENT_FUNDS' }), {
        message: 'short',
        amountSats: 4_200,
        balance: snapshotOf().balance,
      }),
    );
    expect(refused.target).toBe('control');
    expect(refused.shake).toBe(false);
    expect(refused.code).toBe('INSUFFICIENT_FUNDS');
    expect(['honey', 'radish']).toContain(refused.tone);
  });
});
