import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Reanimated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryExitAnimationFunction,
  SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { parsePayment } from '@beignet/wallet-core';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import type { GlyphName } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { riseIn, sceneOut } from '../motion/presets';
import { curves, durations, overlap, shake, springs } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { normalizePaymentLink } from '../services/links';
import { HIT_SLOP, space } from '../theme';

/**
 * Point the camera at a payment request (REDESIGN.md 5, Scan reveal).
 *
 * Nothing here is written on screen. Four corners mark where to aim: dashed
 * and turning while the camera is being asked for, breathing while it reads,
 * snapping in and turning sage on a code that can be paid, and flashing
 * radish with a shake on one that cannot, which leaves the camera reading.
 * A camera that is off or missing shows `cameraOff`, with the paste fallback
 * and, when it is only switched off, a cog for the device settings. The words
 * each state used to print are its accessibility strings.
 *
 * The camera module is resolved optionally, so the JavaScript still runs in
 * Jest and in any build whose native side has not been rebuilt since the
 * module was added; without it this degrades to the paste path rather than a
 * blank or broken screen.
 *
 * A scanned code is handed to Send exactly as a pasted one is, and only once
 * the payment parser can read it as something to pay. Nothing is paid from
 * here, and no frame or image leaves the device.
 */
type CameraModule = {
  Camera?: React.ComponentType<Record<string, unknown>>;
  CameraType?: { Back?: unknown };
};

let cameraKit: CameraModule | null = undefined as never;
function loadCamera(): CameraModule | null {
  if (cameraKit !== undefined) return cameraKit;
  try {
    cameraKit = require('react-native-camera-kit');
  } catch {
    cameraKit = null;
  }
  return cameraKit;
}

/**
 * What the camera can do: being asked for, reading, switched off by the
 * user, or absent from this build.
 */
export type CameraAccess = 'checking' | 'granted' | 'denied' | 'missing';

/**
 * The access a scanner starts with. Android asks at runtime, so it starts
 * out asking; iOS asks when the camera mounts, and reports a refusal as an
 * error from it.
 */
export function firstAccess(): CameraAccess {
  if (!loadCamera()?.Camera) return 'missing';
  return Platform.OS === 'android' ? 'checking' : 'granted';
}

/** The corners' arm length, stroke and bend (REDESIGN.md 5, Scan reveal). */
const ARM = 28;
const STROKE = 3;
const BEND = 8;
/** The corners' dashes while the camera is being asked for. */
const DASH = [3, 6];
/** The corners set off this long after the scanner mounts, 40ms apart. */
const FLY_DELAY = 200;
const FLY_STAGGER = 40;
/** One breath while reading, in to .97 and out again. */
const BREATH_MS = 2400;
const BREATH_SCALE = 0.97;
/** A code that can be paid pulls the corners in to this. */
export const CAUGHT_SCALE = 0.85;
/** How long the caught corners hold before they go with the disc. */
const CAUGHT_HOLD = 160;
/** How long the cover over a camera just mounted takes to fade away. */
const COVER_MS = 300;
/**
 * The same unpayable code buzzes, shakes and is said at most once in this
 * long; each read of it still flashes.
 */
export const REFUSAL_QUIET_MS = 1500;
/** Reduce Motion's stand-in for a shake: a radish tint held this long. */
const TINT_MS = 400;
/** The round controls, at the minimum comfortable size and then some. */
const CONTROL = 56;

/** Fades that still run under Reduce Motion, since they move nothing. */
const FADE = {
  duration: durations.crossfade,
  easing: curves.standard,
  reduceMotion: ReduceMotion.Never,
};
const EXIT = { duration: durations.exit, easing: curves.exit };

/**
 * Why `value` cannot be paid, as a screen reader hears it, or null when it
 * can. A code the parser reads but refuses, such as an LNURL, is refused here
 * too, with the parser's own reason after ours.
 */
export function refusal(value: string): string | null {
  const parsed = parsePayment(value);
  if (parsed.kind === 'empty') return copy.scan.invalid;
  if (parsed.kind === 'invalid') {
    return [copy.scan.invalid, parsed.message].filter(Boolean).join(' ');
  }
  return null;
}

/** The last unpayable code the camera read, and when it last buzzed. */
export interface Refused {
  value: string;
  at: number;
}

/**
 * Whether an unpayable read buzzes, shakes and is said. A code held in view
 * is read again every 600ms, so the same one only complains again after
 * REFUSAL_QUIET_MS; a different one complains at once.
 */
export function shouldRefuse(
  last: Refused | null,
  value: string,
  now: number,
): boolean {
  return !last || last.value !== value || now - last.at >= REFUSAL_QUIET_MS;
}

/** The reticle's side for a surface `width` by `height` points. */
export function reticleSide(width: number, height: number): number {
  return Math.round(
    Math.min(280, Math.max(200, 0.68 * Math.min(width, height))),
  );
}

/**
 * How far along its own diagonal each corner flies in from, per axis, for a
 * reticle `side` points wide centred in the surface: from where the diagonal
 * meets the nearest edge, which is where the growing disc's rim is by the
 * time the corners set off.
 */
export function flight(width: number, height: number, side: number): number {
  return Math.max(0, Math.min(width - side, height - side) / 2);
}

/**
 * The next quarter turn at or past `degrees`. The reticle looks the same at
 * every one, so a spin stops there without a jump.
 */
export function settleTurn(degrees: number): number {
  'worklet';
  return Math.ceil(degrees / 90) * 90;
}

export type ReticleMode = 'checking' | 'waiting' | 'scanning';

/**
 * Which loops the reticle runs (REDESIGN.md 5 and 8): it turns while the
 * camera is asked for and breathes while it reads, never while the app is in
 * the background, and under Reduce Motion it holds still.
 */
export function reticleLoops(
  mode: ReticleMode,
  reduced: boolean,
  running: boolean,
): { spin: boolean; breathe: boolean } {
  const moving = running && !reduced;
  return {
    spin: moving && mode === 'checking',
    breathe: moving && mode === 'scanning',
  };
}

/**
 * One corner, bending at (x, y), its arms running ARM points along `dx` and
 * `dy`. Inset by half the stroke, so a corner drawn in an ARM box fits it.
 */
export function cornerPath(
  x: number,
  y: number,
  dx: 1 | -1,
  dy: 1 | -1,
): string {
  const inset = STROKE / 2;
  const ax = x + dx * inset;
  const ay = y + dy * inset;
  const reach = ARM - STROKE;
  const sweep = dx * dy > 0 ? 1 : 0;
  return (
    `M${ax} ${ay + dy * reach}V${ay + dy * BEND}` +
    `A${BEND} ${BEND} 0 0 ${sweep} ${ax + dx * BEND} ${ay}H${ax + dx * reach}`
  );
}

/**
 * The corners in the order they fly in, top left then clockwise, each with
 * the way its arms run and where it sits in the reticle.
 */
const CORNERS = [
  { dx: 1, dy: 1, at: { left: 0, top: 0 } },
  { dx: -1, dy: 1, at: { right: 0, top: 0 } },
  { dx: -1, dy: -1, at: { right: 0, bottom: 0 } },
  { dx: 1, dy: -1, at: { left: 0, bottom: 0 } },
] as const;

/** All four corners of a reticle `side` points wide, as one path. */
function reticlePath(side: number): string {
  return CORNERS.map(({ dx, dy }) =>
    cornerPath(dx > 0 ? 0 : side, dy > 0 ? 0 : side, dx, dy),
  ).join('');
}

/**
 * Whether the app is in front. Loops stop in the background, and a camera
 * the user switched on in the device settings is found on the way back.
 */
function useForeground(): boolean {
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background',
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setForeground(state !== 'background'),
    );
    return () => subscription.remove();
  }, []);
  return foreground;
}

/**
 * The ground the scan opens onto: roast at the centre, deepening to the
 * bloom's night at the corners. The overlay's disc reveals it, and the same
 * ground covers a camera just mounted and fades off it, so the handover from
 * disc to camera shows no seam.
 */
export const ScanGround = memo(function ScanGroundSvg({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <Svg
      width={width}
      height={height}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient
          id="scan-ground"
          cx={width / 2}
          cy={height / 2}
          r={Math.hypot(width, height) / 2}
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={palette.roast} />
          <Stop offset="0.45" stopColor={palette.roast} />
          <Stop offset="1" stopColor={palette.bloomNight} />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#scan-ground)" />
    </Svg>
  );
});
ScanGround.displayName = 'ScanGround';

/**
 * What the reticle is told when a code is read, as shared values, so a code
 * caught in the same tick as the overlay closes still shows on the way out.
 * `caught` is 1 once a payable code is read; the exits read it.
 */
interface Cues {
  caught: SharedValue<number>;
  sage: SharedValue<number>;
  radish: SharedValue<number>;
  nudge: SharedValue<number>;
  pinch: SharedValue<number>;
}

/** A shared value as an exit reads it, once, as the exit starts. */
type Reading = Pick<SharedValue<number>, 'get'>;

/**
 * The reticle leaving. A caught code holds the corners pulled in for a beat,
 * sage, before they fade; anything else fades them at once.
 */
export function reticleOut(
  cues: { caught: Reading; pinch: Reading },
  breath: Reading,
  reduced: boolean,
): EntryExitAnimationFunction {
  return () => {
    'worklet';
    if (reduced) {
      return {
        initialValues: { opacity: 1 },
        animations: { opacity: withTiming(0, FADE) },
      };
    }
    const scale = breath.get() * cues.pinch.get();
    if (cues.caught.get() === 1) {
      return {
        initialValues: { opacity: 1, transform: [{ scale }] },
        animations: {
          transform: [{ scale: withSpring(CAUGHT_SCALE, springs.snap) }],
          opacity: withDelay(CAUGHT_HOLD, withTiming(0, EXIT)),
        },
      };
    }
    return {
      initialValues: { opacity: 1, transform: [{ scale }] },
      animations: {
        transform: [{ scale: withTiming(scale * 0.98, EXIT) }],
        opacity: withTiming(0, EXIT),
      },
    };
  };
}

/** The sage corners, which a caught code turns on as the scan closes. */
function sageOut(cues: {
  caught: Reading;
  sage: Reading;
}): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: cues.sage.get() },
      animations: {
        opacity: withTiming(cues.caught.get() === 1 ? 1 : 0, {
          duration: durations.tick,
          easing: curves.standard,
          reduceMotion: ReduceMotion.Never,
        }),
      },
    };
  };
}

const svgHidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * One corner, flying in along its own diagonal from `from` points out, the
 * `index`th of four. Under Reduce Motion it fades in where it belongs.
 */
const Corner = memo(function CornerMark({
  index,
  dx,
  dy,
  at,
  from,
  mode,
  reduced,
}: {
  index: number;
  dx: 1 | -1;
  dy: 1 | -1;
  at: (typeof CORNERS)[number]['at'];
  from: number;
  mode: ReticleMode;
  reduced: boolean;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      reduced
        ? withTiming(1, FADE)
        : withDelay(
            FLY_DELAY + index * FLY_STAGGER,
            withTiming(1, { duration: durations.move, easing: curves.enter }),
          ),
    );
  }, [progress, reduced, index]);
  const style = useAnimatedStyle(() => {
    const shown = progress.get();
    const away = reduced ? 0 : (1 - shown) * from;
    return {
      opacity: shown,
      transform: [{ translateX: -dx * away }, { translateY: -dy * away }],
    };
  }, [reduced, from, dx, dy]);
  const checking = mode === 'checking';
  return (
    <Reanimated.View style={[styles.corner, at, style]}>
      <Svg width={ARM} height={ARM} {...svgHidden}>
        <Path
          d={cornerPath(dx > 0 ? 0 : ARM, dy > 0 ? 0 : ARM, dx, dy)}
          fill="none"
          stroke={checking ? palette.steam : palette.cream}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={checking ? DASH : undefined}
        />
      </Svg>
    </Reanimated.View>
  );
});
Corner.displayName = 'Corner';

/**
 * The four corners that mark where to aim, and the whole of what the scanner
 * says while it reads: its label is the instruction the screen used to print.
 */
const Reticle = memo(function ReticleMarks({
  mode,
  side,
  from,
  reduced,
  running,
  cues,
}: {
  mode: ReticleMode;
  side: number;
  from: number;
  reduced: boolean;
  running: boolean;
  cues: Cues;
}) {
  const turn = useSharedValue(0);
  const breath = useSharedValue(1);
  const { spin, breathe } = reticleLoops(mode, reduced, running);

  useEffect(() => {
    if (!spin) {
      turn.set(withSpring(settleTurn(turn.get()), springs.snap));
      return;
    }
    const start = turn.get();
    turn.set(
      withRepeat(
        withTiming(start + 360, {
          duration: durations.dashRotate,
          easing: curves.linear,
        }),
        -1,
      ),
    );
    return () => cancelAnimation(turn);
  }, [spin, turn]);

  useEffect(() => {
    if (!breathe) {
      breath.set(withTiming(1, { duration: durations.exit }));
      return;
    }
    breath.set(
      withRepeat(
        withTiming(BREATH_SCALE, {
          duration: BREATH_MS / 2,
          easing: curves.sine,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(breath);
  }, [breathe, breath]);

  const group = useAnimatedStyle(() => ({
    transform: [
      { translateX: cues.nudge.get() },
      { rotate: `${turn.get()}deg` },
      { scale: breath.get() * cues.pinch.get() },
    ],
  }));
  const sage = useAnimatedStyle(() => ({ opacity: cues.sage.get() }));
  const radish = useAnimatedStyle(() => ({ opacity: cues.radish.get() }));
  const exiting = useMemo(
    () => reticleOut(cues, breath, reduced),
    [cues, breath, reduced],
  );
  const sageExit = useMemo(() => sageOut(cues), [cues]);
  const path = useMemo(() => reticlePath(side), [side]);
  const tint = (color: string) => (
    <Svg width={side} height={side} {...svgHidden}>
      <Path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );

  return (
    <Reanimated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={copy.scan.aim}
      accessibilityHint={copy.scan.privacy}
      accessibilityValue={
        mode === 'checking' ? { text: copy.scan.starting } : undefined
      }
      accessibilityState={{ busy: mode === 'checking' }}
      exiting={exiting}
      style={[{ width: side, height: side }, group]}
    >
      {CORNERS.map(({ dx, dy, at }, index) => (
        <Corner
          key={index}
          index={index}
          dx={dx}
          dy={dy}
          at={at}
          from={from}
          mode={mode}
          reduced={reduced}
        />
      ))}
      <Reanimated.View pointerEvents="none" style={[styles.fill, radish]}>
        {tint(palette.radish)}
      </Reanimated.View>
      <Reanimated.View
        pointerEvents="none"
        exiting={sageExit}
        style={[styles.fill, sage]}
      >
        {tint(palette.sage)}
      </Reanimated.View>
    </Reanimated.View>
  );
});
Reticle.displayName = 'Reticle';

/**
 * A round glyph control. `refused` counts the times its action was turned
 * down, each one a radish ring and a shake (a held tint under Reduce Motion),
 * and says why in its value.
 */
function GlyphButton({
  glyph,
  label,
  onPress,
  reduced,
  refused,
}: {
  glyph: GlyphName;
  label: string;
  onPress: () => void | Promise<void>;
  reduced: boolean;
  refused?: { count: number; reason: string };
}) {
  const press = useSharedValue(1);
  const nudge = useSharedValue(0);
  const ring = useSharedValue(0);
  const count = refused?.count ?? 0;
  useEffect(() => {
    if (!count) return;
    if (reduced) {
      ring.set(
        withSequence(
          withTiming(1, { ...FADE, duration: durations.tick }),
          withDelay(TINT_MS, withTiming(0, FADE)),
        ),
      );
      return;
    }
    ring.set(
      withSequence(
        withTiming(1, { duration: durations.tick }),
        withTiming(0, { duration: durations.draw }),
      ),
    );
    nudge.set(shake());
  }, [count, reduced, ring, nudge]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.get() }, { scale: press.get() }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));
  const to = (value: number) =>
    press.set(reduced ? 1 : withSpring(value, springs.snap));
  return (
    <Reanimated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={
          refused?.reason ? { text: refused.reason } : undefined
        }
        hitSlop={HIT_SLOP}
        onPressIn={() => to(0.94)}
        onPressOut={() => to(1)}
        onPress={() => {
          haptics.tick();
          return onPress();
        }}
        style={styles.control}
      >
        <Glyph name={glyph} size={24} color={palette.cream} />
        <Reanimated.View
          pointerEvents="none"
          style={[styles.ring, ringStyle]}
        />
      </Pressable>
    </Reanimated.View>
  );
}

/**
 * The camera cannot be used: `cameraOff`, steam when the user switched it
 * off and dust when this build has no camera at all.
 */
function CameraOff({ access }: { access: 'denied' | 'missing' }) {
  const denied = access === 'denied';
  return (
    <Reanimated.View
      entering={riseIn(overlap.rise, overlap.enterDelay)}
      exiting={sceneOut()}
      accessible
      accessibilityRole="image"
      accessibilityLabel={denied ? copy.scan.denied : copy.scan.missing}
      accessibilityHint={denied ? copy.scan.noCamera : copy.scan.missingHint}
      style={styles.status}
    >
      <Glyph
        name="cameraOff"
        size={40}
        color={denied ? palette.steam : palette.dust}
      />
    </Reanimated.View>
  );
}

export function Scanner({
  onDetected,
  onCancel,
  live = true,
  onAccess,
}: {
  onDetected: (value: string) => void;
  onCancel: () => void;
  /**
   * Whether the camera may mount. The scan overlay holds it back until its
   * disc has opened, because Android's camera preview ignores the disc's
   * clip, alpha and scale. Drawn on its own, the scanner starts at once.
   */
  live?: boolean;
  /** Told what the camera can do, so the overlay can open only partway. */
  onAccess?: (access: CameraAccess) => void;
}) {
  const lib = loadCamera();
  const Camera = lib?.Camera;
  const [access, setAccess] = useState<CameraAccess>(firstAccess);
  const { reduced } = useMotionPrefs();
  const foreground = useForeground();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const { width, height } = measured ?? window;
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setMeasured(last =>
      last && last.width === w && last.height === h
        ? last
        : { width: w, height: h },
    );
  }, []);

  // One code, once. A second frame carrying the same request must not stack
  // another Send on top of the one already opening.
  const claimed = useRef(false);
  const refused = useRef<Refused | null>(null);
  const [pasteRefused, setPasteRefused] = useState({ count: 0, reason: '' });

  const caught = useSharedValue(0);
  const sage = useSharedValue(0);
  const radish = useSharedValue(0);
  const nudge = useSharedValue(0);
  const pinch = useSharedValue(1);
  const cues = useMemo<Cues>(
    () => ({ caught, sage, radish, nudge, pinch }),
    [caught, sage, radish, nudge, pinch],
  );

  useEffect(() => {
    if (Platform.OS !== 'android' || !Camera) return;
    let active = true;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
      .then(result => {
        if (!active) return;
        setAccess(
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied',
        );
      })
      .catch(() => active && setAccess('denied'));
    return () => {
      active = false;
    };
  }, [Camera]);

  // The cog sends the user to the device settings. Coming back with the
  // camera switched on starts it, without closing the scan first.
  useEffect(() => {
    if (Platform.OS !== 'android' || !Camera) return;
    if (access !== 'denied' || !foreground) return;
    let active = true;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)
      .then(granted => active && granted && setAccess('granted'))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [Camera, access, foreground]);

  useEffect(() => {
    onAccess?.(access);
  }, [access, onAccess]);

  // A screen reader lands on the scan as it opens (REDESIGN.md 9), where its
  // name is, rather than staying on the button that opened it.
  const title = useRef<React.ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (title.current) {
      AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
    }
  }, []);

  const cameraOn = live && access === 'granted' && !!Camera;
  const cover = useSharedValue(1);
  useEffect(() => {
    if (!cameraOn) {
      cover.set(1);
      return;
    }
    cover.set(withTiming(0, reduced ? FADE : { ...FADE, duration: COVER_MS }));
  }, [cameraOn, reduced, cover]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.get() }));

  function take(value: string) {
    claimed.current = true;
    caught.set(1);
    sage.set(withTiming(1, { ...FADE, duration: durations.tick }));
    if (!reduced) pinch.set(withSpring(CAUGHT_SCALE, springs.snap));
    haptics.thud();
    announce(copy.scan.detected);
    onDetected(normalizePaymentLink(value) || value);
  }

  // Every refused read flashes the corners radish. Only a loud one shakes
  // them too, and Reduce Motion holds the tint a while instead of shaking.
  function flash(loud: boolean) {
    if (reduced) {
      radish.set(
        withSequence(
          withTiming(1, { ...FADE, duration: durations.tick }),
          withDelay(TINT_MS, withTiming(0, FADE)),
        ),
      );
      return;
    }
    radish.set(
      withSequence(
        withTiming(1, { duration: durations.tick }),
        withTiming(0, { duration: durations.draw }),
      ),
    );
    if (loud) nudge.set(shake());
  }

  function read(raw: string | undefined) {
    const value = raw?.trim();
    if (claimed.current || !value) return;
    const reason = refusal(value);
    if (!reason) {
      take(value);
      return;
    }
    const now = Date.now();
    const loud = shouldRefuse(refused.current, value, now);
    if (loud) {
      refused.current = { value, at: now };
      haptics.error();
      announce(reason);
    }
    flash(loud);
  }

  // A paste is asked for, so every refusal is felt and said, however often.
  function refusePaste(reason: string) {
    haptics.error();
    announce(reason);
    setPasteRefused(last => ({ count: last.count + 1, reason }));
  }

  async function paste() {
    if (claimed.current) return;
    let value = '';
    try {
      value = (await Clipboard.getString())?.trim() ?? '';
    } catch {
      refusePaste(copy.scan.clipboardUnreadable);
      return;
    }
    if (!value) {
      refusePaste(copy.scan.clipboardEmpty);
      return;
    }
    const reason = refusal(value);
    if (reason) refusePaste(reason);
    else take(value);
  }

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  const side = reticleSide(width, height);
  const fallback = access === 'denied' || access === 'missing';
  const mode: ReticleMode =
    access === 'checking' ? 'checking' : cameraOn ? 'scanning' : 'waiting';

  const controls = (
    <Reanimated.View
      entering={riseIn(overlap.rise, FLY_DELAY)}
      exiting={sceneOut()}
      style={styles.controls}
    >
      <GlyphButton
        glyph="clipboard"
        label={copy.scan.paste}
        onPress={paste}
        reduced={reduced}
        refused={pasteRefused}
      />
      {access === 'denied' ? (
        <GlyphButton
          glyph="cog"
          label={copy.scan.openSettings}
          onPress={openSettings}
          reduced={reduced}
        />
      ) : null}
      <GlyphButton
        glyph="close"
        label={copy.scan.close}
        onPress={onCancel}
        reduced={reduced}
      />
    </Reanimated.View>
  );

  return (
    <View style={styles.surface} onLayout={onLayout}>
      {cameraOn && Camera ? (
        <View style={styles.fill}>
          <Camera
            scanBarcode
            allowedBarcodeTypes={['qr']}
            scanThrottleDelay={600}
            cameraType={lib?.CameraType?.Back}
            style={styles.fill}
            onReadCode={(event: {
              nativeEvent?: { codeStringValue?: string };
            }) => read(event?.nativeEvent?.codeStringValue)}
            onError={() => setAccess('denied')}
          />
          <Reanimated.View
            pointerEvents="none"
            style={[styles.fill, coverStyle]}
          >
            <ScanGround width={width} height={height} />
          </Reanimated.View>
        </View>
      ) : null}
      <View
        pointerEvents="box-none"
        style={[
          styles.body,
          {
            paddingTop: insets.top + space.xl,
            paddingBottom: insets.bottom + space.xl,
          },
        ]}
      >
        <View
          ref={title}
          accessible
          accessibilityRole="header"
          accessibilityLabel={
            access === 'denied' ? copy.scan.camera : copy.scan.title
          }
          style={styles.title}
        />
        <View pointerEvents="box-none" style={styles.stage}>
          {fallback ? (
            <>
              <CameraOff access={access} />
              {controls}
            </>
          ) : (
            <Reticle
              mode={mode}
              side={side}
              from={flight(width, height, side)}
              reduced={reduced}
              running={foreground}
              cues={cues}
            />
          )}
        </View>
        {fallback ? null : controls}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
  fill: StyleSheet.absoluteFill,
  body: { flex: 1, paddingHorizontal: space.xl },
  // A point rather than nothing: a screen reader passes over an element with
  // no size at all.
  title: { position: 'absolute', top: 0, left: 0, width: 1, height: 1 },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxl,
  },
  corner: { position: 'absolute', width: ARM, height: ARM },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xl,
  },
  control: {
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cocoa,
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: CONTROL / 2,
    borderWidth: 2,
    borderColor: palette.radish,
  },
  status: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.mocha,
  },
});
