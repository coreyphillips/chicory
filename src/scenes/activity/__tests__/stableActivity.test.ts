import { stableActivity } from '../../../stage/useStableActivity';
import {
  activityOf,
  everyActivity,
  receiptOf,
} from '../../../../test-support/fixtures';

/**
 * The history kept stable across polls (REDESIGN.md 2.3, performance): a
 * payment that did not change keeps its object, so its memoized row does not
 * redraw.
 */
const EVERY = everyActivity();

describe('a history kept across polls', () => {
  // Every poll builds each payment afresh, equal but never the same object.
  const poll = (items: typeof EVERY) =>
    Object.values(items).map(item => JSON.parse(JSON.stringify(item)));

  test('hands back the list it held when nothing changed', () => {
    const first = poll(EVERY);
    expect(stableActivity(first, poll(EVERY))).toBe(first);
  });

  test('keeps each unchanged payment, and takes each changed one', () => {
    const first = poll(EVERY);
    const next = poll(EVERY);
    const changed = next.findIndex(
      item => item.id === EVERY['request partly paid'].id,
    );
    next[changed] = {
      ...next[changed],
      receiveStatus: receiptOf('pending'),
    };
    const stable = stableActivity(first, next);
    expect(stable).not.toBe(first);
    stable.forEach((item, index) => {
      expect(item).toBe(index === changed ? next[changed] : first[index]);
    });
  });

  test('keeps a payment that moved, and takes one that is new', () => {
    const first = poll(EVERY);
    const arrived = activityOf('received', 'completed', { seed: 99 });
    const stable = stableActivity(first, [arrived, ...poll(EVERY)]);
    expect(stable[0]).toBe(arrived);
    expect(stable.slice(1)).toEqual(first);
    stable.slice(1).forEach((item, index) => expect(item).toBe(first[index]));
  });
});
