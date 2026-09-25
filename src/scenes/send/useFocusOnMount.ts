import { useEffect } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { View } from 'react-native';

/**
 * Moves a screen reader to the element `ref` holds as it arrives, the
 * primary element of the step it belongs to (REDESIGN.md 9): the hold on a
 * review, the mark on a result. It runs in the element's own effect, which
 * React runs before its screen's, so anything the screen then says aloud
 * comes after the move and is not cut short by it.
 */
export function useFocusOnMount(
  ref: RefObject<ComponentRef<typeof View> | null>,
) {
  useEffect(() => {
    if (ref.current) {
      AccessibilityInfo.sendAccessibilityEvent(ref.current, 'focus');
    }
  }, [ref]);
}
