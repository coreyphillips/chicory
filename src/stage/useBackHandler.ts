import { useEffect, useLayoutEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { haptics } from '../design/haptics';
import type { Phase } from './phase';
import { useStage } from './StageContext';

/**
 * Android's back button, answered by the stage.
 *
 * A payment or a new wallet in flight holds the user where they are, so the
 * press is swallowed and felt rather than obeyed. An overlay closes, then a
 * scene returns to the one under it, and a stage with nothing left to close
 * lets the system have the press, which leaves the app.
 *
 * The scene stack only means something while the canvas is showing. Outside
 * the wallet it can still hold the Settings a network switch will return to,
 * and a press there must not move a canvas nobody can see. A locked app
 * answers nothing.
 */
export function useBackHandler(phase: Phase['kind']) {
  const { state, dispatch } = useStage();
  // Read at press time, so the listener is added once rather than on every
  // change of scene.
  const current = useRef({ state, phase });
  useLayoutEffect(() => {
    current.current = { state, phase };
  }, [state, phase]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        const { state: now, phase: shown } = current.current;
        if (shown === 'locked') return false;
        if (now.busy) {
          haptics.warning();
          return true;
        }
        if (now.overlay || (shown === 'wallet' && now.stack.length > 0)) {
          dispatch({ type: 'back' });
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [dispatch]);
}
