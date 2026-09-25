import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Receive under the copy guard and the accessibility check (REDESIGN.md rules 1
 * and 9): the keypad, offline receive, the quote, the request and its QR, and
 * what arrives for it. The receive track adds each state it redraws, drawn from
 * test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('receive', GUARDED);
