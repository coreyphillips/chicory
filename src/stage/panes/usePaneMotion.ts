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
 * Drives the canvas's panes toward `layout`, the pose of the scene it shows
 * (REDESIGN.md 2.3), for a canvas `height` points tall from the top of the
 * window.
 *
 * A move starts from one of two places. A tap starts it in its own tick,
 * through the stage store, before React has rendered the new scene. Anything
 * else, such as the session resetting the stage or a scene opened from a
 * screen's own code, starts it in the layout effect of the render that shows
 * the new scene. Either way it starts once: a pose already aimed for is not
 * aimed for again.
 *
 * A move a gesture asked for starts the seam's spring at the gesture's speed,
 * so a sheet flung toward a stop carries on from the finger rather than from
 * rest.
 *
 * While the panes move, the transition lock holds: taps are refused and
 * `blocking` is true. It lifts once the panes look settled, PANE_SETTLE_MS
 * after the move starts, timed on the UI thread alongside the springs. A
 * move that interrupts another ends the earlier lock and holds its own. A
 * payment's detail card opening on the list, or closing, is such a move,
 * though the panes stay where they are. Under Reduce Motion nothing
 * travels: the sheet and the balance crossfade to where they belong within
 * 160ms, the other fades take 160ms, and nothing is locked.
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

  const aim = useCallback(
    (next: CanvasLayout, fling?: Fling) => {
      const before = aimed.current;
      if (sameLayout(next, before)) return;
      aimed.current = next;
      const covered = next.covered ? 1 : 0;
      const scanning = next.scanning ? 1 : 0;
      if (reduced) {
        if (next.seam !== before.seam || next.hero !== before.hero) {
          veil.set(0);
          veil.set(withTiming(1, VEIL));
          const jump = (to: number) =>
            withDelay(HALF, withTiming(to, JUMP), ReduceMotion.Never);
          seam.set(jump(at[next.seam]));
          hero.set(jump(next.hero));
        }
        bar.set(withTiming(next.bar, FADE));
        cover.set(withTiming(covered, FADE));
        scan.set(withTiming(scanning, FADE));
        return;
      }
      const end = begin(PANE_SETTLE_MS);
      const settled = () => {
        'worklet';
        scheduleOnRN(end);
      };
      const velocity = fling?.velocity ?? 0;
      seam.set(
        withSpring(
          at[next.seam],
          velocity ? { ...springs.pane, velocity } : springs.pane,
        ),
      );
      hero.set(withSpring(next.hero, springs.pane));
      bar.set(withSpring(next.bar, springs.pane));
      cover.set(withSpring(covered, springs.pane));
      scan.set(withSpring(scanning, springs.pane));
      // Restarting the clock cuts the last one short, which ends its lock.
      settling.set(0);
      settling.set(withTiming(1, SETTLE, settled));
    },
    [at, reduced, begin, seam, hero, bar, cover, scan, veil, settling],
  );

  // A new canvas size moves the stops out from under the seam, which follows
  // at once: a rotation or a resized window is not a transition.
  useLayoutEffect(() => {
    seam.set(at[aimed.current.seam]);
  }, [at, seam]);

  useLayoutEffect(() => {
    aim(layout);
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
