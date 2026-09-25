import { createContext, useContext } from 'react';

/**
 * What the Receive scene does for the screen it holds, which the screen
 * cannot do from inside its scroll view: answer Android back through the
 * stage, and tint the ground behind the whole slot.
 *
 * Outside the scene, as when a suite renders the screen alone, back is
 * never asked and there is no ground to tint, so both do nothing.
 */
export type Tint = 'night' | null;

export interface ReceiveHost {
  /**
   * A hook: answers Android back while `active` (REDESIGN.md 2.2), the way
   * `useSceneBack` does. The scene passes `useSceneBack` itself.
   */
  useBack: (handler: () => boolean, active: boolean) => void;
  /** The tint behind the scene: night while an offline receive is chosen. */
  setTint: (tint: Tint) => void;
}

const nothing: ReceiveHost = { useBack: () => {}, setTint: () => {} };

export const ReceiveHostContext = createContext<ReceiveHost>(nothing);

export const useReceiveHost = () => useContext(ReceiveHostContext);
