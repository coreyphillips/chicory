import { parsePayment } from '@beignet/wallet-core';
import type { SendReview } from '@beignet/wallet-core';
import type { AutoPay } from '../../services/autoPayPreference';
import type { ScanSource } from '../../stage/scene';

/**
 * The route estimate exposes these advisories as text. The fee cap is
 * already included in the debit we compare with the user's limit.
 */
const ROUTE_ADVISORIES = new Set([
  'Long route may be less reliable',
  'Fees exceed 3% of payment amount',
  'Low success probability based on historical data',
]);

/** Checked both when the invoice arrives and when its quote is ready. */
export function autoPaySource(
  source: ScanSource | undefined,
  preference: AutoPay,
): 'camera' | 'tap' | undefined {
  if (!preference.on) return;
  if (source === 'camera' || (source === 'tap' && preference.tapToPay)) {
    return source;
  }
}

function parsed(request: string) {
  try {
    return parsePayment(request.trim());
  } catch {
    return null;
  }
}

/**
 * A request auto-pay may prepare on its own: a Lightning invoice that names
 * its amount, bare or inside a Bitcoin link. An offer is never quoted, an
 * open amount needs the payer's keypad, and an address goes on chain, which
 * keeps the hold.
 */
export function autoPayCandidate(request: string): boolean {
  const payment = parsed(request);
  if (!payment) return false;
  const invoice =
    payment.kind === 'bolt11'
      ? payment
      : payment.kind === 'onchain' && payment.lightning?.kind === 'bolt11'
      ? payment.lightning
      : null;
  if (!invoice) return false;
  // A Bitcoin link naming another amount than its invoice is refused by the
  // engine, so it is left to the review to say so.
  if (
    payment.kind === 'onchain' &&
    typeof payment.amountSats === 'number' &&
    payment.amountSats !== invoice.amountSats
  ) {
    return false;
  }
  return typeof invoice.amountSats === 'number' && invoice.amountSats > 0;
}

/** The most a scanned code may cost and still pay itself, in sats. */
export function autoPayLimit(availableSats: number, share: number): number {
  if (!Number.isFinite(availableSats) || availableSats <= 0) return 0;
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.floor((availableSats * Math.min(share, 100)) / 100);
}

/** The words of the warnings the code's own shape explains, as a review says them. */
function shapeWords(request: string): Set<string> {
  const payment = parsed(request);
  const warnings =
    payment && 'warnings' in payment && Array.isArray(payment.warnings)
      ? payment.warnings
      : [];
  return new Set(
    warnings
      .filter(warning => warning.code === 'CASE_FOLDED_FROM_QR')
      .map(warning => warning.message),
  );
}

/**
 * Whether a priced review pays itself: on Lightning, by the plain route,
 * not a pay-all, its whole debit (the amount and the fee cap) within the
 * share of what can be sent. Route estimates and an invoice printed in
 * capitals are eligible. Other warnings require a hold.
 */
export function autoPays({
  review,
  request,
  availableSats,
  share,
}: {
  review: SendReview;
  request: string;
  availableSats: number;
  share: number;
}): boolean {
  if (review.route !== 'lightning' || review.method || review.max) {
    return false;
  }
  const limit = autoPayLimit(availableSats, share);
  if (limit <= 0) return false;
  if (!Number.isFinite(review.totalSats) || review.totalSats <= 0) return false;
  if (review.totalSats > limit) return false;
  if (review.warnings.length === 0) return true;
  const explained = shapeWords(request);
  return review.warnings.every(
    warning => ROUTE_ADVISORIES.has(warning) || explained.has(warning),
  );
}
