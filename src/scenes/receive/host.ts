import { createContext, useContext } from 'react';

/**
 * What the Receive scene does for the screen it holds, which the screen
 * cannot do from inside its scroll view: answer Android back through the
 * stage. The ground's tint is the stage's (`useHoldTint`).
 *
 * Outside the scene, as when a suite renders the screen alone, back is
 * never asked, so it does nothing.
 */
export interface ReceiveHost {
  /**
   * A hook: answers Android back while `active` (REDESIGN.md 2.2), the way
   * `useSceneBack` does. The scene passes `useSceneBack` itself.
   */
  useBack: (handler: () => boolean, active: boolean) => void;
}

const nothing: ReceiveHost = { useBack: () => {} };

export const ReceiveHostContext = createContext<ReceiveHost>(nothing);

export const useReceiveHost = () => useContext(ReceiveHostContext);
