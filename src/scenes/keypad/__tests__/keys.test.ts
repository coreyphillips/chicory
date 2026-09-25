import { number } from '../../../theme';
import {
  MOST_DIGITS,
  amountCells,
  digitsOnly,
  grouped,
  pressKey,
} from '../keys';

describe('pressKey', () => {
  test.each([
    ['', '4', '4'],
    ['4', '2', '42'],
    ['42', 'back', '4'],
    ['4', 'back', ''],
    ['', 'back', ''],
  ] as const)('%p then %p is %p', (digits, key, after) => {
    expect(pressKey(digits, key)).toBe(after);
  });

  test('a zero before any other digit adds nothing', () => {
    expect(pressKey('', '0')).toBe('');
    expect(pressKey('4', '0')).toBe('40');
  });

  test('refuses a digit past the most an amount of sats needs', () => {
    const full = '1'.repeat(MOST_DIGITS);
    expect(pressKey(full.slice(1), '1')).toBe(full);
    expect(pressKey(full, '1')).toBeNull();
    // Deleting is never refused.
    expect(pressKey(full, 'back')).toBe(full.slice(1));
  });
});

describe('grouped', () => {
  test.each([4_200, 24_425, 1_000_000, 7, 2_100_000_000_000_000])(
    '%p groups as the amount formatter does',
    value => {
      expect(grouped(String(value))).toBe(number(value));
    },
  );

  test('works on the digits, so nothing is rounded on the way', () => {
    expect(grouped('9999999999999999')).toBe('9,999,999,999,999,999');
  });

  test('drops what is not a digit and the zeros in front', () => {
    expect(grouped('12,345 sats')).toBe('12,345');
    expect(grouped('05')).toBe('5');
    expect(grouped('')).toBe('');
    expect(digitsOnly('0.5')).toBe('05');
  });
});

describe('amountCells', () => {
  test('one cell per digit, each carrying the separator after it', () => {
    expect(amountCells('4200')).toEqual([
      { key: 'd0', text: '4,' },
      { key: 'd1', text: '2' },
      { key: 'd2', text: '0' },
      { key: 'd3', text: '0' },
    ]);
  });

  test('a digit keeps its cell as more are keyed after it', () => {
    const before = amountCells('420').map(cell => cell.key);
    const after = amountCells('4200').map(cell => cell.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  test('an amount of nothing, or of zeros, has no cells', () => {
    expect(amountCells('')).toEqual([]);
    expect(amountCells('000')).toEqual([]);
  });
});
