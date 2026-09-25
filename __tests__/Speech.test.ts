import { announce, forgetSpoken } from '../src/design/announce';
import {
  FOCUS_SETTLE_MS,
  announceSafety,
  forgetSafety,
} from '../src/motion/speech';

jest.mock('../src/design/announce', () => ({
  announce: jest.fn(),
  forgetSpoken: jest.fn(),
}));

/**
 * Safety messages (REDESIGN.md 9): held until the screen has settled, said
 * together in order, and never carried from one test into the next.
 */
const said = jest.mocked(announce);

beforeEach(() => {
  jest.useFakeTimers();
  forgetSafety();
  forgetSpoken();
  said.mockClear();
});
afterEach(() => {
  forgetSafety();
  jest.useRealTimers();
});

const settle = () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 50);

test('messages that begin together are said as one, in order of how much they matter', () => {
  announceSafety('Test network.', 'testNetwork');
  announceSafety('Payment status unknown.', 'held');
  expect(said).not.toHaveBeenCalled();
  settle();
  expect(said.mock.calls).toEqual([
    ['Payment status unknown. Test network.', { assertive: true }],
  ]);
});

test('a message withdrawn before it is heard is not said', () => {
  const withdraw = announceSafety('Balance not confirmed recently.', 'stale');
  withdraw();
  settle();
  expect(said).not.toHaveBeenCalled();
});

test('forgetting drops what is waiting, and what comes next is said on its own', () => {
  announceSafety('Request expired.', 'expired');
  // A test that ends here, with its clock thrown away, leaves this unsaid.
  forgetSafety();
  settle();
  expect(said).not.toHaveBeenCalled();
  announceSafety('Address reused.', 'reused');
  settle();
  expect(said.mock.calls).toEqual([['Address reused.', { assertive: true }]]);
});
