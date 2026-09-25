import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Send under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): compose, the keypad, review with the hold, and every result,
 * the held ring included. The send track adds each state it redraws, drawn
 * from test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('send', GUARDED);
