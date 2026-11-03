import type { SendReview } from '@beignet/wallet-core';
import { autoPayCandidate, autoPayLimit, autoPays } from '../autoPay';

/**
 * Settings > Auto-pay, decided (REDESIGN.md rule 5): which scanned requests
 * are reviewed on their own, how much the share allows, and which reviews
 * pay themselves.
 */

/** 24,425 sats, as a QR code would carry it, in lower case. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
/** An invoice that leaves the amount to the payer. */
const OPEN_INVOICE =
  'lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqlvhfca';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const CASE_FOLDED =
  'This arrived in capitals, as QR codes often are. It was converted back to lower case.';

const review = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-auto',
  destination: 'recipient',
  description: '',
  amountSats: 24_425,
  feeSats: 35,
  feeLabel: 'Maximum fee',
  totalSats: 24_460,
  route: 'lightning',
  expiresAt: Date.now() + 60_000,
  warnings: [],
  ...over,
});

describe('autoPayCandidate', () => {
  it.each([
    ['an invoice naming its amount', INVOICE, true],
    ['the same invoice in capitals', INVOICE.toUpperCase(), true],
    ['an invoice with its scheme', `lightning:${INVOICE}`, true],
    [
      'a Bitcoin link carrying the invoice',
      `bitcoin:${ADDRESS}?lightning=${INVOICE}`,
      true,
    ],
    [
      'a Bitcoin link naming the invoice amount',
      `bitcoin:${ADDRESS}?amount=0.00024425&lightning=${INVOICE}`,
      true,
    ],
    ['an invoice that leaves the amount open', OPEN_INVOICE, false],
    ['a bare address', ADDRESS, false],
    [
      'a Bitcoin request naming an amount',
      `bitcoin:${ADDRESS}?amount=0.0001`,
      false,
    ],
    ['nothing', '', false],
    ['words', 'pay me', false],
  ])('%s: %s', (_name, request, expected) => {
    expect(autoPayCandidate(request)).toBe(expected);
  });
});

describe('autoPayLimit', () => {
  it.each([
    [100_000, 50, 50_000],
    [100_000, 0, 0],
    [100_000, 100, 100_000],
    [100_001, 5, 5_000],
    [0, 50, 0],
    [-10, 50, 0],
    [100_000, 150, 100_000],
    [Number.NaN, 50, 0],
  ])('%d sats at %d%% allows %d', (available, share, limit) => {
    expect(autoPayLimit(available, share)).toBe(limit);
  });
});

describe('autoPays', () => {
  const judge = (
    over: Partial<SendReview> = {},
    share = 50,
    available = 100_000,
  ) =>
    autoPays({
      review: review(over),
      request: INVOICE,
      availableSats: available,
      share,
    });

  it('pays a Lightning review whose whole debit is within the share', () => {
    expect(judge()).toBe(true);
    expect(judge({ totalSats: 50_000 })).toBe(true);
  });

  it('keeps the hold for a debit over the share, counting the fee cap', () => {
    expect(judge({ amountSats: 49_990, feeSats: 20, totalSats: 50_010 })).toBe(
      false,
    );
    expect(judge({}, 20)).toBe(false);
  });

  it('pays nothing at 0%, or with nothing to send', () => {
    expect(judge({}, 0)).toBe(false);
    expect(judge({}, 50, 0)).toBe(false);
  });

  it('may spend everything at 100%', () => {
    expect(judge({ totalSats: 100_000 }, 100)).toBe(true);
    expect(judge({ totalSats: 100_001 }, 100)).toBe(false);
  });

  it('keeps the hold for anything but the plain Lightning route', () => {
    expect(judge({ route: 'bitcoin' })).toBe(false);
    expect(judge({ route: 'bitcoin', method: 'direct-funding' })).toBe(false);
    expect(judge({ method: 'drain' })).toBe(false);
    expect(judge({ max: true })).toBe(false);
  });

  it('keeps the hold for any warning but the capitals the code arrived in', () => {
    expect(
      autoPays({
        review: review({ warnings: [CASE_FOLDED] }),
        request: INVOICE.toUpperCase(),
        availableSats: 100_000,
        share: 50,
      }),
    ).toBe(true);
    // The same words for a code that did not arrive in capitals explain
    // nothing about it.
    expect(judge({ warnings: [CASE_FOLDED] })).toBe(false);
    expect(
      autoPays({
        review: review({ warnings: [CASE_FOLDED, 'The route is costly.'] }),
        request: INVOICE.toUpperCase(),
        availableSats: 100_000,
        share: 50,
      }),
    ).toBe(false);
    expect(
      judge({ warnings: ['Preview only. No real money will move.'] }),
    ).toBe(false);
  });

  it('never pays a review with no debit', () => {
    expect(judge({ totalSats: 0 })).toBe(false);
    expect(judge({ totalSats: Number.NaN })).toBe(false);
  });
});
