import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Receive under the copy guard (REDESIGN.md rule 1) and the accessibility
 * check (section 9): the keypad, offline receive, the quote, the request and
 * its QR, and what arrives for it. The receive track adds each state it
 * redraws, drawn from test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('receive', GUARDED);
