import { useResponder, useStage } from './StageContext';

/**
 * Takes the codes the scan overlay reads for the Send already open, while
 * `active` (REDESIGN.md 2.3).
 *
 * Pass `useIsCurrentScene(sceneKey)` as `active`, with the key the canvas
 * gives the Send scene, not `usePaneActive()`. The overlay covers the Send's
 * pane while it is open, so the pane is out of use exactly when a code
 * arrives, and a receiver keyed to it would already be gone.
 *
 * A scan started inside Send has its target set to `send`: the overlay hands
 * the code to the receiver that became active last, and the reducer closes
 * the overlay over the same Send. With no receiver, the overlay only closes
 * over that Send, and the code goes nowhere. A scan from home never reaches
 * a receiver: the reducer opens a fresh Send prefilled with the code.
 */
export function useScanReceiver(
  receiver: (value: string) => void,
  active: boolean,
) {
  useResponder(useStage().responders.scan, receiver, active);
}
