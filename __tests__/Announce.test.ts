import { AccessibilityInfo, Platform } from 'react-native';
import { announce, forgetSpoken } from '../src/design/announce';

const polite = jest.mocked(AccessibilityInfo.announceForAccessibility);
const withOptions = jest.mocked(
  AccessibilityInfo.announceForAccessibilityWithOptions,
);

beforeEach(() => {
  jest.useFakeTimers();
  polite.mockClear();
  withOptions.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// The dedupe window is module state, so each test speaks its own words.
describe('repeats', () => {
  test('an identical message within 2s is dropped', () => {
    announce('Payment received.');
    announce('Payment received.');
    jest.advanceTimersByTime(1999);
    announce('Payment received.');
    expect(withOptions).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    announce('Payment received.');
    expect(withOptions).toHaveBeenCalledTimes(2);
  });

  test('the window runs from the last time it was spoken', () => {
    announce('Reconnecting.');
    jest.advanceTimersByTime(1500);
    announce('Reconnecting.');
    jest.advanceTimersByTime(500);
    announce('Reconnecting.');
    expect(withOptions).toHaveBeenCalledTimes(2);
  });

  test('a message in between does not reset the window', () => {
    announce('Payment detected.');
    announce('Part of it is here.');
    announce('Payment detected.');
    expect(withOptions.mock.calls.map(([text]) => text)).toEqual([
      'Payment detected.',
      'Part of it is here.',
    ]);
  });

  test('a test can forget what was said, and hear it again at once', () => {
    announce('Balance may be out of date.');
    forgetSpoken();
    announce('Balance may be out of date.');
    expect(withOptions).toHaveBeenCalledTimes(2);
  });

  test('an empty message says nothing', () => {
    announce('');
    expect(withOptions).not.toHaveBeenCalled();
    expect(polite).not.toHaveBeenCalled();
  });
});

describe('routing', () => {
  test('on iOS an assertive message interrupts and a polite one queues', () => {
    announce('Payment status unknown.', { assertive: true });
    announce('Copied.');
    expect(withOptions.mock.calls).toEqual([
      ['Payment status unknown.', { queue: false }],
      ['Copied.', { queue: true }],
    ]);
    expect(polite).not.toHaveBeenCalled();
  });

  test('elsewhere both kinds use the one announcement call', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    announce('Save your recovery phrase.', { assertive: true });
    announce('Request expired.');
    expect(polite.mock.calls).toEqual([
      ['Save your recovery phrase.'],
      ['Request expired.'],
    ]);
    expect(withOptions).not.toHaveBeenCalled();
  });
});
