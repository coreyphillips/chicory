import React, { useCallback, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { curves, durations } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';

/**
 * The endless motions Receive uses, each a transform or an opacity on a view
 * around a still drawing (REDESIGN.md 3.5). Each stops and rests where
 * `useLoops` says a loop may not run, and is cancelled when it unmounts.
 */

const awake = (state: string | null | undefined) =>
  state !== 'background' && state !== 'inactive';

/**
 * Whether an endless loop may run here now: not under Reduce Motion, where
 * loops are still states (REDESIGN.md 8), not in a pane that is out of use,
 * and not while the app is in the background, where nobody sees it and it
 * would only cost battery.
 */
function useLoops(): boolean {
  const { reduced } = useMotionPrefs();
  const live = usePaneActive();
  const [foreground, setForeground] = useState(() =>
    awake(AppState.currentState),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setForeground(awake(state)),
    );
    return () => subscription.remove();
  }, []);
  return !reduced && live && foreground;
}

/** A value that runs `play` while `run`, and otherwise rests at `rest`. */
function useLoop(
  rest: number,
  play: () => number,
  run: boolean,
): SharedValue<number> {
  const value = useSharedValue(rest);
  useEffect(() => {
    if (!run) {
      cancelAnimation(value);
      value.set(rest);
      return;
    }
    value.set(play());
    return () => cancelAnimation(value);
  }, [run, rest, play, value]);
  return value;
}

/** Turns its children round, once per `period`: an orbit, a busy control. */
export function Spin({
  period = durations.orbit,
  style,
  children,
}: PropsWithChildren<{ period?: number; style?: StyleProp<ViewStyle> }>) {
  const run = useLoops();
  const play = useCallback(
    () =>
      withRepeat(
        withTiming(360, { duration: period, easing: curves.linear }),
        -1,
      ),
    [period],
  );
  const turn = useLoop(0, play, run);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get()}deg` }],
  }));
  return <Reanimated.View style={[style, spin]}>{children}</Reanimated.View>;
}

/** 8 degrees one way and the other, 4200ms a cycle, from level. */
const TILT = 8;
function rocking() {
  const half = { duration: durations.breathe / 2, easing: curves.sine };
  return withSequence(
    withTiming(-TILT, { duration: durations.breathe / 4, easing: curves.sine }),
    withRepeat(
      withSequence(withTiming(TILT, half), withTiming(-TILT, half)),
      -1,
    ),
  );
}

/** Rocks its children 8 degrees either way over 4200ms: the moon. */
export function Rock({
  style,
  children,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const run = useLoops();
  const tilt = useLoop(0, rocking, run);
  const rock = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt.get()}deg` }],
  }));
  return <Reanimated.View style={[style, rock]}>{children}</Reanimated.View>;
}

/**
 * Fades its children between full and `low` and back, once per `period`: a
 * caret waiting for digits, a halo asking to be pressed. Where loops rest it
 * holds at full.
 */
export function Pulse({
  period = durations.halo,
  low = 0.2,
  style,
  children,
}: PropsWithChildren<{
  period?: number;
  low?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const run = useLoops();
  const play = useCallback(() => {
    const half = { duration: period / 2, easing: curves.sine };
    return withRepeat(
      withSequence(withTiming(low, half), withTiming(1, half)),
      -1,
    );
  }, [period, low]);
  const level = useLoop(1, play, run);
  const pulse = useAnimatedStyle(() => ({ opacity: level.get() }));
  return <Reanimated.View style={[style, pulse]}>{children}</Reanimated.View>;
}
