import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Home under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): the status row, the balance, the vessel and the actions, in
 * each wallet health state. The home track adds each state it redraws, drawn
 * from test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('home', GUARDED);
