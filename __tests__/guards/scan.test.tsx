import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  CAUGHT_HOLD,
  CAUGHT_SCALE,
  REFUSAL_QUIET_MS,
  Scanner,
  cornerPath,
  flight,
  reticleLoops,
  reticleOut,
  reticleSide,
  refusal,
  settleTurn,
  shouldRefuse,
} from '../../src/components/Scanner';
import * as Announce from '../../src/design/announce';
import { copy } from '../../src/design/copy';
import { haptics } from '../../src/design/haptics';
import { Whisper } from '../../src/glyphs/Whisper';
import { durations } from '../../src/motion/tokens';
import { STATUS_ROW } from '../../src/stage/layout';
import {
  BUTTON,
  PARTIAL,
  ScanReveal,
  collapse,
  counterScale,
  discFor,
  eased,
  groundCollapse,
  irisPose,
  WELL_DROP,
  landing,
  opening,
} from '../../src/stage/layers/ScanReveal';
import type {
  Closing,
  Pose,
  ScanRevealProps,
} from '../../src/stage/layers/ScanReveal';
import { guardData, requestOf, snapshotOf } from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import {
  componentName,
  pressableLabels,
  press,
  visibleText,
  whispers,
} from '../../test-support/query';

/**
 * Scan under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): the reveal, a code read or refused, and a camera that is
 * denied or missing. Then what each state does, since nothing on screen says
 * it: a code goes to Send only once it can be paid, a refusal is felt and
 * heard without stopping the camera, and on Android the camera never rides
 * the disc.
 */

// The camera module is optional. A test stands in for a build without it
// by clearing mockCamera, which leaves the module with no Camera.
let mockCamera = true;
jest.mock('react-native-camera-kit', () => ({
  get Camera() {
    return mockCamera ? 'Camera' : undefined;
  },
  CameraType: { Back: 'back', Front: 'front' },
}));

// Reanimated's mock lands every timing at once. A test that needs to stand
// in the middle of the reveal sets mockHoldTimings, which holds back each
// timing's end, and how long it runs, in mockHeld to be run later. Delays
// are noted in mockDelays, since the mock drops them.
const mockHeld: Array<{
  done: (finished?: boolean) => void;
  duration?: number;
}> = [];
const mockDelays: number[] = [];
let mockHoldTimings = false;
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    withTiming: (
      value: unknown,
      config?: { duration?: number },
      callback?: (finished?: boolean) => void,
    ) => {
      if (mockHoldTimings && callback) {
        mockHeld.push({ done: callback, duration: config?.duration });
        return value;
      }
      return mock.withTiming(value, config, callback);
    },
    withDelay: (delay: number, animation: unknown) => {
      mockDelays.push(delay);
      return animation;
    },
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  mockCamera = true;
  mockHoldTimings = false;
  mockHeld.length = 0;
  mockDelays.length = 0;
});

/** A BIP 173 example address, as a payment link: a code that can be paid. */
const PAYABLE =
  'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.0001';
/** A real invoice for 24,425 sats, from the send suite. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
/**
 * A fixture request: shaped like the real thing, but its address fails its
 * checksum, so the parser refuses it.
 */
const UNPAYABLE = requestOf().uri;
/** An LNURL: read by the parser, then refused as nothing this wallet pays. */
const LNURL =
  'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns';

const data = guardData(snapshotOf());

// The app draws the scan under its gesture root, which the camera-off
// status's whisper needs.
function scanner(props: Partial<React.ComponentProps<typeof Scanner>> = {}) {
  return (
    <GestureHandlerRootView>
      <Scanner onDetected={jest.fn()} onCancel={jest.fn()} {...props} />
    </GestureHandlerRootView>
  );
}

function reveal(props: Partial<ScanRevealProps> = {}) {
  return (
    <GestureHandlerRootView>
      <ScanReveal
        origin={{ x: 187, y: 520 }}
        target="home"
        onDetected={jest.fn()}
        onCancel={jest.fn()}
        {...props}
      />
    </GestureHandlerRootView>
  );
}

/** Android, with the camera permission answered by `result`. */
function onAndroid(result: Promise<string>) {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'request').mockReturnValue(result as never);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
}
const asking = () => onAndroid(new Promise(() => {}));
const denied = () =>
  onAndroid(Promise.resolve(PermissionsAndroid.RESULTS.DENIED));

function reducedMotion() {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
}

/** Every host node the tree draws labelled `label`. */
const labelled = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

/** The camera views drawn: camera-kit's mock draws a host named Camera. */
const cameras = (tree: ReactTestRenderer) =>
  tree.root.findAll(node => componentName(node.type) === 'Camera');

/** The scan's ground, drawn by the overlay's disc and over a new camera. */
const grounds = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node => typeof node.type !== 'string' && node.props.id === 'scan-ground',
  );

const reticle = (tree: ReactTestRenderer): ReactTestInstance | undefined =>
  labelled(tree, copy.scan.aim)[0];

/** The code the camera reads next, as camera-kit reports it. */
async function readCode(tree: ReactTestRenderer, value: string) {
  const [camera] = cameras(tree);
  await act(async () => {
    camera.props.onReadCode({ nativeEvent: { codeStringValue: value } });
  });
}

/**
 * The user leaves for the device settings, switches the camera on, and comes
 * back to the app.
 */
async function backWithCamera() {
  const changed = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([event]) => event === 'change')
    .map(([, handler]) => handler);
  jest.mocked(PermissionsAndroid.check).mockResolvedValue(true);
  await act(async () => changed.forEach(handler => handler('background')));
  await act(async () => changed.forEach(handler => handler('active')));
}

/** Mounts `element`, then does `then` to it, for a state's `render`. */
async function after(
  element: React.ReactElement,
  then: (tree: ReactTestRenderer) => Promise<void>,
) {
  const tree = await mount(element);
  await then(tree);
  return tree;
}

/** Presses paste, with the clipboard answering `value()`. */
const pasting =
  (value: () => Promise<string>) => async (tree: ReactTestRenderer) => {
    jest.mocked(Clipboard.getString).mockImplementationOnce(value);
    await press(tree, copy.scan.paste);
  };
const unreadable = () => Promise.reject(new Error('denied'));

const GUARDED: GuardedState[] = [
  { name: 'the scanner reading', render: () => mount(scanner()), data },
  {
    name: 'the scanner while its disc opens',
    render: () => mount(scanner({ live: false })),
    data,
  },
  {
    name: 'the scanner asking for the camera',
    render: () => {
      asking();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner with the camera switched off',
    render: () => {
      denied();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner in a build without a camera',
    render: () => {
      mockCamera = false;
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner with a code it can pay',
    render: () => after(scanner(), tree => readCode(tree, PAYABLE)),
    data,
  },
  {
    name: 'the scanner with a code it cannot pay',
    render: () => after(scanner(), tree => readCode(tree, UNPAYABLE)),
    data,
  },
  {
    name: 'the scanner with a code it reads and refuses',
    render: () => after(scanner(), tree => readCode(tree, LNURL)),
    data,
  },
  {
    name: 'the scanner with nothing to paste',
    render: () =>
      after(
        scanner(),
        pasting(async () => ''),
      ),
    data,
  },
  {
    name: 'the scanner with a clipboard it cannot read',
    render: () => after(scanner(), pasting(unreadable)),
    data,
  },
  {
    name: 'the scanner with a pasted code it cannot pay',
    render: () =>
      after(
        scanner(),
        pasting(async () => UNPAYABLE),
      ),
    data,
  },
  {
    name: 'the scanner after the camera failed',
    render: () =>
      after(scanner(), async tree => {
        await act(async () => cameras(tree)[0].props.onError());
      }),
    data,
  },
  {
    name: 'the scanner with the camera switched off and a pasted code it cannot pay',
    render: () => {
      denied();
      return after(
        scanner(),
        pasting(async () => LNURL),
      );
    },
    data,
  },
  {
    name: 'the scanner under Reduce Motion',
    render: () => {
      reducedMotion();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner asking for the camera under Reduce Motion',
    render: () => {
      reducedMotion();
      asking();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner under Reduce Motion with a code it cannot pay',
    render: () => {
      reducedMotion();
      return after(scanner(), tree => readCode(tree, UNPAYABLE));
    },
    data,
  },
  {
    name: 'the overlay opening from home',
    render: () => mount(reveal()),
    data,
  },
  {
    name: 'the overlay opening inside Send',
    render: () => mount(reveal({ origin: { x: 300, y: 180 }, target: 'send' })),
    data,
  },
  {
    name: 'the overlay with no button to grow from',
    render: () => mount(reveal({ origin: null })),
    data,
  },
  {
    name: 'the overlay before its disc has opened',
    render: () => {
      mockHoldTimings = true;
      return mount(reveal());
    },
    data,
  },
  {
    name: 'the overlay with the camera switched off',
    render: () => {
      denied();
      return mount(reveal());
    },
    data,
  },
  {
    name: 'the overlay in a build without a camera',
    render: () => {
      mockCamera = false;
      return mount(reveal());
    },
    data,
  },
  {
    name: 'the overlay with a code it cannot pay',
    render: () => after(reveal(), tree => readCode(tree, UNPAYABLE)),
    data,
  },
  {
    name: 'the overlay with a code it can pay',
    render: () => after(reveal(), tree => readCode(tree, PAYABLE)),
    data,
  },
  {
    name: 'the overlay under Reduce Motion',
    render: () => {
      reducedMotion();
      return mount(reveal());
    },
    data,
  },
];

guard('scan', GUARDED);

describe('the disc', () => {
  test('is centred on the scan button and reaches the farthest corner', () => {
    const disc = discFor({ x: 100, y: 600 }, 390, 844);
    expect(disc).toMatchObject({ x: 100, y: 600 });
    expect(disc.radius).toBeCloseTo(Math.hypot(290, 600));
    expect(disc.from * 2 * disc.radius).toBeCloseTo(BUTTON);
  });

  test('grows from the bottom centre when there is no button to grow from', () => {
    const disc = discFor(null, 390, 844);
    expect(disc).toMatchObject({ x: 195, y: 844 });
    expect(disc.radius).toBeCloseTo(Math.hypot(195, 844));
  });

  test('keeps its ground still at every scale', () => {
    const [width, height] = [390, 844];
    const disc = discFor({ x: 120, y: 700 }, width, height);
    const centre = { x: width / 2, y: height / 2 };
    for (const scale of [disc.from, 0.3, PARTIAL, 1]) {
      const still = counterScale(scale, disc, width, height);
      for (const point of [
        { x: 0, y: 0 },
        { x: 390, y: 844 },
        { x: 200, y: 100 },
      ]) {
        // The ground scales about its own centre, the disc about the origin.
        const inGround = {
          x: centre.x + still.translateX + still.scale * (point.x - centre.x),
          y: centre.y + still.translateY + still.scale * (point.y - centre.y),
        };
        const onScreen = {
          x: disc.x + scale * (inGround.x - disc.x),
          y: disc.y + scale * (inGround.y - disc.y),
        };
        expect(onScreen.x).toBeCloseTo(point.x);
        expect(onScreen.y).toBeCloseTo(point.y);
      }
    }
  });

  test('opens all the way onto a camera, and only partway without one', () => {
    expect(opening('checking')).toBe(1);
    expect(opening('granted')).toBe(1);
    expect(opening('denied')).toBe(PARTIAL);
    expect(opening('missing')).toBe(PARTIAL);
  });

  test("lands in Send's well: where it grew inside Send, the new Send's from home", () => {
    const disc = discFor({ x: 300, y: 180 }, 390, 844);
    expect(landing(disc, 'send', true, 390, 47)).toEqual({ x: 300, y: 180 });
    // The centre of the well: the mini strip, the slot's padding, half the
    // well.
    const well = { x: 195, y: 47 + STATUS_ROW + 44 + 16 + 36 };
    expect(WELL_DROP).toBe(96);
    expect(landing(disc, 'home', true, 390, 47)).toEqual(well);
    expect(landing(disc, 'send', false, 390, 47)).toEqual(well);
  });

  const [width, height] = [390, 844];
  const origin = { x: 120, y: 700 };
  const disc = discFor(origin, width, height);
  const toWell = { x: 75, y: -533 };
  const closing = (caught: number, scale = 1): Closing => ({
    scale: { get: () => scale },
    fade: { get: () => 1 },
    caught: { get: () => caught },
    disc,
    width,
    height,
    toWell,
  });

  /** Where a point of the ground is drawn, through its pose and the disc's. */
  function drawn(
    point: { x: number; y: number },
    pose: { disc: Pose; ground: Pose },
  ) {
    const centre = { x: width / 2, y: height / 2 };
    const { ground, disc: outer } = pose;
    const inDisc = {
      x: centre.x + ground.translateX + ground.scale * (point.x - centre.x),
      y: centre.y + ground.translateY + ground.scale * (point.y - centre.y),
    };
    return {
      x: disc.x + outer.translateX + outer.scale * (inDisc.x - disc.x),
      y: disc.y + outer.translateY + outer.scale * (inDisc.y - disc.y),
    };
  }

  test('closes like an iris, over a ground that holds still as it shrinks and moves', () => {
    for (const shift of [{ x: 0, y: 0 }, toWell]) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = irisPose(p, 0.8, disc.from, shift, disc, width, height);
        expect(pose.disc.scale).toBeCloseTo(0.8 + (disc.from - 0.8) * p);
        expect(pose.disc.translateX).toBeCloseTo(shift.x * p);
        expect(pose.disc.translateY).toBeCloseTo(shift.y * p);
        for (const point of [
          { x: 0, y: 0 },
          { x: 390, y: 844 },
          { x: 200, y: 100 },
        ]) {
          const seen = drawn(point, pose);
          expect(seen.x).toBeCloseTo(point.x);
          expect(seen.y).toBeCloseTo(point.y);
        }
      }
    }
    // It starts from the pose the opening left its ground in.
    const first = irisPose(0, 0.8, disc.from, toWell, disc, width, height);
    const opened = counterScale(0.8, disc, width, height);
    expect(first.ground.scale).toBe(opened.scale);
    expect(first.ground.translateX).toBeCloseTo(opened.translateX);
    expect(first.ground.translateY).toBeCloseTo(opened.translateY);
  });

  test("a timing eased along a curve lands on the value's own path every frame", () => {
    const value = (p: number) => 1 / (1 - 0.9 * p);
    const curve = (u: number) => u * u;
    const { to, easing } = eased(value, curve);
    expect(to).toBeCloseTo(10);
    for (const u of [0, 0.3, 0.6, 1]) {
      const from = value(0);
      expect(from + (to - from) * easing(u)).toBeCloseTo(value(curve(u)));
    }
    // A value that goes nowhere is already there.
    expect(eased(() => 4, curve).easing(0.5)).toBe(1);
  });

  test('closes back into its button on a close, and into the well on a code', () => {
    const closed = collapse(closing(0), false)({} as never);
    expect(closed.animations.transform).toEqual([
      { translateX: 0 },
      { translateY: 0 },
      { scale: disc.from },
    ]);
    const caught = collapse(closing(1), false)({} as never);
    expect(caught.animations.transform).toEqual([
      { translateX: toWell.x },
      { translateY: toWell.y },
      { scale: disc.from },
    ]);
    expect(caught.animations.opacity).toBe(0);
  });

  test('a code read holds the caught beat before the disc closes', () => {
    collapse(closing(0), false)({} as never);
    groundCollapse(closing(0))({} as never);
    expect(mockDelays).not.toContain(CAUGHT_HOLD);
    mockDelays.length = 0;
    collapse(closing(1), false)({} as never);
    groundCollapse(closing(1))({} as never);
    expect(mockDelays.filter(delay => delay === CAUGHT_HOLD)).toHaveLength(6);
  });

  test('its ground goes from the pose it stands in to the one that keeps it still', () => {
    for (const [caught, shift] of [
      [0, { x: 0, y: 0 }],
      [1, toWell],
    ] as const) {
      const out = groundCollapse(closing(caught, 0.8))({} as never);
      const at = (p: number) =>
        irisPose(p, 0.8, disc.from, shift, disc, width, height).ground;
      const pose = (ground: Pose) => [
        { translateX: ground.translateX },
        { translateY: ground.translateY },
        { scale: ground.scale },
      ];
      expect(out.initialValues.transform).toEqual(pose(at(0)));
      expect(out.animations.transform).toEqual(pose(at(1)));
    }
  });

  test('only fades under Reduce Motion', () => {
    const out = collapse(closing(1), true)({} as never);
    expect(out.animations).toEqual({ opacity: 0 });
  });
});

describe('the reticle', () => {
  test('turns while asking, breathes while reading, and holds still otherwise', () => {
    expect(reticleLoops('checking', false, true)).toEqual({
      spin: true,
      breathe: false,
    });
    expect(reticleLoops('scanning', false, true)).toEqual({
      spin: false,
      breathe: true,
    });
    expect(reticleLoops('waiting', false, true)).toEqual({
      spin: false,
      breathe: false,
    });
    // In the background, and under Reduce Motion, nothing loops.
    for (const mode of ['checking', 'scanning'] as const) {
      expect(reticleLoops(mode, false, false)).toEqual({
        spin: false,
        breathe: false,
      });
      expect(reticleLoops(mode, true, true)).toEqual({
        spin: false,
        breathe: false,
      });
    }
  });

  test('a spin stops on the next quarter turn, where it looks the same', () => {
    expect(settleTurn(0)).toBe(0);
    expect(settleTurn(1)).toBe(90);
    expect(settleTurn(90)).toBe(90);
    expect(settleTurn(359)).toBe(360);
    expect(settleTurn(725)).toBe(810);
  });

  test('each corner flies in from the nearest edge', () => {
    const side = reticleSide(390, 844);
    expect(side).toBe(265);
    expect(flight(390, 844, side)).toBe((390 - 265) / 2);
    expect(reticleSide(320, 480)).toBe(218);
    expect(reticleSide(1024, 1366)).toBe(280);
  });

  test('a corner is drawn inside its own box, bending at its corner', () => {
    expect(cornerPath(0, 0, 1, 1)).toBe('M1.5 26.5V9.5A8 8 0 0 1 9.5 1.5H26.5');
    expect(cornerPath(28, 28, -1, -1)).toBe(
      'M26.5 1.5V18.5A8 8 0 0 1 18.5 26.5H1.5',
    );
  });

  test('a caught code holds the corners pulled in; a close fades them at once', () => {
    const pose = { turn: { get: () => 90 }, breath: { get: () => 1 } };
    const caught = reticleOut(
      {
        caught: { get: () => 1 },
        pinch: { get: () => CAUGHT_SCALE },
        nudge: { get: () => 0 },
      },
      pose,
      false,
    )({} as never);
    expect(caught.animations.transform).toEqual([
      { translateX: 0 },
      { rotate: '90deg' },
      { scale: CAUGHT_SCALE },
    ]);
    const closed = reticleOut(
      {
        caught: { get: () => 0 },
        pinch: { get: () => 1 },
        nudge: { get: () => -5 },
      },
      pose,
      false,
    )({} as never);
    // It leaves from where its shake and turn had it, rather than jumping.
    expect(closed.initialValues.transform).toEqual([
      { translateX: -5 },
      { rotate: '90deg' },
      { scale: 1 },
    ]);
    expect(closed.animations.opacity).toBe(0);
    expect(closed.animations.transform).toEqual([
      { translateX: 0 },
      { rotate: '90deg' },
      { scale: 0.98 },
    ]);
  });
});

describe('what a code is', () => {
  test('one that can be paid is let through', () => {
    expect(refusal(PAYABLE)).toBeNull();
    expect(refusal(INVOICE)).toBeNull();
    expect(refusal(`lightning:${INVOICE}`)).toBeNull();
  });

  test('one the parser cannot read, or reads and refuses, is not', () => {
    expect(refusal(UNPAYABLE)).toMatch(/^That code is not a payment request\./);
    expect(refusal(LNURL)).toBe(
      'That code is not a payment request. That is an LNURL. This wallet pays invoices and offers, not LNURL.',
    );
    expect(refusal('   ')).toBe(copy.scan.invalid);
  });

  test('the same refused code complains at most once in 1.5s', () => {
    const last = { value: UNPAYABLE, at: 1_000 };
    expect(shouldRefuse(null, UNPAYABLE, 1_000)).toBe(true);
    expect(shouldRefuse(last, UNPAYABLE, 1_600)).toBe(false);
    expect(shouldRefuse(last, UNPAYABLE, 1_000 + REFUSAL_QUIET_MS)).toBe(true);
    expect(shouldRefuse(last, LNURL, 1_100)).toBe(true);
  });
});

describe('reading a code', () => {
  test('one that can be paid thuds and goes to Send in the same call', async () => {
    const thud = jest.spyOn(haptics, 'thud');
    const said = jest.spyOn(Announce, 'announce');
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    const [camera] = cameras(tree);
    act(() => {
      camera.props.onReadCode({ nativeEvent: { codeStringValue: PAYABLE } });
      expect(onDetected).toHaveBeenCalledWith(PAYABLE);
    });
    expect(thud).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(copy.scan.detected);
    await act(async () => tree.unmount());
  });

  test('a lightning link goes without its prefix, and only the first code counts', async () => {
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await readCode(tree, ` lightning:${INVOICE} `);
    await readCode(tree, PAYABLE);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(INVOICE);
    await act(async () => tree.unmount());
  });

  test('one that cannot be paid is refused, and the camera keeps reading', async () => {
    const error = jest.spyOn(haptics, 'error');
    const said = jest.spyOn(Announce, 'announce');
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await readCode(tree, LNURL);
    expect(onDetected).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(refusal(LNURL));
    expect(cameras(tree)).toHaveLength(1);
    await readCode(tree, PAYABLE);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE);
    await act(async () => tree.unmount());
  });

  test('a refused code held in view buzzes once per 1.5s, and a new one at once', async () => {
    const error = jest.spyOn(haptics, 'error');
    const now = jest.spyOn(Date, 'now');
    const tree = await mount(scanner());
    for (const at of [0, 600, 1_200]) {
      now.mockReturnValue(10_000 + at);
      await readCode(tree, UNPAYABLE);
    }
    expect(error).toHaveBeenCalledTimes(1);
    now.mockReturnValue(10_000 + REFUSAL_QUIET_MS);
    await readCode(tree, UNPAYABLE);
    expect(error).toHaveBeenCalledTimes(2);
    now.mockReturnValue(10_000 + REFUSAL_QUIET_MS + 100);
    await readCode(tree, LNURL);
    expect(error).toHaveBeenCalledTimes(3);
    await act(async () => tree.unmount());
  });

  test('a pasted code that can be paid goes to Send', async () => {
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await pasting(async () => ` ${PAYABLE}\n`)(tree);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE);
    await act(async () => tree.unmount());
  });

  test.each([
    ['an empty clipboard', async () => '', copy.scan.clipboardEmpty],
    [
      'a clipboard that cannot be read',
      unreadable,
      copy.scan.clipboardUnreadable,
    ],
    ['a pasted code that cannot be paid', async () => LNURL, refusal(LNURL)],
  ])(
    '%s is felt, said, and kept on the paste control',
    async (_, value, why) => {
      const error = jest.spyOn(haptics, 'error');
      const said = jest.spyOn(Announce, 'announce');
      const onDetected = jest.fn();
      const tree = await mount(scanner({ onDetected }));
      await pasting(value)(tree);
      expect(onDetected).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(said).toHaveBeenCalledWith(why);
      const [paste] = labelled(tree, copy.scan.paste);
      expect(paste.props.accessibilityValue).toEqual({ text: why });
      await act(async () => tree.unmount());
    },
  );

  test('Close hands the scan back', async () => {
    const onCancel = jest.fn();
    const tree = await mount(scanner({ onCancel }));
    await press(tree, copy.scan.close);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a screen reader lands on the scan as it opens', async () => {
    // The scanners mounted earlier in this file have called it already.
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    focus.mockClear();
    const tree = await mount(scanner());
    expect(focus).toHaveBeenCalledTimes(1);
    const [title] = labelled(tree, copy.scan.title);
    expect(focus.mock.calls[0][1]).toBe('focus');
    expect(title.props.accessibilityRole).toBe('header');
    await act(async () => tree.unmount());
  });

  test('the reticle says what to do, and nothing is drawn to say it', async () => {
    const tree = await mount(scanner());
    expect(visibleText(tree)).toEqual([]);
    const aim = reticle(tree)!;
    expect(aim.props.accessibilityRole).toBe('image');
    expect(aim.props.accessibilityHint).toBe(copy.scan.privacy);
    expect(labelled(tree, copy.scan.title)[0].props.accessibilityRole).toBe(
      'header',
    );
    expect(pressableLabels(tree)).toEqual(
      new Set([copy.scan.paste, copy.scan.close]),
    );
    await act(async () => tree.unmount());
  });
});

describe('the camera', () => {
  test('mounts only once the scanner is live, under a cover of the ground', async () => {
    const tree = await mount(scanner({ live: false }));
    expect(cameras(tree)).toHaveLength(0);
    expect(grounds(tree)).toHaveLength(0);
    expect(reticle(tree)).toBeDefined();
    await act(async () => tree.update(scanner({ live: true })));
    expect(cameras(tree)).toHaveLength(1);
    expect(grounds(tree)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('on Android it waits for permission, the reticle busy meanwhile', async () => {
    asking();
    const onAccess = jest.fn();
    const tree = await mount(scanner({ onAccess }));
    expect(cameras(tree)).toHaveLength(0);
    const aim = reticle(tree)!;
    expect(aim.props.accessibilityState).toEqual({ busy: true });
    expect(aim.props.accessibilityValue).toEqual({ text: copy.scan.starting });
    expect(onAccess).toHaveBeenLastCalledWith('checking');
    await act(async () => tree.unmount());
  });

  test('held, the reticle whispers what it asks, and that it is starting', async () => {
    const live = await mount(scanner());
    expect(whispers(live)).toEqual([{ label: copy.scan.aim, on: true }]);
    await act(async () => live.unmount());
    asking();
    const tree = await mount(scanner());
    expect(whispers(tree)).toEqual([
      { label: `${copy.scan.aim} ${copy.scan.starting}`, on: true },
    ]);
    await act(async () => tree.unmount());
  });

  test('on Android, once allowed, it starts', async () => {
    onAndroid(Promise.resolve(PermissionsAndroid.RESULTS.GRANTED));
    const onAccess = jest.fn();
    const tree = await mount(scanner({ onAccess }));
    expect(cameras(tree)).toHaveLength(1);
    expect(reticle(tree)!.props.accessibilityState).toEqual({ busy: false });
    expect(onAccess).toHaveBeenLastCalledWith('granted');
    await act(async () => tree.unmount());
  });

  test('switched off, it offers the paste and the device settings instead', async () => {
    denied();
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const onAccess = jest.fn();
    const tree = await mount(scanner({ onAccess }));
    expect(cameras(tree)).toHaveLength(0);
    expect(reticle(tree)).toBeUndefined();
    const [off] = labelled(tree, copy.scan.denied);
    expect(off.props.accessibilityHint).toBe(copy.scan.noCamera);
    expect(labelled(tree, copy.scan.camera)).toHaveLength(1);
    expect(pressableLabels(tree)).toEqual(
      new Set([copy.scan.paste, copy.scan.openSettings, copy.scan.close]),
    );
    expect(onAccess).toHaveBeenLastCalledWith('denied');
    await press(tree, copy.scan.openSettings);
    expect(settings).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('switched off, it is said, and its glyph whispers why', async () => {
    denied();
    const said = jest.spyOn(Announce, 'announce');
    const tree = await mount(scanner());
    expect(said).toHaveBeenCalledWith(copy.scan.denied);
    expect(tree.root.findByType(Whisper).props.label).toBe(copy.scan.denied);
    await act(async () => tree.unmount());
  });

  test('coming back with the camera switched on starts it', async () => {
    denied();
    const tree = await mount(scanner());
    expect(cameras(tree)).toHaveLength(0);
    await backWithCamera();
    expect(cameras(tree)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('an error from the camera turns it off', async () => {
    const tree = await mount(scanner());
    await act(async () => cameras(tree)[0].props.onError());
    expect(cameras(tree)).toHaveLength(0);
    expect(labelled(tree, copy.scan.denied)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('without the camera module there is the paste, and no cog', async () => {
    mockCamera = false;
    const onAccess = jest.fn();
    const tree = await mount(scanner({ onAccess }));
    const [missing] = labelled(tree, copy.scan.missing);
    expect(missing.props.accessibilityHint).toBe(copy.scan.missingHint);
    expect(pressableLabels(tree)).toEqual(
      new Set([copy.scan.paste, copy.scan.close]),
    );
    expect(onAccess).toHaveBeenLastCalledWith('missing');
    expect(tree.root.findByType(Whisper).props.label).toBe(copy.scan.missing);
    await act(async () => tree.unmount());
  });
});

describe('the overlay', () => {
  test('keeps the camera back until the disc has opened', async () => {
    mockHoldTimings = true;
    const tree = await mount(reveal());
    expect(tree.root.findByType(Scanner).props.live).toBe(false);
    expect(cameras(tree)).toHaveLength(0);
    expect(reticle(tree)).toBeDefined();
    await act(async () => mockHeld.splice(0).forEach(({ done }) => done(true)));
    expect(tree.root.findByType(Scanner).props.live).toBe(true);
    expect(cameras(tree)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('under Reduce Motion, keeps the camera back until the disc has faded in', async () => {
    reducedMotion();
    // The setting is read once and kept, so the overlay opens knowing it.
    await act(async () => (await mount(reveal())).unmount());
    mockHoldTimings = true;
    const tree = await mount(reveal());
    expect(tree.root.findByType(Scanner).props.live).toBe(false);
    expect(mockHeld.map(held => held.duration)).toEqual([durations.crossfade]);
    await act(async () => mockHeld.splice(0).forEach(({ done }) => done(true)));
    expect(tree.root.findByType(Scanner).props.live).toBe(true);
    expect(cameras(tree)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('draws its disc around the button, in the canvas', async () => {
    const tree = await mount(reveal({ origin: { x: 187, y: 520 } }));
    const [disc] = tree.root.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === 'scan-disc',
    );
    const expected = discFor({ x: 187, y: 520 }, 750, 1334);
    expect(StyleSheet.flatten(disc.props.style)).toMatchObject({
      left: 187 - expected.radius,
      top: 520 - expected.radius,
      width: 2 * expected.radius,
      borderRadius: expected.radius,
      overflow: 'hidden',
    });
    await act(async () => tree.unmount());
  });

  test('a code read through it reaches onDetected in the same call', async () => {
    const onDetected = jest.fn();
    const tree = await mount(reveal({ onDetected }));
    const [camera] = cameras(tree);
    act(() => {
      camera.props.onReadCode({ nativeEvent: { codeStringValue: PAYABLE } });
      expect(onDetected).toHaveBeenCalledWith(PAYABLE);
    });
    await act(async () => tree.unmount());
  });

  test('Close asks for it to close', async () => {
    const onCancel = jest.fn();
    const tree = await mount(reveal({ onCancel }));
    await press(tree, copy.scan.close);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a camera switched off leaves it partway open around the paste', async () => {
    denied();
    const tree = await mount(reveal());
    expect(cameras(tree)).toHaveLength(0);
    expect(labelled(tree, copy.scan.denied)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('a camera switched on from the settings waits for the disc to open the rest of the way', async () => {
    denied();
    const tree = await mount(reveal());
    const live = () => tree.root.findByType(Scanner).props.live;
    expect(live()).toBe(false);
    mockHoldTimings = true;
    await backWithCamera();
    expect(labelled(tree, copy.scan.denied)).toHaveLength(0);
    expect(live()).toBe(false);
    expect(cameras(tree)).toHaveLength(0);
    await act(async () => mockHeld.splice(0).forEach(({ done }) => done(true)));
    expect(live()).toBe(true);
    expect(cameras(tree)).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});
