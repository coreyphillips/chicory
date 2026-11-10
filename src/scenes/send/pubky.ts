import { parsePayment } from '@beignet/wallet-core';
import type { PaymentEndpoint } from '../../services/paykit';
import { invoiceExpiry } from '../../stage/heldRequests';

/**
 * Paying a pubky (REDESIGN.md 6, Send): reading one as it is entered, and
 * choosing what to pay from the Payment List it publishes. Pure, so both are
 * table tests. The lookup itself is services/paykit.
 */

const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;

/**
 * The key `text` names when it is a pubky and nothing the payment parser
 * reads, or null. The forms are paykit-discovery's: the bare 52 character
 * z-base-32 key, `pubky<key>` or `pubky://<key>`, with the space around it
 * ignored. A key followed by a path, a query or a fragment is not one.
 * Lowercase only, as upstream takes it.
 */
export function pubkyOf(text: string): string | null {
  const trimmed = text.trim();
  const key =
    trimmed.length === 52
      ? trimmed
      : trimmed.replace(/^(?:pubky:\/\/|pubky)/, '');
  if (!KEY.test(key)) return null;
  // 52 characters hold 260 bits and a key is 256, so the last carries one
  // bit: any other ending is no key's canonical spelling.
  if (key[51] !== 'y' && key[51] !== 'o') return null;
  try {
    if (parsePayment(trimmed).kind !== 'invalid') return null;
  } catch {
    return null;
  }
  return key;
}

/** An endpoint this wallet can pay, as the request the engine is given. */
export interface Payable {
  rail: 'bolt' | 'chain';
  request: string;
  /** The amount the endpoint names, or null when the payer keys it. */
  amountSats: number | null;
  endpoint: PaymentEndpoint;
}

/** How the wallet's network is spelled in an on-chain identifier. */
const CHAIN: Record<string, string> = {
  mainnet: 'bitcoin',
  testnet: 'testnet',
  signet: 'signet',
  regtest: 'regtest',
};
const ADDRESS_TYPES = new Set(['p2tr', 'p2wpkh', 'p2sh', 'p2pkh']);
const BOLT11 = 'btc-lightning-bolt11';
/** The networks the payment parser checks a request against. */
const PARSER_NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);

/** An invoice with less than this left to run is not offered. */
export const EXPIRY_MARGIN_MS = 60_000;

/**
 * The request a payload carries: the text itself, or the `value` of the
 * JSON object the Paykit spec recommends.
 */
function requestIn(payload: string): string {
  const text = payload.trim();
  if (!text.startsWith('{')) return text;
  try {
    const value = (JSON.parse(text) as { value?: unknown } | null)?.value;
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

const named = (sats: number | null | undefined) =>
  typeof sats === 'number' && sats > 0 ? sats : null;

/**
 * The endpoints of `endpoints` this wallet can pay on `network`, in the
 * order they are tried: Lightning invoices, then addresses, each keeping
 * discovery's order. Anything else is skipped, never an error: offers, which
 * the engine cannot quote, LNURL, other assets, other networks, unknown
 * names, a payload the parser refuses or reads as another rail than its
 * identifier names, and an invoice that has run out or is about to.
 */
export function payableEndpoints(
  endpoints: readonly PaymentEndpoint[],
  network: string,
  now = Date.now(),
): Payable[] {
  const chain = `btc-${CHAIN[network] ?? network}-`;
  const options = PARSER_NETWORKS.has(network) ? { network, now } : { now };
  const lightning: Payable[] = [];
  const onchain: Payable[] = [];
  for (const endpoint of endpoints) {
    const { identifier } = endpoint;
    const invoice = identifier === BOLT11;
    const address =
      identifier.startsWith(chain) &&
      ADDRESS_TYPES.has(identifier.slice(chain.length));
    if (!invoice && !address) continue;
    const request = requestIn(endpoint.payload);
    if (!request) continue;
    let payment;
    try {
      payment = parsePayment(request, options);
    } catch {
      continue;
    }
    if (invoice) {
      if (payment.kind !== 'bolt11') continue;
      const expires = invoiceExpiry(payment.invoice);
      // One whose expiry cannot be read is left to the engine's review.
      if (expires !== null && expires - now < EXPIRY_MARGIN_MS) continue;
      lightning.push({
        rail: 'bolt',
        request: payment.invoice,
        amountSats: named(payment.amountSats),
        endpoint,
      });
    } else {
      if (payment.kind !== 'onchain' || payment.lightning || payment.funding) {
        continue;
      }
      onchain.push({
        rail: 'chain',
        request,
        amountSats: named(payment.amountSats),
        endpoint,
      });
    }
  }
  return [...lightning, ...onchain];
}

/**
 * Engine refusals of a Lightning review that a later endpoint may still be
 * paid past: no route or balance to carry the amount, or an invoice that ran
 * out between the lookup and the review.
 */
const CANNOT_CARRY = new Set([
  'NO_ROUTE',
  'INSUFFICIENT_FUNDS',
  'INVOICE_EXPIRED',
]);

/**
 * The endpoints to fall back on, as indexes into `options`, once the
 * Lightning one at `at` was refused with `code`: those after it, the other
 * invoices before the addresses, that name no amount or the same one as
 * `sats`. None for any other refusal.
 */
export function fallbacks(
  options: readonly Payable[],
  at: number,
  code: string,
  sats: number | null,
): number[] {
  if (options[at]?.rail !== 'bolt' || !CANNOT_CARRY.has(code)) return [];
  return options
    .map((option, index) => ({ option, index }))
    .filter(
      ({ option, index }) =>
        index > at &&
        (option.amountSats === null || option.amountSats === sats),
    )
    .map(({ index }) => index);
}
