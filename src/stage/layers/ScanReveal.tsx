import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryExitAnimationFunction,
  SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { ScanGround, Scanner, firstAccess } from '../../components/Scanner';
import type { CameraAccess } from '../../components/Scanner';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { STATUS_ROW } from '../layout';

type Point = { x: number; y: number };

/** The scan button's diameter on Home, which the disc grows out of. */
export const BUTTON = 76;
/** How far the disc opens when the camera cannot be used. */
export const PARTIAL = 0.6;
/**
 * About how long the pane spring takes to look open. The camera mounts then,
 * timed by a clock of its own: the spring only reports rest near 630ms.
 */
const REVEAL_MS = 380;
/**
 * Where Send's request well sits below the status row, which a code read
 * from home collapses into as Send opens around it.
 */
const WELL_DROP = 64;
/** How far into a collapse the disc starts to fade. */
const COLLAPSE_FADE_AT = 180;

const FADE = {
  duration: durations.crossfade,
  easing: curves.standard,
  reduceMotion: ReduceMotion.Never,
};

/**
 * The disc for an `origin` in a `width` by `height` layer: centred on the
 * origin, or the bottom centre without one, with a radius that reaches the
 * farthest corner, so at full size it covers everything. `from` is the scale
 * at which it is the scan button's size.
 */
export interface Disc {
  x: number;
  y: number;
  radius: number;
  from: number;
}

export function discFor(
  origin: Point | null,
  width: number,
  height: number,
): Disc {
  const x = origin?.x ?? width / 2;
  const y = origin?.y ?? height;
  const radius = Math.max(
    Math.hypot(x, y),
    Math.hypot(width - x, y),
    Math.hypot(x, height - y),
    Math.hypot(width - x, height - y),
  );
  return { x, y, radius, from: Math.min(1, BUTTON / (2 * radius)) };
}

/**
 * The transform that holds the disc's content still while the disc is at
 * `scale`. The content fills the layer, so it scales about the layer's centre,
 * and the disc about the origin: undoing one with the other takes the inverse
 * scale plus a shift of the difference between the two centres.
 */
export function counterScale(
  scale: number,
  disc: Disc,
  width: number,
  height: number,
) {
  'worklet';
  const inverse = 1 / scale;
  return {
    translateX: (inverse - 1) * (width / 2 - disc.x),
    translateY: (inverse - 1) * (height / 2 - disc.y),
    scale: inverse,
  };
}

/**
 * How far the disc opens: all the way onto the camera, or partway around the
 * glyph and the paste fallback when there is no camera to show.
 */
export function opening(access: CameraAccess): number {
  return access === 'denied' || access === 'missing' ? PARTIAL : 1;
}

/**
 * Where the disc collapses once a code is read (REDESIGN.md 7, T3): into
 * Send's request well. From inside Send that is where it grew from, the
 * well's own scan button; from home, the well of the Send it opens.
 */
export function landing(
  disc: Disc,
  target: 'home' | 'send',
  grewFromButton: boolean,
  width: number,
  top: number,
): Point {
  if (target === 'send' && grewFromButton) return { x: disc.x, y: disc.y };
  return { x: width / 2, y: top + STATUS_ROW + WELL_DROP };
}

/**
 * The disc leaving: it shrinks on the pane spring back into its button, or
 * with a code read into Send's well, and fades as it gets there. Under
 * Reduce Motion it only fades.
 */
export function collapse({
  scale,
  fade,
  caught,
  from,
  toWell,
  reduced,
}: {
  scale: Pick<SharedValue<number>, 'get'>;
  fade: Pick<SharedValue<number>, 'get'>;
  caught: Pick<SharedValue<number>, 'get'>;
  from: number;
  /** The shift from the origin to the well. */
  toWell: Point;
  reduced: boolean;
}): EntryExitAnimationFunction {
  return () => {
    'worklet';
    if (reduced) {
      return {
        initialValues: { opacity: fade.get() },
        animations: { opacity: withTiming(0, FADE) },
      };
    }
    const to = caught.get() === 1 ? toWell : { x: 0, y: 0 };
    return {
      initialValues: {
        opacity: fade.get(),
        transform: [
          { translateX: 0 },
          { translateY: 0 },
          { scale: scale.get() },
        ],
      },
      animations: {
        opacity: withDelay(
          COLLAPSE_FADE_AT,
          withTiming(0, { duration: durations.exit, easing: curves.exit }),
        ),
        transform: [
          { translateX: withSpring(to.x, springs.pane) },
          { translateY: withSpring(to.y, springs.pane) },
          { scale: withSpring(from, springs.pane) },
        ],
      },
    };
  };
}

/**
 * The scan overlay (REDESIGN.md 2.3, 5 and 7, T3): a disc that grows out of
 * the scan button at `origin`, in window coordinates, onto the scanner.
 * `target` is where a code goes: a new Send from home, or the Send already
 * open. `onDetected` gets the code in the same call the scanner reads it;
 * `onCancel` asks for the overlay to close, as Android's back does through
 * the stage.
 *
 * The disc is a circle as wide as twice the distance to the farthest corner,
 * clipping a ground that stays still while it scales from the button's size
 * to 1 on the pane spring. Under Reduce Motion it fades in at full size.
 *
 * Android's camera preview is a SurfaceView, which ignores clipping, alpha
 * and transforms, so the camera never rides the disc. It mounts full bleed,
 * beside the disc rather than in it, once the disc has opened, under a cover
 * of the same ground that fades away. Leaving, the disc and the corners
 * animate out, while the camera, which has no exit of its own, is removed at
 * once. iOS clips a camera fine, and takes the same path.
 */
export interface ScanRevealProps {
  origin: Point | null;
  target: 'home' | 'send';
  onDetected: (value: string) => void;
  onCancel: () => void;
}

export function ScanReveal({
  origin,
  target,
  onDetected,
  onCancel,
}: ScanRevealProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { reduced } = useMotionPrefs();
  // The canvas this covers runs edge to edge, and only a side cutout narrows
  // it. The window stands in until the first layout.
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const width = measured?.width ?? window.width - insets.left - insets.right;
  const height = measured?.height ?? window.height;
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setMeasured(last =>
      last && last.width === w && last.height === h
        ? last
        : { width: w, height: h },
    );
  }, []);
  // `origin` is in the window, and this layer starts after a side cutout.
  const disc = useMemo(
    () =>
      discFor(
        origin ? { x: origin.x - insets.left, y: origin.y } : null,
        width,
        height,
      ),
    [origin, insets.left, width, height],
  );

  const [access, setAccess] = useState<CameraAccess>(firstAccess);
  // The opening the disc last finished growing to. The camera waits for a
  // full one, including when it is switched on from the device settings
  // and the disc opens the rest of the way.
  const [opened, setOpened] = useState<number | null>(null);
  const open = opening(access);
  const scale = useSharedValue(reduced ? open : disc.from);
  const fade = useSharedValue(reduced ? 0 : 1);
  const clock = useSharedValue(0);
  const caught = useSharedValue(0);

  useEffect(() => {
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(setOpened, open);
    };
    if (reduced) {
      scale.set(open);
      fade.set(withTiming(1, FADE, done));
      return;
    }
    fade.set(1);
    scale.set(withSpring(open, springs.pane));
    clock.set(0);
    clock.set(
      withTiming(
        1,
        {
          duration: REVEAL_MS,
          easing: curves.linear,
          reduceMotion: ReduceMotion.Never,
        },
        done,
      ),
    );
  }, [open, reduced, scale, fade, clock]);

  // The disc's exit reads `caught` to tell a code read from a close.
  const detected = useCallback(
    (value: string) => {
      caught.set(1);
      onDetected(value);
    },
    [caught, onDetected],
  );

  const discStyle = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateX: 0 }, { translateY: 0 }, { scale: scale.get() }],
  }));
  const groundStyle = useAnimatedStyle(() => {
    const still = counterScale(
      Math.max(scale.get(), disc.from),
      disc,
      width,
      height,
    );
    return {
      transform: [
        { translateX: still.translateX },
        { translateY: still.translateY },
        { scale: still.scale },
      ],
    };
  }, [disc, width, height]);

  const exiting = useMemo(() => {
    const well = landing(disc, target, !!origin, width, insets.top);
    return collapse({
      scale,
      fade,
      caught,
      from: disc.from,
      toWell: { x: well.x - disc.x, y: well.y - disc.y },
      reduced,
    });
  }, [disc, target, origin, width, insets.top, scale, fade, caught, reduced]);

  return (
    <View style={styles.layer} onLayout={onLayout} accessibilityViewIsModal>
      <Reanimated.View
        testID="scan-disc"
        pointerEvents="none"
        exiting={exiting}
        style={[
          styles.disc,
          {
            left: disc.x - disc.radius,
            top: disc.y - disc.radius,
            width: disc.radius * 2,
            height: disc.radius * 2,
            borderRadius: disc.radius,
          },
          discStyle,
        ]}
      >
        <Reanimated.View
          style={[
            styles.ground,
            {
              left: disc.radius - disc.x,
              top: disc.radius - disc.y,
              width,
              height,
            },
            groundStyle,
          ]}
        >
          <ScanGround width={width} height={height} />
        </Reanimated.View>
      </Reanimated.View>
      <View style={styles.layer} pointerEvents="box-none">
        <Scanner
          live={opened === 1}
          onDetected={detected}
          onCancel={onCancel}
          onAccess={setAccess}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: StyleSheet.absoluteFill,
  disc: { position: 'absolute', overflow: 'hidden' },
  ground: { position: 'absolute' },
});
