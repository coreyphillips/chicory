import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Activity under the copy guard (REDESIGN.md rule 1) and the accessibility
 * check (section 9): the list, its rows in every ring state, the attention
 * shelf, the filters and search, and the empty list. The activity and detail
 * track adds each state it redraws, drawn from test-support/fixtures.ts with
 * `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('activity', GUARDED);
