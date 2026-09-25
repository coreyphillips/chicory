import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * A payment’s detail under the copy guard and the accessibility check
 * (REDESIGN.md rules 1 and 9): its header, its lines and its copy chips, for
 * every kind of payment. The activity and detail track adds each state it
 * redraws, drawn from test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('detail', GUARDED);
