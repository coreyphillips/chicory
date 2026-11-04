import React from 'react';
import { AccessibilityInfo, Switch } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Path } from 'react-native-svg';
import { copy } from '../../../design/copy';
import { GLYPHS, GLYPH_LENGTHS } from '../../../design/glyphs';
import { palette } from '../../../design/palette';
import {
  SHAKE,
  SHAKE_STEP,
  curves,
  durations,
  springs,
} from '../../../motion/tokens';
import { SettingsScreen } from '../../../screens/Settings';
import type { WalletAdapter } from '../../../services/wallet';
import { snapshotOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import {
  AutoPayGlyph,
  BARS_OFF_OPACITY,
  BARS_OFF_SCALE,
  BOLT_OFF_OPACITY,
  BOLT_OFF_SCALE,
  BUZZ,
  FRAME_REACH,
  HapticsGlyph,
  barsPose,
  boltPose,
} from '../glyphMotion';
import { DrawnGlyph } from '../ui';

/**
 * The glyphs of Settings' rows that move in parts (REDESIGN.md 4, Animated
 * glyphs): the phone beside Haptics, which buzzes as haptics come back on;
 * the scan frame beside Auto-pay, which closes on its bolt; and the app
 * lock's glyph, which draws itself in as the lock turns on. Under Reduce
 * Motion each only crossfades, or is simply there, and the haptics
 * themselves are unchanged.
 */

jest.mock('../../../services/lock', () => ({
  ...jest.requireActual('../../../services/lock'),
  supportedBiometry: jest.fn().mockResolvedValue('face'),
  isLockEnabled: jest.fn().mockResolvedValue(false),
  setLockEnabled: jest.fn().mockResolvedValue(undefined),
}));

const s = copy.settings;

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn(),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
}

const trees: ReactTestRenderer[] = [];

async function settings() {
  const tree = await mount(
    <SettingsScreen
      snapshot={snapshotOf()}
      client={client()}
      switchError=""
      onRefresh={jest.fn()}
      onNetwork={jest.fn()}
    />,
  );
  trees.push(tree);
  // Reduce Motion and the phone's lock are read as Settings mounts.
  await act(async () => {});
  return tree;
}

async function glyph(on: boolean) {
  const tree = await mount(
    <HapticsGlyph on={on} size={18} color={palette.bloom} />,
  );
  trees.push(tree);
  await act(async () => {});
  return tree;
}

async function autoPayGlyph(on: boolean) {
  const tree = await mount(
    <AutoPayGlyph on={on} size={18} color={palette.bloom} />,
  );
  trees.push(tree);
  await act(async () => {});
  return tree;
}

/** The timings run toward `to` for `duration`. */
const timed = (timing: jest.SpyInstance, to: number, duration: number) =>
  timing.mock.calls.filter(
    ([target, config]) => target === to && config?.duration === duration,
  );

/** The parts each layer of a drawn glyph holds, top to bottom. */
const drawn = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Path).map(path => path.props.d);

function useMotion(reduced: boolean) {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(reduced);
  });
}

afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the numbers', () => {
  test('the buzz is the shake at .15 of its reach, 330ms in all', () => {
    expect(BUZZ.map(x => +x.toFixed(2))).toEqual([
      0, -1.2, 1.2, -0.75, 0.75, -0.3, 0,
    ]);
    expect(BUZZ).toHaveLength(SHAKE.length);
    expect((BUZZ.length - 1) * SHAKE_STEP).toBe(330);
  });

  test.each([
    [0, false, false, BARS_OFF_OPACITY, BARS_OFF_SCALE],
    [1, false, true, 1, 1],
    [0.5, false, true, 0.675, 0.8],
    // Reduced, the bars only crossfade: their length is set at once.
    [0.5, true, true, 0.675, 1],
    [0.5, true, false, 0.675, BARS_OFF_SCALE],
  ])(
    'the bars at %f, reduced %s and on %s: opacity %f, length %f',
    (at, reduced, on, opacity, scale) => {
      const pose = barsPose(at, reduced, on);
      expect(pose.opacity).toBeCloseTo(opacity);
      expect(pose.scaleY).toBeCloseTo(scale);
    },
  );
});

describe('the bolt', () => {
  it.each([
    [0, false, false, BOLT_OFF_OPACITY, BOLT_OFF_SCALE],
    [1, false, true, 1, 1],
    [0.5, false, true, 0.675, 0.85],
    // Reduced, the bolt only crossfades: its size is set at once.
    [0.5, true, true, 0.675, 1],
    [0.5, true, false, 0.675, BOLT_OFF_SCALE],
  ])(
    'at %f, reduced %s and on %s: opacity %f, scale %f',
    (at, reduced, on, opacity, scale) => {
      const pose = boltPose(at, reduced, on);
      expect(pose.opacity).toBeCloseTo(opacity);
      expect(pose.scale).toBeCloseTo(scale);
    },
  );
});

describe('the glyphs as they move', () => {
  useMotion(false);

  test('the phone buzzes and its bars pop as haptics come on, and the bars rest as they go off', async () => {
    const tree = await glyph(false);
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await act(async () =>
      tree.update(<HapticsGlyph on size={18} color={palette.bloom} />),
    );
    expect(sequence).toHaveBeenCalledTimes(1);
    const steps = timing.mock.calls.filter(
      ([, config]) => config?.duration === SHAKE_STEP,
    );
    expect(steps.map(([to]) => +(to as number).toFixed(2))).toEqual([
      -1.2, 1.2, -0.75, 0.75, -0.3, 0,
    ]);
    expect(steps.every(([, config]) => config?.easing === curves.linear)).toBe(
      true,
    );
    expect(springing).toHaveBeenCalledWith(1, springs.reveal);
    timing.mockClear();
    await act(async () =>
      tree.update(<HapticsGlyph on={false} size={18} color={palette.bloom} />),
    );
    expect(timed(timing, 0, durations.exit)).toHaveLength(1);
    expect(sequence).toHaveBeenCalledTimes(1);
  });

  test('what it shows as it is first drawn is where it rests', async () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    await glyph(true);
    await glyph(false);
    expect(sequence).not.toHaveBeenCalled();
    expect(springing).not.toHaveBeenCalledWith(1, springs.reveal);
  });

  test('the phone and its bars are drawn apart, so the phone moves alone', async () => {
    const tree = await glyph(true);
    const [body, left, right] = GLYPHS.haptics;
    expect(drawn(tree)).toEqual([left.d, right.d, body.d]);
  });

  test('the frame closes on its bolt and the bolt pops as Auto-pay comes on, and the bolt rests as it goes off', async () => {
    const tree = await autoPayGlyph(false);
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await act(async () =>
      tree.update(<AutoPayGlyph on size={18} color={palette.bloom} />),
    );
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(timed(timing, FRAME_REACH, durations.tick)).toHaveLength(1);
    expect(
      springing.mock.calls.filter(
        ([to, config]) => to === 1 && config === springs.reveal,
      ),
    ).toHaveLength(2);
    timing.mockClear();
    await act(async () =>
      tree.update(<AutoPayGlyph on={false} size={18} color={palette.bloom} />),
    );
    expect(timed(timing, 0, durations.exit)).toHaveLength(1);
    expect(sequence).toHaveBeenCalledTimes(1);
  });

  test('the auto-pay glyph rests where it is first drawn, its frame and bolt apart', async () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const tree = await autoPayGlyph(true);
    await autoPayGlyph(false);
    expect(sequence).not.toHaveBeenCalled();
    expect(springing).not.toHaveBeenCalled();
    const [frame, bolt] = GLYPHS.autoPay;
    expect(drawn(tree)).toEqual([frame.d, bolt.d]);
  });

  test('the app lock’s glyph draws itself in as the lock turns on', async () => {
    const tree = await settings();
    expect(tree.root.findAllByType(DrawnGlyph)).toHaveLength(0);
    const toggle = tree.root.find(
      node =>
        node.type === Switch &&
        node.props.accessibilityLabel === s.phone.requireLabel('Face ID'),
    );
    await act(async () => toggle.props.onValueChange(true));
    const [face] = tree.root.findAllByType(DrawnGlyph);
    expect(face.props.name).toBe('faceScan');
    // It starts undrawn and draws along its length.
    const [part] = face.findAllByType(Path);
    expect(part.props.animatedProps.strokeDashoffset).toBe(
      GLYPH_LENGTHS.faceScan[0],
    );
  });
});

// Last in the file: Reduce Motion, once read, holds for the next mount.
describe('under Reduce Motion', () => {
  useMotion(true);

  test('the phone holds still and its bars only crossfade', async () => {
    const tree = await glyph(false);
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await act(async () =>
      tree.update(<HapticsGlyph on size={18} color={palette.bloom} />),
    );
    expect(sequence).not.toHaveBeenCalled();
    expect(springing).not.toHaveBeenCalled();
    expect(timed(timing, 1, durations.crossfade)).toHaveLength(1);
  });

  test('the auto-pay frame holds still and its bolt only crossfades', async () => {
    const tree = await autoPayGlyph(false);
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await act(async () =>
      tree.update(<AutoPayGlyph on size={18} color={palette.bloom} />),
    );
    expect(sequence).not.toHaveBeenCalled();
    expect(springing).not.toHaveBeenCalled();
    expect(timed(timing, 1, durations.crossfade)).toHaveLength(1);
  });

  test('the app lock’s glyph is simply there', async () => {
    const tree = await settings();
    const toggle = tree.root.find(
      node =>
        node.type === Switch &&
        node.props.accessibilityLabel === s.phone.requireLabel('Face ID'),
    );
    await act(async () => toggle.props.onValueChange(true));
    const [face] = tree.root.findAllByType(DrawnGlyph);
    const [part] = face.findAllByType(Path);
    expect(part.props.animatedProps.strokeDashoffset).toBe(0);
  });
});
