import { useEffect } from 'react';
import { announce } from '../../design/announce';
import { recordDiagnostic } from '../../services/diagnosticLog';

/**
 * A safety state beginning (REDESIGN.md rule 4): felt with `feel`, spoken
 * assertively, and written to the diagnostic log, once each time it starts,
 * including when the wallet opens in it. What keeps it on screen until it
 * clears, and what it blocks, belong to the surfaces that draw it.
 */
export function useSafetySignal(
  on: boolean,
  message: string,
  feel: () => void,
) {
  useEffect(() => {
    if (!on) return;
    feel();
    announce(message, { assertive: true });
    recordDiagnostic({ phase: 'ui', message });
  }, [on, message, feel]);
}
