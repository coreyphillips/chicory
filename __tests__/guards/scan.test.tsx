import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Scan under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): the reveal, a code read or refused, and a camera that is
 * denied or missing. The scan track adds each state it redraws, drawn from
 * test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('scan', GUARDED);
