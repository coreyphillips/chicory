import { copy } from '../../../design/copy';
import {
  activityOf,
  everyActivity,
  receiptOf,
  requestOf,
} from '../../../../test-support/fixtures';
import { cellsFor } from '../../../glyphs/Odometer';
import { figureOf } from '../visual';
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

describe('the search', () => {
  const ten = activityOf('sent', 'completed', { seed: 1, amountSats: 10_000 });
  const lunch = activityOf('received', 'completed', {
    seed: 2,
    description: 'd1 lunch',
  });
  const found = (needle: string) =>
    activitySections([ten, lunch], ALL, needle)
      .filter(section => section.kind === 'item')
      .map(section => section.id);

  test('finds an amount as a row draws it, in either unit', () => {
    expect(found('10000')).toEqual([ten.id]);
    expect(found('10,000')).toEqual([ten.id]);
    expect(found('10,000 sats')).toEqual([ten.id]);
    expect(found('0.0001')).toEqual([ten.id]);
    expect(found('0.00010000 btc')).toEqual([ten.id]);
    expect(found('4,200')).toEqual([lunch.id]);
  });

  test('finds a payment by the note it carries', () => {
    expect(found('d1')).toEqual([lunch.id]);
  });
});

describe('an amount as a row draws it', () => {
  test('sats group in threes, as everywhere', () => {
    expect(figureOf(10_000, 'sats')).toEqual({
      value: '10,000',
      dim: '',
      suffix: 'sats',
    });
  });

  test('BTC keeps all eight decimals, its trailing zeros set apart for dust', () => {
    // The hero draws 0.00062235 BTC; the rows under it line up with it.
    expect(figureOf(5_000, 'btc')).toEqual({
      value: '0.00005',
      dim: '000',
      suffix: 'BTC',
    });
    expect(figureOf(62_235, 'btc')).toEqual({
      value: '0.00062235',
      dim: '',
      suffix: 'BTC',
    });
    // With no significant decimal, it is drawn whole: a point with nothing
    // after it reads as no number at all.
    expect(figureOf(100_000_000, 'btc')).toEqual({
      value: '1.00000000',
      dim: '',
      suffix: 'BTC',
    });
    expect(figureOf(0, 'btc')).toEqual({
      value: '0.00000000',
      dim: '',
      suffix: 'BTC',
    });
  });

  test('draws what the odometer draws, digit for digit', () => {
    for (const sats of [1, 12, 5_000, 120_000, 62_235, 250_010_000]) {
      const figure = figureOf(sats, 'btc');
      const cells = cellsFor(sats, 'btc');
      const drawn = cells
        .map(cell => (cell.kind === 'digit' ? String(cell.digit) : cell.char))
        .join('');
      const dimmed = cells
        .map(cell => (cell.kind === 'digit' && cell.dim ? cell.digit : ''))
        .join('');
      expect(`${figure.value}${figure.dim}`).toBe(drawn);
      expect(figure.dim).toBe(dimmed);
    }
  });
});
