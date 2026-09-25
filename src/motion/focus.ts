import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { HostInstance } from 'react-native';
import { afterTransition } from './idle';

/*
 * Screen reader focus after a transition (REDESIGN.md 9): once a change has
 * settled, focus moves to the new primary element, instead of being lost
 * with the control that was pressed and then removed.
 */

/** Moves a screen reader to `node`, when there is one to move to. */
export function focusOn(node: HostInstance | null | undefined) {
  if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
}

/**
 * A ref for the element a screen reader should land on whenever `on` turns
 * true, and as it mounts while it is. It moves once no transition is
 * running: an element still arriving may not be in the accessibility tree
 * yet.
 */
export function useFocus<T extends HostInstance = HostInstance>(
  on = true,
): RefObject<T | null> {
  const target = useRef<T>(null);
  useEffect(() => {
    if (!on) return;
    return afterTransition(() => focusOn(target.current));
  }, [on]);
  return target;
}
