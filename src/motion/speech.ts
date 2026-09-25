import { announce } from '../design/announce';
import { focusPending, lastFocusMove } from './focus';
import { afterTransition } from './idle';

/*
 * Safety messages, spoken so they are heard whole (REDESIGN.md rule 4 and
 * 9).
 *
 * A safety state is announced assertively, which interrupts whatever a
 * screen reader is saying. As a scene arrives, the canvas then moves focus
 * to its primary element, and the screen reader reads that aloud, which
 * would cut the message short. Several states that begin together, such as
 * a stale balance, a backup to save and a test network as a wallet opens,
 * would also cut each other off. So each waits here until the transition
 * has settled and focus has landed, and those waiting together are said as
 * one message, in order of how much they matter.
 */

/**
 * How long a screen reader is given to land where focus moved before a
 * safety message is said over it.
 */
export const FOCUS_SETTLE_MS = 400;

/**
 * Which safety state is heard first when several begin together: a payment
 * whose outcome is unknown or held, then a balance too old to spend
 * against, a request or quote that expired, an address used before, a
 * backup still to save, and a test network.
 */
export const SAFETY_ORDER = {
  held: 0,
  stale: 1,
  expired: 2,
  reused: 3,
  backup: 4,
  testNetwork: 5,
} as const;

export type SafetyKind = keyof typeof SAFETY_ORDER;

const waiting = new Map<string, number>();
let queued: (() => void) | null = null;

/**
 * Says `message` assertively once the screen has settled, with any others
 * waiting, in order of `kind`. Returns a withdrawal, for a state that ends
 * before it is heard, or a surface that goes away first.
 */
export function announceSafety(message: string, kind: SafetyKind): () => void {
  if (!message) return () => {};
  const rank = SAFETY_ORDER[kind];
  waiting.set(message, Math.min(rank, waiting.get(message) ?? rank));
  queued ??= whenSettled(speak);
  return () => {
    waiting.delete(message);
    if (waiting.size === 0) {
      queued?.();
      queued = null;
    }
  };
}

function speak() {
  queued = null;
  const said = [...waiting]
    .sort(([, a], [, b]) => a - b)
    .map(([message]) => message);
  waiting.clear();
  if (said.length > 0) announce(said.join(' '), { assertive: true });
}

/**
 * Runs `fn` once no transition is running, no focus move is waiting, and
 * the last move has had FOCUS_SETTLE_MS to land. Returns a cancel.
 */
function whenSettled(fn: () => void): () => void {
  let stop = () => {};
  const attempt = () => {
    stop = afterTransition(() => {
      if (focusPending()) {
        attempt();
        return;
      }
      const wait = lastFocusMove() + FOCUS_SETTLE_MS - Date.now();
      if (wait > 0) {
        const timer = setTimeout(attempt, wait);
        stop = () => clearTimeout(timer);
        return;
      }
      fn();
    });
  };
  attempt();
  return () => stop();
}
