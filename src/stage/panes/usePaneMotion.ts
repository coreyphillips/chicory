import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ReduceMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { steady } from '../../motion/steady';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { useTransitionLock } from '../../motion/useTransitionLock';
import { PANE_SETTLE_MS, canvasLayout, sameLayout, stops } from '../layout';
import type { CanvasLayout } from '../layout';
import { useStage } from '../StageContext';
import type { Fling } from '../StageContext';
import type { Panes } from './Pane';

/**
 * A crossfade that still runs under Reduce Motion, which would otherwise cut
 * it to a jump: fading moves nothing through space.
 */
const FADE = {
  duration: durations.crossfade,
  easing: curves.standard,
  reduceMotion: ReduceMotion.Never,
};

/**
 * How long a move holds the transition lock. The pane spring looks settled
 * by PANE_SETTLE_MS, but its rest threshold only reports rest near 630ms,
 * so the lock follows a clock of its own rather than the springs.
 */
const SETTLE = { duration: PANE_SETTLE_MS, easing: curves.linear };

/**
 * How long the action row waits, coming home from `before` to `next`,
 * before it rises: from Send or Receive, as long as the scene's content
 * takes to leave (`sceneOut`), so the circles never grow over what it still
 * draws, such as a result's mark, and the one that opened the scene comes
 * back up where it landed first. Anything else, at once.
 */
export function rowWait(
  before: Pick<CanvasLayout, 'seam' | 'bar'>,
  next: Pick<CanvasLayout, 'seam' | 'bar'>,
): number {
  return before.seam === 'gone' && next.bar > before.bar ? durations.exit : 0;
}

/**
 * Under Reduce Motion nothing travels: the sheet and the balance fade out
 * over the first half of a crossfade, jump to where they belong while
 * unseen, and fade back in over the second (REDESIGN.md 8). The veil is
 * that crossfade's clock, and the jump is held for half of it.
 */
const VEIL = {
  duration: durations.crossfade,
  easing: curves.linear,
  reduceMotion: ReduceMotion.Never,
};
const JUMP = { duration: 0, reduceMotion: ReduceMotion.Never };
const HALF = durations.crossfade / 2;

/**
 * How long past the settle a move's lock may last before the transition
 * registry gives up on it: the panes run on a steady clock (`steady`), so a
 * frame that takes long to paint, as one that mounts a scene can, holds the
 * move and its lock back by about that long.
 */
const STALL_ALLOWANCE = 400;

/**
 * Whether a move starts in the tick it is asked for rather than once the
 * render that shows its scene has been drawn: only one a gesture flung,
 * which carries on from the finger.
 */
export function startsAtOnce(fling?: Fling): boolean {
  return typeof fling?.velocity === 'number';
}

/**
 * Whether the panes, where they are, need the Reduce Motion crossfade to
 * reach `seam` and `hero`: a jump there would be seen. A gesture that already
 * carried them there, as the sheet's drag does, needs none.
 */
export function veilNeeded(
  from: { seam: number; hero: number },
  to: { seam: number; hero: number },
): boolean {
  return (
    Math.abs(from.seam - to.seam) > 0.5 || Math.abs(from.hero - to.hero) > 0.01
  );
}

/**
 * Drives the canvas's panes toward `layout`, the pose of the scene it shows
 * (REDESIGN.md 2.3), for a canvas `height` points tall from the top of the
 * window.
 *
 * A move is asked for from one of two places. A tap asks in its own tick,
 * through the stage store, before React has rendered the new scene: the
 * transition lock is taken there and then, so a second tap in the same tick
 * is refused. Anything else, such as the session resetting the stage or a
 * scene opened from a screen's own code, asks in the layout effect of the
 * render that shows the new scene. Either way it is asked for once: a pose
 * already aimed for is not aimed for again.
 *
 * The panes start moving once that render has been drawn, in its layout
 * effect, and so after the frame that mounts the new scene, which can take
 * a long while to paint: started with the tap, they would be most of the
 * way there by the first frame anyone saw (`startsAtOnce`). Only a move a
 * gesture asked for starts in the gesture's tick, and at the gesture's
 * speed, so a sheet flung toward a stop carries on from the finger rather
 * than stopping where it was let go. Every pane also runs on a steady clock
 * (`steady`), the lock's clock too, so a long frame later on holds a move
 * back rather than skipping it forward.
 *
 * While the panes move, the transition lock holds: taps are refused and
 * `blocking` is true. It lifts once the panes look settled, PANE_SETTLE_MS
 * after the move starts, timed on the UI thread alongside the springs. A
 * move that interrupts another ends the earlier lock and holds its own. A
 * payment's detail card opening on the list, or closing, is such a move,
 * though the panes stay where they are. Under Reduce Motion nothing
 * travels: the sheet, the balance and the action row crossfade to where
 * they belong within 160ms, fading out over the first half and back in
 * over the second, the other fades take 160ms, and nothing is locked.
 */
export function usePaneMotion(
  height: number,
  layout: CanvasLayout,
): { panes: Panes; blocking: boolean } {
  const { reduced } = useMotionPrefs();
  const { active, blocking, begin } = useTransitionLock();
  const { panes: registry } = useStage();
  // The canvas draws edge to edge, under the system status bar, so every
  // stop measures from the top inset.
  const { top } = useSafeAreaInsets();
  const at = useMemo(() => stops(height, { top }), [height, top]);
  const seam = useSharedValue(at[layout.seam]);
  const hero = useSharedValue(layout.hero);
  const bar = useSharedValue(layout.bar);
  const cover = useSharedValue(layout.covered ? 1 : 0);
  const scan = useSharedValue(layout.scanning ? 1 : 0);
  const pull = useSharedValue(0);
  const veil = useSharedValue(1);
  const settling = useSharedValue(0);
  const aimed = useRef(layout);
  // A move asked for and not started yet, and the lock it holds.
  const pending = useRef<{ start: () => void; end: () => void } | null>(null);

  const aim = useCallback(
    (next: CanvasLayout, fling?: Fling) => {
      const before = aimed.current;
      if (sameLayout(next, before)) return;
      aimed.current = next;
      const covered = next.covered ? 1 : 0;
      const scanning = next.scanning ? 1 : 0;
      let start: () => void;
      let end = () => {};
      if (reduced) {
        start = () => {
          const to = { seam: at[next.seam], hero: next.hero };
          if (veilNeeded({ seam: seam.get(), hero: hero.get() }, to)) {
            veil.set(0);
            veil.set(steady(withTiming(1, VEIL)));
            const jump = (value: number) =>
              steady(
                withDelay(HALF, withTiming(value, JUMP), ReduceMotion.Never),
              );
            seam.set(jump(to.seam));
            hero.set(jump(to.hero));
            // The action row goes under the veil with the balance, so its
            // circles never come back over the scene that is leaving.
            bar.set(jump(next.bar));
          } else {
            seam.set(to.seam);
            hero.set(to.hero);
            bar.set(steady(withTiming(next.bar, FADE)));
          }
          cover.set(steady(withTiming(covered, FADE)));
          scan.set(steady(withTiming(scanning, FADE)));
        };
      } else {
        end = begin(PANE_SETTLE_MS + rowWait(before, next) + STALL_ALLOWANCE);
        const settled = () => {
          'worklet';
          scheduleOnRN(end);
        };
        const velocity = fling?.velocity ?? 0;
        const wait = rowWait(before, next);
        start = () => {
          seam.set(
            steady(
              withSpring(
                at[next.seam],
                velocity ? { ...springs.pane, velocity } : springs.pane,
              ),
            ),
          );
          hero.set(steady(withSpring(next.hero, springs.pane)));
          bar.set(steady(withDelay(wait, withSpring(next.bar, springs.pane))));
          cover.set(steady(withSpring(covered, springs.pane)));
          scan.set(steady(withSpring(scanning, springs.pane)));
          // Restarting the clock cuts the last one short, which ends its
          // lock. A row that waits holds it that much longer.
          settling.set(0);
          settling.set(
            steady(
              withTiming(
                1,
                { ...SETTLE, duration: SETTLE.duration + wait },
                settled,
              ),
            ),
          );
        };
      }
      // A move asked for again before it started is replaced whole, and the
      // lock the first one took is let go.
      pending.current?.end();
      pending.current = null;
      if (startsAtOnce(fling)) {
        start();
      } else {
        pending.current = { start, end };
      }
    },
    [at, reduced, begin, seam, hero, bar, cover, scan, veil, settling],
  );

  // A new canvas size moves the stops out from under the seam, which follows
  // at once: a rotation or a resized window is not a transition.
  useLayoutEffect(() => {
    seam.set(at[aimed.current.seam]);
  }, [at, seam]);

  // The render that shows the scene has been drawn: the move it asked for,
  // or that a tap asked for ahead of it, starts now.
  useLayoutEffect(() => {
    aim(layout);
    const move = pending.current;
    pending.current = null;
    move?.start();
  }, [aim, layout]);

  useLayoutEffect(() => {
    registry.current = {
      moving: () => active.current,
      follow: (next, fling) => aim(canvasLayout(next), fling),
    };
    return () => {
      registry.current = null;
    };
  }, [registry, active, aim]);

  const panes = useMemo(
    () => ({ seam, hero, bar, cover, scan, pull, veil, stops: at }),
    [seam, hero, bar, cover, scan, pull, veil, at],
  );
  return { panes, blocking };
}
