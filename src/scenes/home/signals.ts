import { useEffect, useState } from 'react';
import { announceSafety } from '../../motion/speech';
import type { SafetyKind } from '../../motion/speech';
import { recordDiagnostic } from '../../services/diagnosticLog';

/**
 * A safety state beginning (REDESIGN.md rule 4): felt with `feel` and
 * written to the diagnostic log at once, and spoken assertively once the
 * screen has settled, together with any other state that began with it, in
 * order of `kind` (`motion/speech`). It plays once each time the state
 * starts, including when the wallet opens in it, and a state that ends
 * before it is heard is not said. What keeps it on screen until it clears,
 * and what it blocks, belong to the surfaces that draw it.
 */
export function useSafetySignal(
  on: boolean,
  message: string,
  feel: () => void,
  kind: SafetyKind,
) {
  useEffect(() => {
    if (!on) return;
    feel();
    recordDiagnostic({ phase: 'ui', message });
    return announceSafety(message, kind);
  }, [on, message, feel, kind]);
}

/**
 * Whether `on` has held for `ms` without a break. It turns false the
 * moment `on` does.
 */
export function useOverdue(on: boolean, ms: number): boolean {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    setOverdue(false);
    if (!on) return;
    const timer = setTimeout(() => setOverdue(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && overdue;
}
