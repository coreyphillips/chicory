import { copy } from '../../../design/copy';
import {
  activityOf,
  everyActivity,
  receiptOf,
  requestOf,
} from '../../../../test-support/fixtures';
import {
  ALL,
  DAY_HEIGHT,
  ROW_HEIGHT,
  activitySections,
  attentionOf,
  emptyLabel,
  sectionLayout,
} from '../model';

/**
 * The list as data: what is pinned, what falls under which day, where each
 * section sits, and what an empty list says.
 */
const EVERY = everyActivity();

describe('the attention band', () => {
  const uncertain = activityOf('sent', 'uncertain', { seed: 3 });
  const partial = activityOf('request', 'pending', {
    seed: 1,
    receiveRequest: requestOf({}, 1),
    receiveStatus: receiptOf('partial'),
  });
  const done = activityOf('sent', 'completed', { seed: 0 });
  const older = activityOf('received', 'completed', { seed: 30 });

  test('pins unknown outcomes, then partial payments, above the days', () => {
    const sections = activitySections(
      [done, partial, uncertain, older],
      ALL,
      '',
    );
    expect(sections.map(section => section.id)).toEqual([
      uncertain.id,
      partial.id,
      `day:${done.id}`,
      done.id,
      `day:${older.id}`,
      older.id,
    ]);
  });

  test('marks where each pinned row sits in the band', () => {
    const bands = (items: (typeof done)[]) =>
      activitySections(items, ALL, '').map(section =>
        section.kind === 'item' ? section.band : 'header',
      );
    expect(bands([uncertain, done])).toEqual(['solo', 'header', undefined]);
    expect(bands([uncertain, partial, done])).toEqual([
      'start',
      'end',
      'header',
      undefined,
    ]);
    const second = activityOf('received', 'uncertain', { seed: 4 });
    expect(bands([uncertain, second, partial])).toEqual([
      'start',
      'middle',
      'end',
    ]);
  });

  test('keeps to the filter and the search like every other row', () => {
    expect(activitySections([uncertain, partial], 'Sent', '')).toEqual([
      { kind: 'item', id: uncertain.id, item: uncertain, band: 'solo' },
    ]);
    expect(activitySections([uncertain, partial], ALL, 'nothing')).toEqual([]);
  });

  test('names what each payment needs', () => {
    expect(attentionOf(uncertain)).toBe('uncertain');
    expect(attentionOf(partial)).toBe('partial');
    expect(attentionOf(done)).toBeNull();
    expect(attentionOf(EVERY['request paid, confirming'])).toBeNull();
  });
});

test('each section sits right after the one before, at its fixed height', () => {
  const sections = activitySections(
    [EVERY['sent completed'], EVERY['received completed']],
    ALL,
    '',
  );
  expect(sectionLayout(sections)).toEqual([
    { index: 0, offset: 0, length: DAY_HEIGHT },
    { index: 1, offset: DAY_HEIGHT, length: ROW_HEIGHT },
    { index: 2, offset: DAY_HEIGHT + ROW_HEIGHT, length: ROW_HEIGHT },
  ]);
});

test('an empty list says why to a screen reader', () => {
  expect(emptyLabel(ALL, '')).toBe(copy.activity.empty);
  expect(emptyLabel(ALL, '')).toBe('No activity yet.');
  expect(emptyLabel('Requests', '')).toBe('No requests payments.');
  expect(emptyLabel('Sent', '  coffee ')).toBe('No payments match “coffee”.');
});

test('a history out of order heads each run of a day once, under its own key', () => {
  const today = activityOf('sent', 'completed', { seed: 0 });
  const yesterday = activityOf('sent', 'completed', { seed: 30 });
  const laterToday = activityOf('received', 'completed', { seed: 1 });
  const sections = activitySections([today, yesterday, laterToday], ALL, '');
  const headers = sections.filter(section => section.kind === 'header');
  expect(headers).toHaveLength(3);
  expect(new Set(sections.map(section => section.id)).size).toBe(
    sections.length,
  );
});
