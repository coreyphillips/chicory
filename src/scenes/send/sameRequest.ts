import { parsePayment } from '@beignet/wallet-core';
import { pubkyOf } from './pubky';

/**
 * What a code asks to be paid, as far as telling two codes apart needs. It
 * is read from the parsed request and never from the text, so a field the
 * parser passes over, a `lightning=` that holds no invoice for one, is no
 * part of it.
 */
interface Asked {
  /** The Lightning invoice or offer it is or carries. */
  lightning: string | null;
  /**
   * Whom it pays otherwise: the address, with the funding request beside it,
   * or the pubky.
   */
  payee: string | null;
  /** The amount it fixes, in sats. */
  sats: number | null;
}

function asked(code: string): Asked | null {
  const parsed = parsePayment(code);
  switch (parsed.kind) {
    case 'bolt11':
      return {
        lightning: parsed.invoice,
        payee: null,
        sats: parsed.amountSats ?? null,
      };
    case 'bolt12':
      return {
        lightning: parsed.offer,
        payee: null,
        sats: parsed.amountSats ?? null,
      };
    case 'onchain': {
      const carried = parsed.lightning;
      const bolt =
        carried?.kind === 'bolt11' || carried?.kind === 'bolt12'
          ? carried
          : null;
      return {
        lightning: bolt?.kind === 'bolt11' ? bolt.invoice : bolt?.offer ?? null,
        payee: [parsed.address, parsed.funding?.envelope ?? ''].join(' '),
        sats: parsed.amountSats ?? bolt?.amountSats ?? null,
      };
    }
    default: {
      // A pubky is paid too, though the parser does not read one.
      const pubky = pubkyOf(code);
      return pubky ? { lightning: null, payee: pubky, sats: null } : null;
    }
  }
}

/**
 * Whether two codes ask for one payment, however each is spelled: in
 * capitals, bare or behind `lightning:` or `bitcoin:`. They must name the
 * same invoice or none, the same amount, and the same address. A Lightning
 * request alone and a link that carries that invoice beside an address are
 * one payment too, since the link only says more of it.
 *
 * Anything less is two requests: two addresses beside one invoice, or two
 * addresses beside the same unreadable `lightning=`. Nothing says which was
 * meant, and the first is not to be paid for being first.
 */
export function sameRequest(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const one = asked(a);
  const other = asked(b);
  if (!one || !other) return false;
  if (one.lightning !== other.lightning || one.sats !== other.sats)
    return false;
  if (one.payee === null || other.payee === null) return true;
  return one.payee === other.payee;
}
