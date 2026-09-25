import type { Activity, PaymentStatus } from '@beignet/wallet-core';

/**
 * Requests that cannot be paid again yet (REDESIGN.md rule 6).
 *
 * A payment that is still pending, or whose outcome is unknown, may yet
 * land. Paying its request a second time could pay twice, so Send takes such
 * a request straight to the held ring instead of a review. The old screens
 * said "Check Activity before paying this request again" and trusted the
 * reader; this holds the request instead.
 *
 * Two things hold a request. What this app saw happen to it, kept for the
 * life of the process, and the history itself: a payment there that is
 * pending or uncertain, matched by the payment hash of the invoice the
 * request carries. The history also lets a request go, once the payment it
 * shows has completed or failed.
 *
 * The set is not per wallet. An invoice or address paid from one wallet
 * while the outcome is unknown is just as unsafe to pay from another.
 */

type HeldStatus = 'pending' | 'uncertain';

export interface Held {
  status: HeldStatus;
  /** The payment in the history the request is held for, once it shows. */
  item?: Activity;
}

interface Entry {
  status: HeldStatus;
  paymentHash?: string;
  txid?: string;
}

const held = new Map<string, Entry>();

const SCHEME = /^(lightning|bitcoin):/;

/**
 * One spelling per request: case, surrounding space and the scheme are how a
 * request was copied, not which request it is.
 */
export function normalizeRequest(request: string): string {
  return request.trim().toLowerCase().replace(SCHEME, '');
}

// Bech32, as far as reading one field of a bolt11 invoice needs it. The
// checksum is not verified: a garbled invoice yields a hash no payment has,
// and so holds nothing.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHECKSUM_WORDS = 6;
const TIMESTAMP_WORDS = 7;
const SIGNATURE_WORDS = 104;
/** The `p` field: the payment hash, 256 bits in 52 five-bit words. */
const HASH_TAG = 1;
const HASH_WORDS = 52;

/** An invoice's five-bit data words, or null when it is not one. */
function invoiceWords(invoice: string): number[] | null {
  const separator = invoice.lastIndexOf('1');
  if (!invoice.startsWith('ln') || separator < 3) return null;
  const words: number[] = [];
  for (const char of invoice.slice(separator + 1)) {
    const word = CHARSET.indexOf(char);
    if (word === -1) return null;
    words.push(word);
  }
  return words.slice(0, -CHECKSUM_WORDS);
}

/** Five-bit words as hex, dropping the padding bits at the end. */
function hexOf(words: number[]): string {
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const word of words) {
    buffer = buffer * 32 + word;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      const unit = 2 ** bits;
      out += Math.floor(buffer / unit)
        .toString(16)
        .padStart(2, '0');
      buffer %= unit;
    }
  }
  return out;
}

/**
 * The payment hash of the Lightning invoice `request` is or carries, or null
 * when it carries none that reads cleanly.
 */
export function paymentHashOf(request: string): string | null {
  const text = normalizeRequest(request);
  const invoice = text.startsWith('ln')
    ? text
    : /[?&]lightning=([^&]+)/.exec(text)?.[1];
  const words = invoice ? invoiceWords(invoice) : null;
  if (!words) return null;
  const end = words.length - SIGNATURE_WORDS;
  for (let at = TIMESTAMP_WORDS; at + 3 <= end; ) {
    const start = at + 3;
    const length = words[at + 1] * 32 + words[at + 2];
    if (
      words[at] === HASH_TAG &&
      length === HASH_WORDS &&
      start + length <= end
    ) {
      return hexOf(words.slice(start, start + length));
    }
    at = start + length;
  }
  return null;
}

/**
 * Records what paying `request` came to. A payment still pending, or whose
 * outcome is unknown, holds the request; one that completed or failed lets
 * it go.
 */
export function holdRequest(
  request: string,
  outcome: { status: PaymentStatus; paymentHash?: string; txid?: string },
) {
  const key = normalizeRequest(request);
  if (!key) return;
  if (outcome.status === 'pending' || outcome.status === 'uncertain') {
    held.set(key, {
      status: outcome.status,
      paymentHash: outcome.paymentHash || paymentHashOf(request) || undefined,
      txid: outcome.txid || undefined,
    });
  } else {
    held.delete(key);
  }
}

/**
 * Whether `request` is held, and by which payment in `activity` when the
 * history shows it. A payment the history shows as settled lets the request
 * go, whatever this app saw before.
 */
export function heldRequest(
  request: string,
  activity: readonly Activity[] = [],
): Held | null {
  const key = normalizeRequest(request);
  if (!key) return null;
  const entry = held.get(key);
  const hash = entry?.paymentHash ?? paymentHashOf(request);
  const txid = entry?.txid;
  const item = activity.find(
    payment =>
      payment.kind === 'sent' &&
      ((hash && payment.paymentHash === hash) ||
        (txid && payment.txid === txid)),
  );
  if (item?.status === 'pending' || item?.status === 'uncertain') {
    return { status: item.status, item };
  }
  if (item) {
    held.delete(key);
    return null;
  }
  return entry ? { status: entry.status } : null;
}
