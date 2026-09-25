import {
  FadingTransition,
  LinearTransition,
  ReduceMotion,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryExitAnimationFunction,
  WithTimingConfig,
} from 'react-native-reanimated';
import { motionReduced } from '../services/motion';
import { curves, durations, overlap } from './tokens';

/**
 * Layout-animation presets for keyed children, so the incoming view mounts
 * first and the outgoing one unmounts after its fade (REDESIGN.md 3.5).
 *
 * Each preset is a function and reads Reduce Motion when it is called, which
 * is at render: a component that re-renders after the setting changes picks
 * up the calmer version. Under Reduce Motion every preset is a plain
 * crossfade of 160ms or less, because nothing should travel through space.
 */

interface Pose {
  opacity: number;
  translateY: number;
  scale: number;
}

const SHOWN: Pose = { opacity: 1, translateY: 0, scale: 1 };
const HIDDEN: Pose = { ...SHOWN, opacity: 0 };

const EXIT: WithTimingConfig = {
  duration: durations.exit,
  easing: curves.exit,
};

function tween(
  from: Pose,
  to: Pose,
  config: WithTimingConfig,
  delay = 0,
): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const toward = (value: number) =>
      withDelay(delay, withTiming(value, config), config.reduceMotion);
    return {
      initialValues: {
        opacity: from.opacity,
        transform: [{ translateY: from.translateY }, { scale: from.scale }],
      },
      animations: {
        opacity: toward(to.opacity),
        transform: [
          { translateY: toward(to.translateY) },
          { scale: toward(to.scale) },
        ],
      },
    };
  };
}

/**
 * Reanimated drops an animation entirely when the system asks for reduced
 * motion. A crossfade is still wanted, so the change reads as a change rather
 * than a jump cut, and it moves nothing through space, so it opts out.
 */
function crossfade(from: Pose, to: Pose, duration = durations.crossfade) {
  return tween(from, to, {
    duration,
    easing: curves.standard,
    reduceMotion: ReduceMotion.Never,
  });
}

/** Fades in while rising `distance` points into place. */
export function riseIn(distance = overlap.rise, delay = 0) {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return tween(
    { ...HIDDEN, translateY: distance },
    SHOWN,
    { duration: durations.enter, easing: curves.enter },
    delay,
  );
}

/** A scene's content, arriving once the outgoing content is on its way. */
export function sceneIn() {
  return riseIn(overlap.rise, overlap.enterDelay);
}

/** A scene's content leaving: it fades and settles back slightly. */
export function sceneOut() {
  if (motionReduced()) return crossfade(SHOWN, HIDDEN, durations.exit);
  return tween(SHOWN, { ...HIDDEN, scale: 0.98 }, EXIT);
}

/** Fades out while dropping `distance` points, for rows giving way. */
export function dropOut(distance: number) {
  if (motionReduced()) return crossfade(SHOWN, HIDDEN, durations.exit);
  return tween(SHOWN, { ...HIDDEN, translateY: distance }, EXIT);
}

/** For the few containers that change size: never LayoutAnimation. */
export function smooth() {
  if (motionReduced()) {
    return FadingTransition.duration(durations.crossfade).reduceMotion(
      ReduceMotion.Never,
    );
  }
  return LinearTransition.duration(durations.move).easing(curves.standard);
}

/**
 * The entering preset for the `index`th of a set of siblings. The step is
 * held between the overlap rule's bounds, so a long list cannot stretch the
 * handover past its budget by accident.
 */
export function stagger(index: number, step = overlap.staggerMin) {
  const gap = Math.min(overlap.staggerMax, Math.max(overlap.staggerMin, step));
  return riseIn(overlap.rise, overlap.enterDelay + index * gap);
}
