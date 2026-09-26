import { haptic } from '../services/haptics';

/**
 * The haptic vocabulary (REDESIGN.md 3.6). Components name what happened, not
 * which motor to drive, so a feel is tuned in one place and a pattern such as
 * `incoming` means one thing everywhere.
 *
 * Reduce Motion never silences these; with fewer words on screen they carry
 * more of the meaning. Only Settings > Haptics turns them off.
 */
const pending = new Set<ReturnType<typeof setTimeout>>();

const later = (ms: number, play: () => void) => {
  const timer = setTimeout(() => {
    pending.delete(timer);
    play();
  }, ms);
  pending.add(timer);
};

/**
 * Drops the later beats of patterns still playing. For tests only, so a
 * pattern one test began is not felt in the next.
 */
export function forgetPendingHaptics() {
  pending.forEach(clearTimeout);
  pending.clear();
}

export const haptics = {
  /** Keys, chips, toggles and row taps. */
  tick: () => haptic('selection'),
  /** A primary control pressed in. */
  tap: () => haptic('light'),
  /** A hold completing, or a code detected. */
  thud: () => haptic('medium'),
  /** A key refused. */
  rigid: () => haptic('rigid'),
  /** Petal steps, a liquid settling, a pull crossing its threshold. */
  soft: () => haptic('soft'),
  success: () => haptic('success'),
  warning: () => haptic('warning'),
  error: () => haptic('error'),
  /** Money arrived, and nothing else: a success, then two light taps. */
  incoming: () => {
    haptic('success');
    later(120, () => haptic('light'));
    later(240, () => haptic('light'));
  },
  /** A payment held because its outcome is unknown: a warning, twice. */
  held: () => {
    haptic('warning');
    later(300, () => haptic('warning'));
  },
  /**
   * Hold to send, called as each quarter of the hold is reached (1 to 4): a
   * tick for the first three and a thud when the hold completes.
   */
  holdRamp: (step: number) => haptic(step >= 4 ? 'medium' : 'selection'),
};
