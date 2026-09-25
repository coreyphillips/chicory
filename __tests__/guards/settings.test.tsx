import { guard } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Settings under the copy guard and the accessibility check (REDESIGN.md rules
 * 1 and 9): Settings itself, the setup surfaces and the new wallet sheet. The
 * copy guard skips what sits under the Settings marker; the accessibility check
 * reads all of it. The settings track adds each state it redraws, drawn from
 * test-support/fixtures.ts with `guardData` as its data.
 */
const GUARDED: GuardedState[] = [];

guard('settings', GUARDED);
