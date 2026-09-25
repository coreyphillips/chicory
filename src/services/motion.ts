import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { motion } from '../theme';

/**
 * Whether this device wants motion at all.
 *
 * Read once at mount and kept current through the accessibility event, so a
 * user who turns Reduce Motion on mid-session gets the calmer app immediately.
 * Haptics are not tied to it. With less on screen they carry more of the
 * meaning, so only Settings > Haptics turns them off (REDESIGN.md rule 7).
 */
let reduced = false;
export const motionReduced = () => reduced;

export function useReducedMotion() {
  const [value, setValue] = useState(reduced);
  useEffect(() => {
    let active = true;
    const apply = (next: boolean) => {
      reduced = next;
      if (active) setValue(next);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(apply)
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      apply,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return value;
}

/** Fade + rise used for screen and step transitions. */
export function useEnter(key: unknown, distance = 10) {
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [key, progress]);
  // Memoized, and not for tidiness. `interpolate` mints a new animated node
  // every call, and React Native compares a view's animated props by node
  // identity: a fresh node on every render means the whole animated-props graph
  // for this view is torn down and rebuilt each time, on the root wrapper.
  return useMemo(
    () => ({
      opacity: progress,
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [distance, 0],
          }),
        },
      ],
    }),
    [progress, distance],
  );
}

/**
 * Counts a balance up to its new value.
 *
 * Returns a plain number rather than an Animated node: the balance is rendered
 * with a formatter, and driving text through Animated would mean losing the
 * thousands separators. A reduced-motion device gets the value immediately.
 */
export function useCountUp(value: number, duration = motion.slow) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) {
      setShown(value);
      return;
    }
    const driver = new Animated.Value(0);
    const listener = driver.addListener(({ value: t }) =>
      setShown(Math.round(from + (value - from) * t)),
    );
    const animation = Animated.timing(driver, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => finished && setShown(value));
    return () => {
      animation.stop();
      driver.removeListener(listener);
    };
  }, [value, duration]);
  return shown;
}
