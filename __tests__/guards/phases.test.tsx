import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * The shell phases under the copy guard (REDESIGN.md rule 1) and the
 * accessibility check (section 9): the lock, opening, closing, switching,
 * erasing, and the ways back into a wallet. The phases track adds each state
 * it redraws, drawn from test-support/fixtures.ts with `guardData` as its
 * data.
 */
const GUARDED: GuardedState[] = [];

guard('phases', GUARDED);
