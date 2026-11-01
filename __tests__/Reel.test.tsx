import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Reel } from '../native-tests/Reel';
import { REEL } from '../native-tests/reel/shots';

/**
 * The recording reel (native-tests/Reel.tsx), run here through its one
 * pass. As with the gallery, worklets run on the JS thread under Jest, so
 * this cannot see what only the UI thread would show; what it does see is
 * that every shot plays through its late answers to its end, every control
 * a step reaches for is there, and the markers a recorder keys off come in
 * order, once each.
 */

// The keychain and the clipboard as Metro bundles them: ES modules whose
// exports the gallery's seal replaces before anything is drawn.
jest.mock('react-native-keychain', () => ({
  __esModule: true,
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => false),
  hasGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => false),
  getAllGenericPasswordServices: jest.fn(async () => []),
  getSupportedBiometryType: jest.fn(async () => null),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly',
  },
  ACCESS_CONTROL: {
    BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE:
      'BiometryCurrentSetOrDevicePasscode',
  },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {
    getString: jest.fn(async () => ''),
    setString: jest.fn(),
  },
}));

test('plays every shot once through its late answer, then says so and stays', async () => {
  jest.useFakeTimers();
  const lines: string[] = [];
  const log = jest
    .spyOn(console, 'log')
    .mockImplementation((line: unknown) => lines.push(String(line)));

  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Reel />);
  });
  // A timer at a time, so what one step starts has answered before the next.
  const most = REEL.length * 2000;
  for (let at = 0; at < most && !lines.includes('REEL COMPLETE'); at++) {
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
  }
  const marks = lines.filter(line => /^REEL /.test(line));
  const trouble = lines.filter(line => /^GALLERY (MISS|ERROR) /.test(line));

  await act(async () => tree.unmount());
  log.mockRestore();
  jest.useRealTimers();

  expect(trouble).toEqual([]);
  expect(marks).toEqual([
    ...REEL.flatMap((shot, index) => [
      `REEL ${index} ${shot.name}`,
      `REEL DONE ${index}`,
    ]),
    'REEL COMPLETE',
  ]);
  expect(new Set(REEL.map(shot => shot.name)).size).toBe(REEL.length);
}, 120_000);
