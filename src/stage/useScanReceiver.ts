import { useResponder, useStage } from './StageContext';

/**
 * Takes the codes the scan overlay reads for the Send already open, while
 * `active` (REDESIGN.md 2.2). A scan started inside Send has its target set
 * to `send`: the overlay hands the code to the receiver that became active
 * last, then closes over the same Send. A scan from home, or one with no
 * receiver to take it, opens a fresh Send prefilled with the code instead.
 */
export function useScanReceiver(
  receiver: (value: string) => void,
  active: boolean,
) {
  useResponder(useStage().responders.scan, receiver, active);
}
