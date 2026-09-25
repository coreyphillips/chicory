import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import { riseIn } from '../motion/presets';
import { curves, springs } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { usePaneActive } from '../stage/panes/Pane';
import { radius } from '../theme';

/**
 * A payment request's QR, always ink on cream (REDESIGN.md 5, QrBloom).
 *
 * The modules are split into five bands by their distance from the centre,
 * plus the three finder squares, and each is a static drawing on a layer of
 * its own, so only transforms and opacity ever move. A code blooms in: the
 * card settles from .92, the bands arrive from the centre outward 40ms apart
 * and the finders pop last. It leaves the way its state says: an expired
 * request dissolves from the outside in, a paid one implodes from the inside
 * out, and one whose address was reused scatters and leaves a honey twin.
 *
 * Only a request that can still be paid is drawn as a code, named for a
 * screen reader and pressable. Anything else is decoration for its caller to
 * put words to, so nothing on screen can be scanned into a payment that would
 * go wrong. `onPress` enlarges it and `onLongPress` copies it.
 */
export type QrState = 'shown' | 'expired' | 'paid' | 'scattered';

export interface QrBloomProps {
  value: string;
  size: number;
  state: QrState;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}

/** The quiet zone around the modules, which scanners need to find the code. */
export const QR_QUIET = 12;

/** How wide a code `size` across is drawn, its quiet zone included. */
export const qrSide = (size: number) => size + QR_QUIET * 2;

/** Bands of modules, from the centre out. */
export const BANDS = 5;

/** The layer the finder squares move on, after every band. */
export const FINDERS = BANDS;

/** A finder square is 7 modules across. */
const FINDER = 7;

/** The honey twin's stroke, in grid units, where it fills a whole frame. */
const TWIN_STROKE = 0.9;

/** The module grid: `size` modules a side, `data` 1 where a module is dark. */
export interface QrModules {
  size: number;
  data: ArrayLike<number>;
}

/** The modules for `value`, at the error correction the old code used. */
export function qrModules(value: string): QrModules {
  const { modules } = require('qrcode').create(value, {
    errorCorrectionLevel: 'M',
  }) as { modules: QrModules };
  return modules;
}

/** Where a finder square sits, in modules, and its modules as a path. */
export interface Finder {
  x: number;
  y: number;
  d: string;
}

/** Modules on a row drawn as runs, so a path holds a run as one rectangle. */
function runs(
  size: number,
  dark: (row: number, column: number) => boolean,
): string {
  let d = '';
  for (let row = 0; row < size; row++) {
    let start = -1;
    for (let column = 0; column <= size; column++) {
      const on = column < size && dark(row, column);
      if (on && start < 0) start = column;
      if (!on && start >= 0) {
        const length = column - start;
        d += `M${start} ${row}h${length}v1h-${length}z`;
        start = -1;
      }
    }
  }
  return d;
}

/**
 * The code split for its bloom: `bands` holds a path per band, centre
 * first, in module units, and `finders` the three finder squares, each in
 * units of its own 7 by 7 box.
 */
export function qrLayers({ size, data }: QrModules): {
  bands: string[];
  finders: Finder[];
} {
  const dark = (row: number, column: number) => data[row * size + column] === 1;
  const corners = [
    { x: 0, y: 0 },
    { x: size - FINDER, y: 0 },
    { x: 0, y: size - FINDER },
  ];
  const inFinder = (row: number, column: number) =>
    corners.some(
      ({ x, y }) =>
        column >= x && column < x + FINDER && row >= y && row < y + FINDER,
    );
  const middle = (size - 1) / 2;
  const farthest = Math.SQRT2 * middle || 1;
  const band = (row: number, column: number) =>
    Math.min(
      BANDS - 1,
      Math.floor(
        (BANDS * Math.hypot(row - middle, column - middle)) / farthest,
      ),
    );
  const bands = Array.from({ length: BANDS }, (_, k) =>
    runs(
      size,
      (row, column) =>
        dark(row, column) && !inFinder(row, column) && band(row, column) === k,
    ),
  );
  const finders = corners.map(({ x, y }) => ({
    x,
    y,
    d: runs(FINDER, (row, column) => dark(y + row, x + column)),
  }));
  return { bands, finders };
}

/** The bloom's clock, in ms. */
export const QR_TIMING = {
  start: 80,
  step: 40,
  enter: 220,
  dissolve: 220,
  implode: 420,
  scatter: 320,
};

/**
 * How layer `layer` (a band from the centre out, or FINDERS) moves into
 * `state`: when it starts, how long it takes, and where it ends.
 */
export interface LayerMotion {
  delay: number;
  duration: number;
  opacity: number;
  scale: number;
  /** How far it flies off along its own heading, 0 to 1. */
  spread: number;
}

export function layerMotion(layer: number, state: QrState): LayerMotion {
  const { start, step } = QR_TIMING;
  switch (state) {
    case 'shown':
      return {
        delay: start + step * layer,
        duration: QR_TIMING.enter,
        opacity: 1,
        scale: 1,
        spread: 0,
      };
    case 'expired':
      // The outside goes first, and the finders last of all.
      return {
        delay: step * (layer === FINDERS ? BANDS : BANDS - 1 - layer),
        duration: QR_TIMING.dissolve,
        opacity: 0,
        scale: 1.06,
        spread: 0,
      };
    case 'paid':
      return {
        delay: step * layer,
        duration: QR_TIMING.implode,
        opacity: 0,
        scale: 0.2,
        spread: 0,
      };
    case 'scattered':
      return {
        delay: (step / 2) * layer,
        duration: QR_TIMING.scatter,
        opacity: 0,
        scale: 1,
        spread: 1,
      };
  }
}

/** How long every layer takes to leave `state`'s way, all told. */
export function leaveMs(state: Exclude<QrState, 'shown'>): number {
  return Math.max(
    ...Array.from({ length: FINDERS + 1 }, (_, layer) => {
      const motion = layerMotion(layer, state);
      return motion.delay + motion.duration;
    }),
  );
}

/** How far a scattered layer flies, and which way: each its own heading. */
const SCATTER = 28;
export function scatterOffset(layer: number): { x: number; y: number } {
  // The golden angle, so no two layers leave the same way.
  const heading = (layer * 137.5 * Math.PI) / 180;
  return { x: Math.cos(heading) * SCATTER, y: Math.sin(heading) * SCATTER };
}

/** One layer of modules, which moves as its state says and nothing else. */
const Layer = memo(function QrLayer({
  layer,
  state,
  reduced,
  frame,
  viewBox,
  d,
}: {
  layer: number;
  state: QrState;
  reduced: boolean;
  frame: { left: number; top: number; width: number; height: number };
  viewBox: string;
  d: string;
}) {
  const opacity = useSharedValue(reduced ? 1 : 0);
  const scale = useSharedValue(reduced ? 1 : layer === FINDERS ? 0.6 : 0.9);
  const spread = useSharedValue(0);
  useEffect(() => {
    const motion = layerMotion(layer, state);
    if (reduced) {
      opacity.set(motion.opacity);
      scale.set(1);
      spread.set(0);
      return;
    }
    const timing = {
      duration: motion.duration,
      easing: state === 'shown' ? curves.enter : curves.exit,
    };
    opacity.set(withDelay(motion.delay, withTiming(motion.opacity, timing)));
    spread.set(withDelay(motion.delay, withTiming(motion.spread, timing)));
    // The finders pop in with a little overshoot, as the bloom's centre does.
    scale.set(
      withDelay(
        motion.delay,
        state === 'shown'
          ? withSpring(motion.scale, springs.reveal)
          : withTiming(motion.scale, timing),
      ),
    );
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
      cancelAnimation(spread);
    };
  }, [layer, state, reduced, opacity, scale, spread]);
  const away = scatterOffset(layer);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [
      { translateX: away.x * spread.get() },
      { translateY: away.y * spread.get() },
      { rotate: `${(layer % 2 ? 8 : -8) * spread.get()}deg` },
      { scale: scale.get() },
    ],
  }));
  return (
    <Reanimated.View style={[styles.layer, frame, style]}>
      <Svg width={frame.width} height={frame.height} viewBox={viewBox}>
        <Path d={d} fill={palette.ink} />
      </Svg>
    </Reanimated.View>
  );
});

export const QrBloom = memo(function QrCode({
  value,
  size,
  state,
  onPress,
  onLongPress,
  accessibilityLabel,
}: QrBloomProps) {
  const live = usePaneActive();
  const { reduced } = useMotionPrefs();
  const shown = state === 'shown';
  const pressable = shown && (!!onPress || !!onLongPress);
  const layers = useMemo(() => {
    const modules = qrModules(value);
    return { size: modules.size, ...qrLayers(modules) };
  }, [value]);

  // A module is a whole number of points wherever the code fits one, so no
  // seam shows where one band's modules meet the next band's.
  const unit = Math.floor(size / layers.size) || size / layers.size;
  const drawn = unit * layers.size;
  const origin = QR_QUIET + (size - drawn) / 2;

  // The layers stay drawn while they leave, then go, so a code that can no
  // longer be paid is not left on screen at any opacity.
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    setLeaving(!shown && !reduced);
  }
  useEffect(() => {
    if (!leaving || state === 'shown') return;
    const timer = setTimeout(() => setLeaving(false), leaveMs(state));
    return () => clearTimeout(timer);
  }, [leaving, state]);

  const card = useSharedValue(reduced ? 1 : 0.92);
  const cream = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    card.set(reduced ? 1 : withSpring(1, springs.pane));
  }, [card, reduced]);
  useEffect(() => {
    const target = shown ? 1 : 0;
    cream.set(
      reduced || shown
        ? target
        : withDelay(
            QR_TIMING.step * BANDS,
            withTiming(target, {
              duration: QR_TIMING.dissolve,
              easing: curves.exit,
            }),
          ),
    );
    return () => cancelAnimation(cream);
  }, [cream, shown, reduced]);
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: card.get() }],
  }));
  const creamStyle = useAnimatedStyle(() => ({ opacity: cream.get() }));

  const side = qrSide(size);
  const box = (x: number, y: number, modules: number) => ({
    left: origin + x * unit,
    top: origin + y * unit,
    width: modules * unit,
    height: modules * unit,
  });
  return (
    <Pressable
      accessible={shown}
      accessibilityRole={pressable ? 'button' : 'image'}
      accessibilityLabel={shown ? accessibilityLabel : undefined}
      accessibilityHint={shown && onPress ? copy.receive.qrHint : undefined}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      disabled={!pressable}
      onPress={live && pressable ? onPress : undefined}
      onLongPress={live && pressable ? onLongPress : undefined}
    >
      <Reanimated.View
        style={[styles.card, { width: side, height: side }, cardStyle]}
      >
        <View
          style={[
            styles.fill,
            state === 'expired' && styles.expired,
            state === 'scattered' && styles.scattered,
          ]}
        />
        <Reanimated.View style={[styles.fill, styles.cream, creamStyle]} />
        {shown || leaving ? (
          <>
            {layers.bands.map((d, band) =>
              d ? (
                <Layer
                  key={band}
                  layer={band}
                  state={state}
                  reduced={reduced}
                  frame={box(0, 0, layers.size)}
                  viewBox={`0 0 ${layers.size} ${layers.size}`}
                  d={d}
                />
              ) : null,
            )}
            {layers.finders.map(finder => (
              <Layer
                key={`${finder.x}-${finder.y}`}
                layer={FINDERS}
                state={state}
                reduced={reduced}
                frame={box(finder.x, finder.y, FINDER)}
                viewBox={`0 0 ${FINDER} ${FINDER}`}
                d={finder.d}
              />
            ))}
          </>
        ) : null}
        {state === 'expired' || state === 'scattered' ? (
          <Reanimated.View
            entering={riseIn(0, leaveMs(state))}
            style={styles.face}
          >
            {state === 'expired' ? (
              <Glyph name="clock" size={side / 4} color={palette.dust} />
            ) : (
              <Glyph
                name="twin"
                size={side * 0.7}
                color={palette.honey}
                strokeWidth={TWIN_STROKE}
              />
            )}
          </Reanimated.View>
        ) : null}
      </Reanimated.View>
    </Pressable>
  );
});
QrBloom.displayName = 'QrBloom';

const styles = StyleSheet.create({
  card: { borderRadius: radius.qr },
  fill: { ...StyleSheet.absoluteFill, borderRadius: radius.qr },
  cream: { backgroundColor: palette.cream },
  expired: {
    backgroundColor: palette.mocha,
    borderWidth: 1.5,
    borderColor: palette.husk,
  },
  scattered: {
    backgroundColor: palette.honeyWash,
    borderWidth: 1.5,
    borderColor: palette.honey,
  },
  layer: { position: 'absolute' },
  face: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
