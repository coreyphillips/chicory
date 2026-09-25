import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import { riseIn } from '../../motion/presets';
import { curves, durations, shake, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { motionReduced } from '../../services/motion';
import { usePaneActive } from '../../stage/panes/Pane';

/**
 * The moving parts Send and the keypad share: endless loops that rest when
 * nobody can see them, the refusal shake, and the pop and dissolve of a chip.
 */

/** Whether the app is in front, so a loop can rest while it is not. */
function useForeground(): boolean {
  const [front, setFront] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setFront(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return front;
}

/**
 * A value that runs from 0 to 1 every `period` ms while `running`, for an
 * endless loop: an orbit, a breath, a halo. Drive only transform and opacity
 * with it, on a view around a still drawing.
 *
 * The loop rests at 0 while the app is in the background, while its pane is
 * out of use, and under Reduce Motion, where a loop becomes a still state
 * (REDESIGN.md 8). It is cancelled when it stops and when it unmounts.
 * `mirror` runs it back down each other `period`, on the sine curve, for a
 * breath or a pulse: a whole breath is then two periods.
 */
export function useLoop(
  period: number,
  running: boolean,
  { mirror = false }: { mirror?: boolean } = {},
) {
  const { reduced } = useMotionPrefs();
  const seen = usePaneActive();
  const front = useForeground();
  const progress = useSharedValue(0);
  const on = running && seen && front && !reduced;
  useEffect(() => {
    if (!on) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(
        withTiming(1, {
          duration: period,
          easing: mirror ? curves.sine : curves.linear,
        }),
        -1,
        mirror,
      ),
    );
    return () => cancelAnimation(progress);
  }, [on, period, mirror, progress]);
  return progress;
}

/** How long a refusal tints radish in place of a shake, under Reduce Motion. */
const TINT_MS = 400;

/**
 * A refusal: a short damped shake, or under Reduce Motion a radish tint that
 * holds for 400ms (REDESIGN.md 8). `style` moves the thing refused and
 * `tint` is the opacity of a radish wash the caller lays over it.
 */
export function useShake() {
  const { reduced } = useMotionPrefs();
  const x = useSharedValue(0);
  const wash = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
  }));
  const tint = useAnimatedStyle(() => ({ opacity: wash.get() }));
  const play = useCallback(() => {
    if (!reduced) {
      x.set(shake());
      return;
    }
    const fade = {
      duration: durations.tick,
      easing: curves.standard,
      reduceMotion: ReduceMotion.Never,
    };
    wash.set(
      withSequence(
        withTiming(1, fade),
        withDelay(
          TINT_MS - 2 * durations.tick,
          withTiming(0, fade),
          ReduceMotion.Never,
        ),
      ),
    );
  }, [reduced, x, wash]);
  return { style, tint, play };
}

/** Something that arrives as a whole, such as a chip: it pops into place. */
export function popIn(from = 0.85): EntryExitAnimationFunction {
  if (motionReduced()) return riseIn(0);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: from }] },
      animations: {
        opacity: withTiming(1, {
          duration: durations.enter,
          easing: curves.enter,
        }),
        transform: [{ scale: withSpring(1, springs.reveal) }],
      },
    };
  };
}

/** Something let go of, such as a refused chip: it fades as it shrinks. */
export function dissolve(): EntryExitAnimationFunction {
  const to = motionReduced() ? 1 : 0.9;
  return () => {
    'worklet';
    const config = {
      duration: durations.move,
      easing: curves.exit,
      reduceMotion: ReduceMotion.Never,
    };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scale: withTiming(to, config) }],
      },
    };
  };
}
