import {
  FadingTransition,
  LinearTransition,
  ReduceMotion,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryAnimationsValues,
  EntryExitAnimationFunction,
  ExitAnimationsValues,
  WithTimingConfig,
} from 'react-native-reanimated';
import { motionReduced } from '../services/motion';
import { curves, durations, overlap, springs } from './tokens';

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

/**
 * A layer arriving over the canvas from its right edge on the pane spring, as
 * Settings does. It starts in the same frame as the pane springs, so the two
 * read as one move.
 */
export function slideIn(): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return (values: EntryAnimationsValues) => {
    'worklet';
    return {
      initialValues: { transform: [{ translateX: values.windowWidth }] },
      animations: { transform: [{ translateX: withSpring(0, springs.pane) }] },
    };
  };
}

/** The same layer leaving back off the right edge. */
export function slideOut(): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(SHOWN, HIDDEN, durations.exit);
  return (values: ExitAnimationsValues) => {
    'worklet';
    return {
      initialValues: { transform: [{ translateX: 0 }] },
      animations: {
        transform: [
          { translateX: withSpring(values.windowWidth, springs.pane) },
        ],
      },
    };
  };
}

/*
 * The canvas's build as it arrives, and its leaving (REDESIGN.md 7, R-1 to
 * R-6). Each part enters on its own beat, `delay` ms after the canvas
 * mounts. Under Reduce Motion each is the plain crossfade.
 */

/** Something that comes up from `distance` points below, on the pane spring. */
export function riseFrom(
  distance: number,
  delay = 0,
): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return () => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: distance }] },
      animations: {
        transform: [
          { translateY: withDelay(delay, withSpring(0, springs.pane)) },
        ],
      },
    };
  };
}

/** Something that drops away below the bottom edge as the canvas leaves. */
export function dropAway(): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(SHOWN, HIDDEN, durations.exit);
  return (values: ExitAnimationsValues) => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: 0 }] },
      animations: {
        transform: [
          {
            translateY: withTiming(values.windowHeight, {
              duration: durations.move,
              easing: curves.exit,
            }),
          },
        ],
      },
    };
  };
}

/** Something that fades up in place. */
export function fadeIn(delay = 0): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return tween(
    HIDDEN,
    SHOWN,
    { duration: durations.enter, easing: curves.enter },
    delay,
  );
}

/**
 * A line that draws itself out from its middle, as the vessel does as the
 * wallet arrives.
 */
export function drawIn(delay = 0): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scaleX: 0.2 }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, { duration: durations.enter, easing: curves.enter }),
        ),
        transform: [
          { scaleX: withDelay(delay, withSpring(1, springs.soft)) },
        ],
      },
    };
  };
}

/** How far a control turns as it spins out or in, in degrees. */
const SPIN = 90;

/**
 * A control arriving where another is leaving, such as the corner's close
 * taking over from its cog (REDESIGN.md 7, T1): it turns in from a quarter
 * turn back, growing as it fades up, once the one it replaces is on its way.
 */
export function spinIn(): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(HIDDEN, SHOWN);
  return () => {
    'worklet';
    const config = { duration: durations.enter, easing: curves.enter };
    const toward = <T extends number | string>(value: T) =>
      withDelay(overlap.enterDelay, withTiming(value, config));
    return {
      initialValues: {
        opacity: 0,
        transform: [{ rotate: `${-SPIN}deg` }, { scale: 0.6 }],
      },
      animations: {
        opacity: toward(1),
        transform: [{ rotate: toward('0deg') }, { scale: toward(1) }],
      },
    };
  };
}

/** The control it replaces, turning on out of the way as it fades. */
export function spinOut(): EntryExitAnimationFunction {
  if (motionReduced()) return crossfade(SHOWN, HIDDEN, durations.exit);
  return () => {
    'worklet';
    return {
      initialValues: {
        opacity: 1,
        transform: [{ rotate: '0deg' }, { scale: 1 }],
      },
      animations: {
        opacity: withTiming(0, EXIT),
        transform: [
          { rotate: withTiming(`${SPIN}deg`, EXIT) },
          { scale: withTiming(0.6, EXIT) },
        ],
      },
    };
  };
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
