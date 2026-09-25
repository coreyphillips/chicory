import type { Activity } from '@beignet/wallet-core';
import type { GlyphName } from '../../design/glyphs';

/**
 * What a payment's ring shows (REDESIGN.md 6, Activity row). Colour, the
 * ring's pattern and the glyph each carry the state, so it reads without the
 * colour and without words:
 *
 * - full: a closed ring, the outcome is known
 * - orbit: an arc going round, money is moving
 * - dashed: a waiting request, turning slowly
 * - split: part received, the rest dashed in honey
 * - held: steady honey with a halo, the outcome is unknown
 * - gap: an open ring, the status could not be read
 * - expired: short dashes, faded
 *
 * `progress` fills an orbit as confirmations arrive, `split` is the share of
 * a partial payment already here, and `badge` is a micro-glyph at the ring's
 * lower right.
 */
export interface RingVisual {
  tone: 'bloom' | 'sage' | 'honey' | 'radish' | 'dust' | 'steam';
  pattern: 'full' | 'orbit' | 'dashed' | 'split' | 'held' | 'gap' | 'expired';
  progress?: number;
  split?: number;
  glyph: GlyphName;
  badge?: GlyphName;
}

const KIND: Record<Activity['kind'], GlyphName> = {
  sent: 'send',
  received: 'receive',
  request: 'qr',
  transfer: 'swap',
};

const share = (part: number, whole: number) =>
  whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;

/**
 * The ring for one payment, most urgent state first. An unknown outcome
 * outranks everything, because it is the one state that must never be read
 * as done: a payment someone might make again. Failure and expiry come next,
 * since they are final, then the in-between states, then completion.
 */
export function ringVisual(item: Activity): RingVisual {
  const kind = KIND[item.kind];
  const request = item.receiveRequest;
  const status = item.receiveStatus;
  const open = item.status !== 'completed';
  const ring = (visual: RingVisual): RingVisual =>
    request?.legacy ? { ...visual, badge: 'chain' } : visual;

  if (item.status === 'uncertain') {
    return ring({ tone: 'honey', pattern: 'held', glyph: 'pause' });
  }
  if (item.status === 'failed') {
    return ring({ tone: 'radish', pattern: 'full', glyph: 'cross' });
  }
  if (item.status === 'expired') {
    return ring({ tone: 'dust', pattern: 'expired', glyph: kind });
  }
  if (status?.phase === 'partial') {
    return ring({
      tone: 'sage',
      pattern: 'split',
      split: share(status.receivedSats, request?.amountSats ?? 0),
      glyph: 'receive',
    });
  }
  // An address used twice cannot tell whose coins arrived: a safety state.
  if (open && request?.bitcoinTracking === 'ambiguous') {
    return ring({ tone: 'honey', pattern: 'full', glyph: 'twin' });
  }
  if (open && item.receiveStatusUnavailable) {
    return ring({ tone: 'steam', pattern: 'gap', glyph: 'question' });
  }
  if (status?.phase === 'pending') {
    return ring({
      tone: 'sage',
      pattern: 'orbit',
      progress: share(status.confirmedSats, status.receivedSats),
      glyph: 'receive',
    });
  }
  if (item.kind === 'received' && item.status === 'pending') {
    return ring({ tone: 'sage', pattern: 'orbit', glyph: 'receive' });
  }
  if (item.status === 'pending' && item.kind === 'request') {
    return ring({
      tone: 'bloom',
      pattern: 'dashed',
      glyph: request?.offlineReceive ? 'moon' : 'qr',
    });
  }
  if (item.status === 'pending') {
    return ring({ tone: 'bloom', pattern: 'orbit', glyph: kind });
  }
  // Completed. A paid request is money that came in.
  if (item.kind === 'received' || item.kind === 'request') {
    return ring({ tone: 'sage', pattern: 'full', glyph: 'receive' });
  }
  return ring({ tone: 'steam', pattern: 'full', glyph: kind });
}
