import type { WalletRecord, WalletSnapshot } from '@beignet/wallet-core';
import type { GlyphName } from '../../design/glyphs';

/**
 * How the vessel under the hero looks (REDESIGN.md 5, Vessel): a pill whose
 * solid part is what can be spent now and whose glass is what is on its way.
 * The glass's style says why that money is waiting, from the wallet's last
 * channelize decision and splice, so the vessel explains without a sentence.
 */
export interface VesselVisual {
  /** A 2pt hairline when everything is spendable, 8pt with money in flight. */
  weight: 'hairline' | 'swollen';
  /** The spendable share of the pill, drawn solid bloom, from 0 to 1. */
  solid: number;
  /**
   * The arriving share: bloom glass, dust seeds below the channel floor,
   * honey or radish glass when it is held up, or a sage wash once a splice
   * has been put back.
   */
  fill: 'glass' | 'seeds' | 'honey' | 'radish' | 'sage';
  /** The light across the glass: the usual sweep, slower, backwards, or none. */
  sheen: 'sweep' | 'slow' | 'reversed' | 'none';
  /** The glyph beside the pill that names the wait, if any, and its colour. */
  glyph: GlyphName | null;
  tone: 'bloom' | 'honey' | 'radish' | 'sage' | 'dust';
  /** A failed move is retried, and the refresh glyph wears a retry ring. */
  retry: boolean;
}

type Balance = Pick<WalletSnapshot['balance'], 'availableSats' | 'pendingSats'>;
type Lfbw = WalletRecord['lfbw'];

/** Waits that clear by themselves once a transaction confirms. */
const CONFIRMING = new Set(['splicing', 'channel-pending', 'unconfirmed']);
/** Decisions that are moving money into the channel right now. */
const MOVING = new Set(['splice-in', 'open', 'open-v2']);

/**
 * The vessel for a balance and the wallet's lightning-first record.
 *
 * The channelize decision rides on the record long after its money has
 * moved, so it only styles the glass while money is actually in flight. A
 * splice conflict or revert is kept on the record only while it is worth
 * telling, so it shows whenever it is there. Failures come first, then what
 * needs attention, then plain explanations.
 */
export function vesselVisual(balance: Balance, lfbw: Lfbw): VesselVisual {
  const available = Math.max(0, balance.availableSats);
  const pending = Math.max(0, balance.pendingSats);
  const inFlight = pending > 0;
  const plain: VesselVisual = {
    weight: inFlight ? 'swollen' : 'hairline',
    solid: available + pending > 0 ? available / (available + pending) : 1,
    fill: 'glass',
    sheen: inFlight ? 'sweep' : 'none',
    glyph: null,
    tone: 'bloom',
    retry: false,
  };
  const last = inFlight ? lfbw?.lastChannelize : undefined;
  const splice = lfbw?.lastSplice;
  const wait = last?.action === 'wait' ? last.reason ?? '' : null;

  if (last?.action === 'failed') {
    return {
      ...plain,
      fill: 'radish',
      sheen: 'none',
      glyph: 'refresh',
      tone: 'radish',
      retry: true,
    };
  }
  if (splice?.state === 'conflicted') {
    return {
      ...plain,
      fill: 'honey',
      sheen: 'reversed',
      glyph: 'rewind',
      tone: 'honey',
    };
  }
  if (wait === 'fee-too-high') {
    return {
      ...plain,
      fill: 'honey',
      sheen: 'none',
      glyph: 'gauge',
      tone: 'honey',
    };
  }
  if (wait === 'below-floor') {
    return { ...plain, fill: 'seeds', sheen: 'none', tone: 'dust' };
  }
  if (inFlight && lfbw?.unpairedFunding) {
    return { ...plain, glyph: 'inflow' };
  }
  if (wait !== null && CONFIRMING.has(wait)) {
    return { ...plain, sheen: 'slow', glyph: 'clock' };
  }
  if (last && MOVING.has(last.action)) {
    return { ...plain, glyph: 'sprout' };
  }
  if (splice?.state === 'reverted') {
    return {
      ...plain,
      fill: 'sage',
      sheen: 'none',
      glyph: 'rewind',
      tone: 'sage',
    };
  }
  return plain;
}
