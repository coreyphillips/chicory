import React, { createRef, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { open } from '@op-engineering/op-sqlite';
import * as client from '../src/embedded/client';
import { AMBIENT_REST_MS, useAmbientRest } from '../src/motion/ambient';
import { Gallery, SHOTS } from '../native-tests/Gallery';
import {
  POLL_MS,
  Probe,
  WAIT_MS,
  perform,
} from '../native-tests/gallery/drive';
import { press } from '../native-tests/gallery/shots';

/**
 * The on-device gallery (native-tests/Gallery.tsx), run here through one
 * full cycle. Worklets run on the JS thread under Jest, so this cannot see
 * what only the UI thread would; that is what the gallery is for. What it
 * does see: every state draws without throwing, every control a step
 * reaches for is there to be pressed, nothing reaches the secure store
 * or the clipboard, opens a vault or starts the engine, and decoration
 * never comes to rest, so its loops run in every state.
 *
 * Here every control is there the moment its step comes. On a phone a scene
 * takes real time to arrive, so each step waits for its control; the first
 * test proves that wait on controls made to come late.
 */

/** Records whether decoration rests, each time it renders. */
function Rest({ seen }: { seen: boolean[] }) {
  seen.push(useAmbientRest());
  return null;
}

// The keychain and the clipboard as Metro bundles them: ES modules whose
// exports every importer shares, so the gallery's seal reaches the screens
// here as it does on a phone. Each call that gets past it is recorded.
jest.mock('react-native-keychain', () => {
  const reached: string[] = [];
  const guard = (name: string) =>
    jest.fn(async () => {
      reached.push(name);
      return false;
    });
  return {
    __esModule: true,
    reached,
    getGenericPassword: guard('getGenericPassword'),
    setGenericPassword: guard('setGenericPassword'),
    hasGenericPassword: guard('hasGenericPassword'),
    resetGenericPassword: guard('resetGenericPassword'),
    getAllGenericPasswordServices: guard('getAllGenericPasswordServices'),
    getSupportedBiometryType: guard('getSupportedBiometryType'),
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly',
    },
    ACCESS_CONTROL: {
      BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE:
        'BiometryCurrentSetOrDevicePasscode',
    },
  };
});
jest.mock('@react-native-clipboard/clipboard', () => {
  const reached: string[] = [];
  return {
    __esModule: true,
    reached,
    default: {
      getString: jest.fn(async () => {
        reached.push('getString');
        return '';
      }),
      setString: jest.fn(() => reached.push('setString')),
    },
  };
});

const reached = (name: string) =>
  (jest.requireMock(name) as { reached: string[] }).reached;

/**
 * Controls as a slow phone draws them. One comes a second in and is enabled
 * a second after that; one starts work that takes a second and a half; one
 * sits under a view that takes no touches, as in a pane out of use.
 */
function Late({ tapped }: { tapped: (label: string) => void }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const timers = [1_000, 2_000].map((ms, index) =>
      setTimeout(() => setAt(index + 1), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <View>
      {at > 0 ? (
        <Pressable
          accessibilityLabel="Arrives"
          disabled={at < 2}
          onPress={() => tapped('Arrives')}
        />
      ) : null}
      <Pressable
        accessibilityLabel="Works"
        onPress={() => {
          tapped('Works');
          return new Promise<void>(resolve =>
            setTimeout(() => resolve(), 1_500),
          );
        }}
      />
      <Pressable accessibilityLabel="Next" onPress={() => tapped('Next')} />
      <View pointerEvents="none">
        <Pressable accessibilityLabel="Shut" onPress={() => tapped('Shut')} />
      </View>
    </View>
  );
}

test('a step waits for its control and the step before it, and misses only after waiting', async () => {
  jest.useFakeTimers();
  const start = Date.now();
  const since = () => Date.now() - start;
  const lines: [string, number][] = [];
  const log = jest
    .spyOn(console, 'log')
    .mockImplementation((line: unknown) => lines.push([String(line), since()]));
  const taps: [string, number][] = [];
  const probe = createRef<Probe>();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <Probe ref={probe} name="late">
        <Late tapped={label => taps.push([label, since()])} />
      </Probe>,
    );
  });
  const done = jest.fn();
  const steps = ['Arrives', 'Works', 'Next', 'Shut'].map(press);
  const cancel = perform(probe, 'late', steps, 500, done);
  for (let ms = 0; ms < 4 * WAIT_MS && !done.mock.calls.length; ms += POLL_MS) {
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS);
    });
  }
  cancel();
  await act(async () => tree.unmount());
  log.mockRestore();
  jest.useRealTimers();

  const when = Object.fromEntries(taps);
  expect(taps.map(([label]) => label)).toEqual(['Arrives', 'Works', 'Next']);
  // Drawn a second in, and pressed only once it is enabled.
  expect(when.Arrives).toBeGreaterThanOrEqual(2_000);
  // The work the step before started has finished.
  expect(when.Next - when.Works).toBeGreaterThanOrEqual(1_500);
  // A control that never comes into use is missed, once waited for.
  expect(lines.map(([line]) => line)).toEqual([
    'GALLERY MISS late: onPress "Shut", out of use',
  ]);
  expect(lines[0][1] - when.Next).toBeGreaterThanOrEqual(WAIT_MS);
  expect(done).toHaveBeenCalledTimes(1);
});

test('draws every state once, then says so and starts again', async () => {
  jest.useFakeTimers();
  const lines: string[] = [];
  const log = jest
    .spyOn(console, 'log')
    .mockImplementation((line: unknown) => lines.push(String(line)));
  const opened = jest.spyOn(client, 'openDeviceWallet');
  const rests: boolean[] = [];
  const started = Date.now();

  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <>
        <Gallery />
        <Rest seen={rests} />
      </>,
    );
  });
  // A timer at a time, so what one step starts has answered before the next.
  const most = SHOTS.length * 50;
  for (let at = 0; at < most && !lines.includes('GALLERY COMPLETE'); at++) {
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
  }
  const drawn = lines.filter(line => /^GALLERY \d+ /.test(line));
  const trouble = lines.filter(line => /^GALLERY (MISS|ERROR) /.test(line));
  const ran = Date.now() - started;

  await act(async () => tree.unmount());
  log.mockRestore();
  jest.useRealTimers();
  const engineStarted = opened.mock.calls.length > 0;
  opened.mockRestore();

  expect(trouble).toEqual([]);
  expect(lines).toContain('GALLERY COMPLETE');
  expect(drawn).toEqual(
    SHOTS.map((shot, index) => `GALLERY ${index} ${shot.name}`).concat(
      `GALLERY 0 ${SHOTS[0].name}`,
    ),
  );
  expect(new Set(SHOTS.map(shot => shot.name)).size).toBe(SHOTS.length);
  expect(reached('react-native-keychain')).toEqual([]);
  expect(reached('@react-native-clipboard/clipboard')).toEqual([]);
  expect(engineStarted).toBe(false);
  expect(open).not.toHaveBeenCalled();
  // Nothing touches the gallery, and a pass runs far longer than the quiet
  // after which decoration rests, yet each state wakes it as it comes up.
  expect(ran).toBeGreaterThan(AMBIENT_REST_MS * 5);
  expect(rests.length).toBeGreaterThan(0);
  expect(rests).not.toContain(true);
  // A few hundred states, most of them a mount of the whole stage, take
  // minutes rather than the usual seconds.
}, 600_000);
