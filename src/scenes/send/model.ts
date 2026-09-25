import { parsePayment } from '@beignet/wallet-core';
import type {
  SendResult,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import type { GlyphName } from '../../design/glyphs';
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

/** How an amount sits against the balance. */
export function amountTone(sats: number, balance?: Balance): AmountTone {
  if (!balance || !(sats > 0)) return 'plain';
  if (sats > balance.totalSats) return 'over-total';
  if (sats > balance.availableSats) return 'over-spendable';
  return 'plain';
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

export function sendFailure(
  error: unknown,
  context: { message: string; amountSats: number | null; balance?: Balance },
): Failure {
  const code = errorCode(error);
  const failure = (
    target: Failure['target'],
    tone: Failure['tone'],
    glyphs: GlyphName[],
  ): Failure => ({
    code,
    message: context.message,
    target,
    tone,
    glyphs,
    shake: tone === 'radish',
    haptic: tone === 'radish' ? 'error' : 'warning',
  });
  if (REFUSED.has(code) || REFUSED_FAMILY.test(code)) {
    return failure('request', 'radish', ['cross']);
  }
  if (code === 'INSUFFICIENT_FUNDS') {
    // Radish only for an amount known to be past all the wallet holds.
    const { amountSats, balance } = context;
    const pastTotal =
      amountSats !== null && !!balance && amountSats > balance.totalSats;
    return pastTotal
      ? failure('amount', 'radish', ['bang'])
      : failure('amount', 'honey', ['clock']);
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

/** How long a completed payment stays on screen before home. */
export const HOME_AFTER_MS = 2200;
