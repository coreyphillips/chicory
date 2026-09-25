import type { WalletRecord, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
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

type Snapshot = Pick<WalletSnapshot, 'wallet' | 'primary' | 'activity'>;

/** Anything off mainnet: play money, drawn in slate so it never passes for real. */
export const isTestNetwork = (network: string) => network !== 'mainnet';

/** Where the wallet's lightning setup is: under way, done, or stopped short. */
export type Setup = 'pending' | 'ready' | 'failed';

/**
 * A wallet without lightning-first funding has no setup to wait for, so it
 * counts as ready. A setup error means it stopped, whatever the status says.
 */
export function setupOf(snapshot: Pick<Snapshot, 'wallet' | 'primary'>): Setup {
  const { wallet, primary } = snapshot;
  if (wallet.lfbw?.enabled === false || primary.setup === 'ready') {
    return 'ready';
  }
  if (primary.setupError || primary.setup === 'failed') return 'failed';
  return 'pending';
}

/** The state of the wallet the status row reads, beyond the snapshot. */
export interface HealthInput {
  snapshot: Pick<Snapshot, 'wallet' | 'primary'>;
  /** The balance is too old to spend against. */
  stale: boolean;
  /** A refresh is under way. */
  refreshing: boolean;
  /** The engine is still starting, so the figures are the saved ones. */
  connecting: boolean;
  /** Why the last refresh failed, or empty when it worked. */
  error: string;
  /** A recovery phrase is still to be saved. */
  backupPending: boolean;
}

/**
 * How the bloom mark in the status row looks (REDESIGN.md 6, Wallet
 * health): the mark says how the wallet is, and its PulseDot how the
 * connection is.
 */
export interface MarkVisual {
  /** Ratchets while a refresh runs, and breathes while setup is under way. */
  mode: 'still' | 'breathe' | 'ratchet';
  /** How far the petals are open: .6 during setup, all the way once ready. */
  open: number;
  /** Dormant while the balance is old, slate on a test network. */
  tone: 'live' | 'test' | 'dormant';
  /** The honey halo of a recovery phrase still to save. */
  halo: boolean;
  /** Setup stopped short: the petals droop and a honey pip sits on the mark. */
  droop: boolean;
  /** The flask micro glyph beside the mark on a test network. */
  flask: boolean;
  pulse: 'live' | 'reconnecting' | 'failed';
}

/**
 * Whether the wallet has answered lately. A snapshot's own `connected` is
 * only as new as the snapshot: figures from a cached launch, or ones old
 * enough to be gated, say nothing about the connection now, and the dot
 * waits for a live read before it turns sage again.
 */
const answering = ({ snapshot, stale, connecting }: HealthInput) =>
  snapshot.primary.connected && !stale && !connecting;

export function markVisual(input: HealthInput): MarkVisual {
  const { snapshot, stale, refreshing, connecting, error } = input;
  const setup = setupOf(snapshot);
  const test = isTestNetwork(snapshot.wallet.network);
  return {
    mode:
      refreshing || connecting
        ? 'ratchet'
        : setup === 'pending'
        ? 'breathe'
        : 'still',
    open: setup === 'pending' ? 0.6 : setup === 'failed' ? 0.8 : 1,
    tone: stale ? 'dormant' : test ? 'test' : 'live',
    halo: input.backupPending,
    droop: setup === 'failed',
    flask: test,
    pulse: error ? 'failed' : answering(input) ? 'live' : 'reconnecting',
  };
}

/**
 * Everything the mark shows, in words, for its accessibility value and its
 * whisper: the connection, how old the balance is, the setup, the network
 * when it is not mainnet, and a backup still to save. A failed refresh says
 * what the notice above Home used to say, with the engine's reason.
 */
export function healthText(input: HealthInput): string {
  const { snapshot, stale, refreshing, connecting, error } = input;
  const setup = setupOf(snapshot);
  const { network } = snapshot.wallet;
  return [
    error
      ? copy.health.refreshFailedDetail(error)
      : answering(input)
      ? copy.health.fresh
      : copy.health.reconnecting,
    stale
      ? connecting || refreshing
        ? copy.health.cached
        : copy.health.stale
      : '',
    setup === 'pending' ? copy.health.setupPending : '',
    setup === 'failed'
      ? [copy.health.setupFailed, snapshot.primary.setupError ?? ''].join(' ')
      : '',
    isTestNetwork(network) ? copy.health.testNetwork(network) : '',
    input.backupPending ? copy.health.backupPending : '',
  ]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The top pane's light (REDESIGN.md 3.2): which colour the bloom glow takes,
 * whether an old balance dims it, and the one lasting state tint. The tints
 * that flash, sage for money arriving and radish for a failure, come from
 * events rather than from a state, so they are not here.
 */
export interface BackdropVisual {
  glow: 'bloom' | 'slate';
  dim: boolean;
  tint: 'honey' | 'night' | null;
}

/**
 * Honey while something needs attention: a backup to save or a payment
 * whose outcome is unknown. Night while an offline request is open and
 * still unexpired as of the snapshot, the one sign of offline receive the
 * wallet itself records.
 */
export function backdropVisual({
  snapshot,
  stale,
  backupPending,
}: {
  snapshot: Pick<Snapshot, 'wallet' | 'activity'> & { updatedAt: number };
  stale: boolean;
  backupPending: boolean;
}): BackdropVisual {
  const uncertain = snapshot.activity.some(item => item.status === 'uncertain');
  const offline = snapshot.activity.some(
    item =>
      item.kind === 'request' &&
      item.status === 'pending' &&
      !!item.receiveRequest?.offlineReceive &&
      item.receiveRequest.expiresAt > snapshot.updatedAt,
  );
  return {
    glow: isTestNetwork(snapshot.wallet.network) ? 'slate' : 'bloom',
    dim: stale,
    tint: backupPending || uncertain ? 'honey' : offline ? 'night' : null,
  };
}
