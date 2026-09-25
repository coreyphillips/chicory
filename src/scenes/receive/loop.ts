import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';

const awake = (state: string | null | undefined) =>
  state !== 'background' && state !== 'inactive';

/**
 * Whether an endless loop may run here now: not under Reduce Motion, where
 * loops are still states (REDESIGN.md 8), not in a pane that is out of use,
 * and not while the app is in the background, where nobody sees it and it
 * would only cost battery.
 */
export function useLoops(): boolean {
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
