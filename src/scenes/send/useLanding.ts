import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { HostInstance } from 'react-native';
import { announce } from '../../design/announce';
import { focusOn } from '../../motion/focus';
import { afterTransition } from '../../motion/idle';
import { durations, overlap } from '../../motion/tokens';
import { motionReduced } from '../../services/motion';

/** An element a screen reader can be moved to. */
export type Landing = RefObject<HostInstance | null>;

/**
 * How long a step of Send takes to arrive: `sceneIn`'s delay and rise, or
 * its crossfade under Reduce Motion.
 */
export const stepInMs = () =>
  motionReduced() ? durations.crossfade : overlap.enterDelay + durations.enter;

const speak = (text: string, assertive: boolean) =>
  assertive ? announce(text, { assertive }) : announce(text);

/**
 * Where a screen reader lands as each of Send's steps arrives, and what it
 * is told once it is there (REDESIGN.md 9).
 *
 * `land(target)` moves a screen reader to `target` once its step has risen
 * into view and nothing else is moving: an element still fading in may not
 * be in the accessibility tree yet, and focus sent to it can be dropped.
 * Only the latest landing asked for is made.
 *
 * `say(text)` speaks once the landing on its way has been made, so the move
 * never cuts an assertive message short, and at once when none is on its
 * way. Nothing waiting is lost: whatever is still unsaid as Send goes is
 * said then.
 */
export function useLanding() {
  const waiting = useRef<{ text: string; assertive: boolean }[]>([]);
  const cancel = useRef<(() => void) | null>(null);

  const flush = useCallback(() => {
    const due = waiting.current;
    waiting.current = [];
    for (const { text, assertive } of due) speak(text, assertive);
  }, []);

  const land = useCallback(
    (target: Landing) => {
      cancel.current?.();
      let idle: (() => void) | null = null;
      const timer = setTimeout(() => {
        idle = afterTransition(() => {
          cancel.current = null;
          focusOn(target.current);
          flush();
        });
      }, stepInMs());
      cancel.current = () => {
        clearTimeout(timer);
        idle?.();
      };
    },
    [flush],
  );

  const say = useCallback((text: string, assertive = false) => {
    if (cancel.current) waiting.current.push({ text, assertive });
    else speak(text, assertive);
  }, []);

  useEffect(
    () => () => {
      cancel.current?.();
      cancel.current = null;
      flush();
    },
    [flush],
  );

  return { land, say };
}
