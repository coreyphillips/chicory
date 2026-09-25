import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ReduceMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { useTransitionLock } from '../../motion/useTransitionLock';
import { PANE_SETTLE_MS, canvasLayout, sameLayout, stops } from '../layout';
import type { CanvasLayout } from '../layout';
import { useStage } from '../StageContext';
import type { Panes } from './Pane';

/**
 * The canvas is drawn inside the safe area, so its own top edge already
 * clears the system status bar and every stop measures from zero.
 */
const CANVAS_INSETS = { top: 0 };

/**
 * A crossfade that still runs under Reduce Motion, which would otherwise cut
 * it to a jump: fading moves nothing through space.
 */
const FADE = {
  duration: durations.crossfade,
  easing: curves.standard,
  reduceMotion: ReduceMotion.Never,
};

/** Every value a pose sets, each settling on its own. */
const VALUES = 4;

/**
 * Drives the canvas's panes toward `layout`, the pose of the scene it shows
 * (REDESIGN.md 2.3), for a canvas `height` points tall.
 *
 * A move starts from one of two places. A tap starts it in its own tick,
 * through the stage store, before React has rendered the new scene. Anything
 * else, such as the session resetting the stage or a scene opened from a
 * screen's own code, starts it in the layout effect of the render that shows
 * the new scene. Either way it starts once: a pose already aimed for is not
 * aimed for again.
 *
 * While the panes move, the transition lock holds: taps are refused and
 * `blocking` is true. Under Reduce Motion nothing travels, so the panes are
 * simply where they belong, the fades take 160ms, and nothing is locked.
 */
export function usePaneMotion(
  height: number,
  layout: CanvasLayout,
): { panes: Panes; blocking: boolean } {
  const { reduced } = useMotionPrefs();
  const { active, blocking, begin } = useTransitionLock();
  const { panes: registry } = useStage();
  const at = useMemo(() => stops(height, CANVAS_INSETS), [height]);
  const seam = useSharedValue(at[layout.seam]);
  const hero = useSharedValue(layout.hero);
  const bar = useSharedValue(layout.bar);
  const cover = useSharedValue(layout.covered ? 1 : 0);
  const aimed = useRef(layout);

  const aim = useCallback(
    (next: CanvasLayout) => {
      if (sameLayout(next, aimed.current)) return;
      aimed.current = next;
      const covered = next.covered ? 1 : 0;
      if (reduced) {
        seam.set(at[next.seam]);
        hero.set(next.hero);
        bar.set(withTiming(next.bar, FADE));
        cover.set(withTiming(covered, FADE));
        return;
      }
      // The lock lifts once every value has settled or been cut short by the
      // next move, which then holds a lock of its own.
      const end = begin(PANE_SETTLE_MS);
      let moving = VALUES;
      const settled = () => {
        moving -= 1;
        if (moving === 0) end();
      };
      const done = () => {
        'worklet';
        scheduleOnRN(settled);
      };
      seam.set(withSpring(at[next.seam], springs.pane, done));
      hero.set(withSpring(next.hero, springs.pane, done));
      bar.set(withSpring(next.bar, springs.pane, done));
      cover.set(withSpring(covered, springs.pane, done));
    },
    [at, reduced, begin, seam, hero, bar, cover],
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
      follow: next => aim(canvasLayout(next)),
    };
    return () => {
      registry.current = null;
    };
  }, [registry, active, aim]);

  const panes = useMemo(
    () => ({ seam, hero, bar, cover, stops: at }),
    [seam, hero, bar, cover, at],
  );
  return { panes, blocking };
}
