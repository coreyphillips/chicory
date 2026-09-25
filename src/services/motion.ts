import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
