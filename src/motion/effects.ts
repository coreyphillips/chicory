import { useCallback } from 'react';
import {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import { motionReduced } from '../services/motion';
import { riseIn } from './presets';
import { curves, durations, shake, springs } from './tokens';
import { useMotionPrefs } from './useMotionPrefs';

/*
 * One-off moves any control can make: the refusal shake, and the pop and
 * dissolve of something that arrives or is let go of as a whole, such as a
 * chip.
 */

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

/**
 * Something that arrives as a whole, such as a chip: it pops into place,
 * `delay` ms after it mounts.
 */
export function popIn(from = 0.85, delay = 0): EntryExitAnimationFunction {
  if (motionReduced()) return riseIn(0);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: from }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, {
            duration: durations.enter,
            easing: curves.enter,
          }),
        ),
        transform: [{ scale: withDelay(delay, withSpring(1, springs.reveal)) }],
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
