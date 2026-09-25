import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { HostInstance } from 'react-native';
import { afterTransition } from '../../motion/idle';

/** Where a screen reader's focus goes when a step changes. */
export type Focus = RefObject<HostInstance | null>;

/**
 * Sends a screen reader's focus to `target` each time `key` changes, once
 * the views have settled (REDESIGN.md 9): the element a step is about, such
 * as the control that goes on, or the words for what just happened. The
 * first step is left alone, since the scene's own header takes focus as it
 * arrives.
 */
export function useFocusOn(target: Focus, key: string) {
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    return afterTransition(() => {
      if (target.current) {
        AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
      }
    });
  }, [key, target]);
}
