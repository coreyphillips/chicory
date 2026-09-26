import { parsePayment } from '@beignet/wallet-core';
import type {
  SendResult,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import type { GlyphName } from '../../design/glyphs';
import type { Held } from '../../stage/heldRequests';
import type { AmountTone } from '../keypad/keys';

/**
 * Send's states as data (REDESIGN.md 6, Send and Engine errors): what a
 * request, an amount, an engine error and a result each look like. Pure, so
 * the state-to-visual map is a table test and the screen only draws it.
 */

type Balance = WalletSnapshot['balance'];

function parsed(request: string) {
  try {
    return parsePayment(request.trim());
  } catch {
    return null;
  }
}

/**
 * The amount a payment request fixes, or null when it leaves it to the payer.
 * The same precedence prepareSend applies: the request's own amount, else the
 * amount of the Lightning invoice a Bitcoin link carries.
 */
export function fixedAmount(request: string): number | null {
  const payment = parsed(request);
  if (!payment) return null;
  const sats =
    payment.kind === 'bolt11' || payment.kind === 'bolt12'
      ? payment.amountSats
      : payment.kind === 'onchain'
      ? payment.amountSats ??
        (payment.lightning && 'amountSats' in payment.lightning
          ? payment.lightning.amountSats
          : null)
      : null;
  return typeof sats === 'number' && sats > 0 ? sats : null;
}

/**
 * The rail a request will most likely go over, as its glyph: Lightning
 * first, as prepareSend tries it, direct funding for a request that carries
 * an envelope and nothing else, and on chain otherwise. A request that does
 * not read as one has no rail yet; the engine has the last word either way.
 */
export function requestRail(request: string): GlyphName | null {
  const payment = parsed(request);
  if (payment?.kind === 'bolt11' || payment?.kind === 'bolt12') return 'bolt';
  if (payment?.kind !== 'onchain') return null;
  if (payment.lightning) return 'bolt';
  return payment.funding ? 'fund' : 'chain';
}

/** The rail a review settled on, as its glyph and its name. */
export function reviewRail(review: SendReview): {
  glyph: GlyphName;
  label: string;
} {
  if (review.method === 'direct-funding') {
    return { glyph: 'fund', label: copy.send.directFunding };
  }
  return review.route === 'lightning'
    ? { glyph: 'bolt', label: copy.send.lightning }
    : { glyph: 'chain', label: copy.send.bitcoin };
}

/** One line of a review's sum: its signs, its amount, and its words. */
export interface ReviewFigure {
  key: 'fee' | 'expected' | 'total';
  signs: string;
  sats: number;
  /** What a screen reader calls the line, as the engine and old screen did. */
  label: string;
  /** How its amount is read out. */
  value: string;
}

/**
 * What a payment will cost, as the review lays it out (REDESIGN.md 6,
 * Send): `+ ≤` the most the fee can be, `≈` what the route priced should
 * cost when there is an estimate, and `=` the most it all comes to.
 */
export function reviewFigures(review: SendReview): ReviewFigure[] {
  const estimate = review.estimatedFeeSats;
  const figures: ReviewFigure[] = [
    {
      key: 'fee',
      signs: '+ ≤',
      sats: review.feeSats,
      label: review.feeLabel || copy.send.fee,
      value: copy.amount.spoken(review.feeSats),
    },
  ];
  if (estimate != null) {
    figures.push({
      key: 'expected',
      signs: '≈',
      sats: estimate,
      label: copy.send.expectedFee,
      value: copy.send.about(estimate),
    });
  }
  figures.push({
    key: 'total',
    signs: '=',
    sats: review.totalSats,
    label: estimate != null ? copy.send.totalAtMost : copy.send.totalWithFee,
    value: copy.amount.spoken(review.totalSats),
  });
  return figures;
}

const sentence = (text: string) =>
  /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/**
 * The review as the hold says it to a screen reader: the total first, then
 * the most the fee can be, what it should cost, and every warning the
 * engine gave. The hold commits on one action, so whatever the lines above
 * it show is said with it too, and nothing a sighted payer is shown before
 * holding is left for a screen reader to find on its own.
 */
export function reviewWords(review: SendReview): string {
  const figures = reviewFigures(review);
  const total = figures.filter(figure => figure.key === 'total');
  const rest = figures.filter(figure => figure.key !== 'total');
  return [...total, ...rest]
    .map(figure => `${figure.label} ${figure.value}`)
    .concat(review.warnings)
    .map(sentence)
    .join(' ');
}

/** Characters kept at each end of a shortened request. */
const KEEP = 8;
const groups = (text: string) => text.match(/.{1,4}/g)?.join(' ') ?? '';

/**
 * Where a request pays, as the chip shows it: the address or the invoice,
 * without its scheme, in groups of four and shortened in the middle.
 */
export function shortRequest(request: string): string {
  const payment = parsed(request);
  const destination =
    payment?.kind === 'onchain'
      ? payment.address
      : payment?.kind === 'bolt11'
      ? payment.invoice
      : payment?.kind === 'bolt12'
      ? payment.offer
      : request.trim().replace(/^(lightning|bitcoin):/i, '');
  if (destination.length <= KEEP * 2 + 4) return groups(destination);
  return `${groups(destination.slice(0, KEEP))} … ${groups(
    destination.slice(-KEEP),
  )}`;
}

/**
 * Whether money on its way would let `sats` go, once it lands. Only then does
 * waiting help: the gap between what can be sent and the total may be money
 * that never becomes spendable, such as the channel's reserve.
 */
export function arrivalCovers(sats: number, balance: Balance): boolean {
  return (
    balance.pendingSats > 0 &&
    sats <= balance.totalSats &&
    sats <= balance.availableSats + balance.pendingSats
  );
}

/**
 * How an amount sits against the balance (REDESIGN.md 5, Keypad): honey,
 * with its clock, only while what is arriving would cover it, and radish past
 * what can be sent when waiting would not help.
 */
export function amountTone(sats: number, balance?: Balance): AmountTone {
  if (!balance || !(sats > 0) || sats <= balance.availableSats) return 'plain';
  return arrivalCovers(sats, balance) ? 'over-spendable' : 'over-total';
}

/**
 * What a screen reader hears about an amount held against the balance, for
 * `tone`: that the rest is on its way only while it is, that the wallet holds
 * less only past its total, and otherwise how much can be sent now, which is
 * the limit the amount went past. Null while the amount is fine.
 */
export function amountWords(
  tone: AmountTone,
  sats: number,
  balance?: Balance,
): string | null {
  if (tone === 'over-spendable') return copy.amount.overSpendable;
  if (tone !== 'over-total') return null;
  if (!balance || sats > balance.totalSats) return copy.amount.overTotal;
  return `${copy.home.split(balance.availableSats, balance.pendingSats)}.`;
}

/**
 * Where an engine error shows, and how (REDESIGN.md 6, Engine errors):
 *
 * - request: the chip dissolves back into the well, and a cross draws;
 * - amount: the amount takes the tone, as it does against the balance;
 * - control: a mark beside the control that asked.
 *
 * Each carries the engine's own message, which a screen reader hears and
 * Whisper shows, and `code` for the diagnostic log.
 */
export interface Failure {
  code: string;
  message: string;
  target: 'request' | 'amount' | 'control';
  tone: 'honey' | 'radish';
  glyphs: GlyphName[];
  shake: boolean;
  haptic: 'warning' | 'error';
}

/** Codes for a request the engine will not pay, whatever the amount. */
const REFUSED = new Set([
  'INVALID_REQUEST',
  'OFFER_NOT_QUOTABLE',
  'INVOICE_EXPIRED',
  'INVALID_NETWORK',
  'AMOUNT_CONFLICT',
  'INPUT_TOO_LONG',
  'BIDI_CONTROL',
  'DUPLICATE_AMOUNT',
  'MALFORMED_PERCENT_ENCODING',
  'NOT_PAYABLE',
  'NON_ASCII',
  'LNURL_UNSUPPORTED',
  'BOLT12_REQUEST_UNSUPPORTED',
  'LIGHTNING_ADDRESS_UNSUPPORTED',
]);
/** The parser's families of refusals: bech32, addresses, invoices, BIP21. */
const REFUSED_FAMILY =
  /^(B32|ADDR|BOLT11|BASE58|BIP21)_|^AMOUNT_(EMPTY|NOT_DECIMAL|SUB_SATOSHI|OVER_MAX_MONEY)$/;

/** Codes for an amount the engine will not take. */
const AMOUNT_REFUSED = new Set(['AMOUNT_REQUIRED', 'INVALID_AMOUNT']);

/**
 * Codes that mean the payment may have gone out. They are never an error to
 * retry: the request is held and the result is unknown.
 */
const UNCERTAIN = new Set([
  'RESULT_UNCERTAIN',
  'UNCERTAIN',
  'ALREADY_SUBMITTED',
]);

export const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
};

export const isUncertain = (error: unknown) => UNCERTAIN.has(errorCode(error));

/**
 * Preparing pays nothing, so a prepare that fails, even for want of an
 * answer, leaves the request free. The one exception is the engine saying a
 * payment for it is already out: that request is held.
 */
export const alreadySubmitted = (error: unknown) =>
  errorCode(error) === 'ALREADY_SUBMITTED';

/** A failure of `code` with the engine's `message`, drawn as the rest say. */
function failureOf(
  code: string,
  message: string,
  target: Failure['target'],
  tone: Failure['tone'],
  glyphs: GlyphName[],
): Failure {
  return {
    code,
    message,
    target,
    tone,
    glyphs,
    shake: tone === 'radish',
    haptic: tone === 'radish' ? 'error' : 'warning',
  };
}

/**
 * Why a request cannot be paid, read as it is entered (pasted, scanned,
 * brought by a link, or typed and left) by the parser the engine reads it
 * with, or null when it reads as a payment or is empty. A refused request
 * never takes the accepted look: it stays in the well with a cross
 * (REDESIGN.md 6, Engine errors). The engine still has the last word at
 * review, for what only it can know, such as the wallet's network.
 */
export function requestRefusal(request: string): Failure | null {
  const payment = parsed(request);
  if (payment?.kind !== 'invalid') return null;
  return failureOf(payment.code, payment.message, 'request', 'radish', [
    'cross',
  ]);
}

export function sendFailure(
  error: unknown,
  context: { message: string; amountSats: number | null; balance?: Balance },
): Failure {
  const code = errorCode(error);
  const failure = (
    target: Failure['target'],
    tone: Failure['tone'],
    glyphs: GlyphName[],
  ): Failure => failureOf(code, context.message, target, tone, glyphs);
  if (REFUSED.has(code) || REFUSED_FAMILY.test(code)) {
    return failure('request', 'radish', ['cross']);
  }
  if (code === 'INSUFFICIENT_FUNDS') {
    // Honey and a clock say waiting will help, so only while money on its
    // way would cover the amount; otherwise it is past what can be sent.
    const { amountSats, balance } = context;
    const waits =
      !balance ||
      (amountSats === null
        ? balance.pendingSats > 0
        : arrivalCovers(amountSats, balance));
    return waits
      ? failure('amount', 'honey', ['clock'])
      : failure('amount', 'radish', ['bang']);
  }
  if (AMOUNT_REFUSED.has(code)) return failure('amount', 'radish', ['bang']);
  switch (code) {
    case 'PRIMARY_DOWN':
      return failure('control', 'honey', ['unplug']);
    case 'NO_ROUTE':
      return failure('control', 'radish', ['bolt', 'cross']);
    case 'FUNDING_UNCONFIRMED':
      return failure('control', 'honey', ['chain', 'clock']);
    case 'QUOTE_EXPIRED':
      return failure('control', 'honey', ['refresh']);
    default:
      return failure('control', 'radish', ['bang']);
  }
}

/**
 * A result's mark (REDESIGN.md 6, Send). Each outcome has its own shape as
 * well as its own colour, so none can be mistaken for another without
 * colour: a filled disc is done, an orbit is moving, a steady ring with a
 * halo is held, and an open outline with a bang has failed.
 */
export interface ResultVisual {
  shape: 'disc' | 'orbit' | 'held' | 'broken';
  tone: 'cream' | 'bloom' | 'honey' | 'radish';
  glyph: GlyphName;
  title: string;
  /** Home follows on its own a moment later, unless the screen is touched. */
  returnsHome: boolean;
  /** An orbit runs round the held ring: the payment is still under way. */
  orbit?: boolean;
  /** Drawn as it stands, for a payment seen before: no pop, no draw-in. */
  resting?: boolean;
}

export function resultVisual(status: SendResult['status']): ResultVisual {
  switch (status) {
    case 'completed':
      return {
        shape: 'disc',
        tone: 'cream',
        glyph: 'check',
        title: copy.send.sent,
        returnsHome: true,
      };
    case 'pending':
      return {
        shape: 'orbit',
        tone: 'bloom',
        glyph: 'send',
        title: copy.send.onItsWay,
        returnsHome: false,
      };
    case 'uncertain':
      return {
        shape: 'held',
        tone: 'honey',
        glyph: 'pause',
        title: copy.send.unknown,
        returnsHome: false,
      };
    case 'failed':
      return {
        shape: 'broken',
        tone: 'radish',
        glyph: 'bang',
        title: copy.send.failed,
        returnsHome: false,
      };
  }
}

/**
 * The mark of a request that cannot be paid now (REDESIGN.md rule 6): the
 * held ring, with an orbit round it while its payment is still under way,
 * and the done disc at rest once the request is paid, with nothing played
 * for a payment that was seen before and no way home on its own.
 */
export function heldVisual(status: Held['status']): ResultVisual {
  if (status === 'completed') {
    return {
      ...resultVisual('completed'),
      title: copy.send.paidAlready,
      returnsHome: false,
      resting: true,
    };
  }
  const held = resultVisual('uncertain');
  return status === 'pending'
    ? { ...held, title: copy.send.onItsWay, orbit: true }
    : held;
}

/** How long a completed payment stays on screen before home. */
export const HOME_AFTER_MS = 2200;

/**
 * How long a payment's call keeps the stage busy. Most payments answer well
 * inside it and show their result where they were sent. One that has not
 * answered by then lets the stage go and moves to the held ring, so Send is
 * never a dead end while a payment hangs; the call goes on, and its answer
 * is recorded whenever it comes.
 */
export const SEND_GRACE_MS = 8_000;
