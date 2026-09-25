import React, { memo, useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Reanimated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { gradients, palette } from '../../design/palette';
import { curves } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import type { RegionProps } from '../../stage/Canvas';
import { usePaneActive } from '../../stage/panes/Pane';
import { useIncoming } from '../../stage/useIncoming';
import { tintTiming } from './motion';
import { useAppActive } from './useAppActive';
import { backdropVisual } from './visual';

export type BackdropProps = Pick<
  RegionProps,
  'snapshot' | 'stale' | 'backup' | 'session'
>;

const { G0, G1, G2, G3 } = gradients;

/** Slate in place of the bloom glow on a test network. */
const SLATE_GLOW = [
  { offset: 0, color: palette.slate, opacity: 0.2 },
  { offset: 0.6, color: '#2A2C31', opacity: 0.1 },
  { offset: 1, color: '#2A2C31', opacity: 0 },
];

/** A stale balance dims the glow and the crema to this. */
const DIMMED = 0.25;

/** How the radish tint comes in and goes out. */
const RADISH_IN = 200;
const RADISH_OUT = 600;

type Stops = ReadonlyArray<{ offset: number; color: string; opacity: number }>;

/** A tint's colour at its strength, fading to nothing. */
const fading = ({ color, opacity }: { color: string; opacity: number }) => [
  { offset: 0, color, opacity },
  { offset: 1, color, opacity: 0 },
];
const HONEY = fading(G3.honey);
const SAGE = fading(G3.sageFlash);
const RADISH = fading(G3.radish);

/** Where the mark sits, as a fraction of the pane, for the honey tint. */
const AT_MARK = { cx: 0.12, cy: 0.06 };
/** Where the hero sits, for the flashes over the balance. */
const AT_HERO = { cx: 0.5, cy: 0.28 };

/**
 * How far past each edge the drifting glows are drawn, so that at the far
 * end of a drift, turned as far as the bloom glow turns, no edge of a layer
 * ever shows inside the pane.
 */
export function glowBleed(width: number, height: number): number {
  const turn = Math.sin((G1.drift.rotate * Math.PI) / 180);
  return Math.ceil(
    G1.drift.x * width +
      G1.drift.y * height +
      (turn * Math.max(width, height)) / 2,
  );
}

/**
 * The ground of the top pane, drawn first so everything else sits on it
 * (REDESIGN.md 3.2). It fills the pane edge to edge, under the status bar
 * too, and takes no touches and says nothing.
 *
 * G0 is a still vertical wash. G1, the bloom glow, drifts on an 18 second
 * sine and turns slowly over 26; G2, the crema, drifts the opposite way on
 * 22. Only the views around them move, by transform and opacity, and never
 * while the pane is covered, the app is away, or motion is reduced. A stale
 * balance dims both, and a test network turns the glow slate.
 *
 * G3 is the state tint, one at a time, crossfading over 600ms: honey while a
 * backup waits or a payment's outcome is unknown, night while an offline
 * request is open. Over it flash sage when money arrives and radish when a
 * refresh or a payment fails.
 */
export function Backdrop({ snapshot, stale, backup, session }: BackdropProps) {
  const { width, height } = useWindowDimensions();
  const live = usePaneActive();
  const awake = useAppActive();
  const { reduced } = useMotionPrefs();
  const running = live && awake && !reduced;
  const bleed = glowBleed(width, height);
  const spill = { top: -bleed, left: -bleed, right: -bleed, bottom: -bleed };
  const look = backdropVisual({
    snapshot,
    stale,
    backupPending: !!backup?.pending,
  });

  const drift = useSwing(G1.drift.period / 2, running);
  const spin = useSwing(G1.drift.spin / 2, running);
  const crema = useSwing(G2.drift.period / 2, running);
  const glow = useSharedValue(look.dim ? DIMMED : 1);
  const honey = useSharedValue(look.tint === 'honey' ? 1 : 0);
  const night = useSharedValue(look.tint === 'night' ? 1 : 0);
  const sage = useSharedValue(0);
  const radish = useSharedValue(0);

  // Every tint is a colour and nothing more, so each plays under Reduce
  // Motion as well.
  useEffect(() => {
    const fade = tintTiming(G3.crossfade);
    glow.set(withTiming(look.dim ? DIMMED : 1, fade));
    honey.set(withTiming(look.tint === 'honey' ? 1 : 0, fade));
    night.set(withTiming(look.tint === 'night' ? 1 : 0, fade));
  }, [look.dim, look.tint, glow, honey, night]);

  const arrived = useIncoming(snapshot);
  useEffect(() => {
    if (!arrived) return;
    sage.set(
      withSequence(
        withTiming(1, tintTiming(G3.sageFlash.in, curves.enter)),
        withTiming(0, tintTiming(G3.sageFlash.out)),
      ),
    );
  }, [arrived, sage]);

  const failed = useFailures(snapshot, session.error);
  useEffect(() => {
    if (!failed) return;
    // In, held, and out again within the tint's 1200ms.
    radish.set(
      withSequence(
        withTiming(1, tintTiming(RADISH_IN, curves.enter)),
        withDelay(
          G3.radish.hold - RADISH_IN - RADISH_OUT,
          withTiming(0, tintTiming(RADISH_OUT)),
          ReduceMotion.Never,
        ),
      ),
    );
  }, [failed, radish]);

  const g1 = useAnimatedStyle(() => {
    const swing = 2 * drift.get() - 1;
    return {
      opacity: glow.get(),
      transform: [
        { translateX: swing * G1.drift.x * width },
        { translateY: swing * G1.drift.y * height },
        { rotate: `${spin.get() * G1.drift.rotate}deg` },
      ],
    };
  }, [width, height]);
  const g2 = useAnimatedStyle(() => {
    const swing = 1 - 2 * crema.get();
    return {
      opacity: glow.get(),
      transform: [
        { translateX: swing * G1.drift.x * width },
        { translateY: swing * G1.drift.y * height },
      ],
    };
  }, [width, height]);
  const honeyStyle = useAnimatedStyle(() => ({ opacity: honey.get() }));
  const nightStyle = useAnimatedStyle(() => ({
    opacity: night.get() * G3.night.opacity,
  }));
  const sageStyle = useAnimatedStyle(() => ({ opacity: sage.get() }));
  const radishStyle = useAnimatedStyle(() => ({ opacity: radish.get() }));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.ground}
    >
      <Wash width={width} height={height} />
      <Reanimated.View style={[styles.layer, spill, g1]}>
        <Glow
          width={width + 2 * bleed}
          height={height + 2 * bleed}
          cx={bleed + G1.cx * width}
          cy={bleed + G1.cy * height}
          radius={G1.r * width}
          stops={look.glow === 'slate' ? SLATE_GLOW : G1.stops}
        />
      </Reanimated.View>
      <Reanimated.View style={[styles.layer, spill, g2]}>
        <Glow
          width={width + 2 * bleed}
          height={height + 2 * bleed}
          cx={bleed + G2.cx * width}
          cy={bleed + G2.cy * height}
          radius={G2.r * width}
          stops={G2.stops}
        />
      </Reanimated.View>
      <Tint
        style={honeyStyle}
        width={width}
        height={height}
        at={AT_MARK}
        stops={HONEY}
      />
      <Reanimated.View style={[styles.layer, styles.night, nightStyle]} />
      <Tint
        style={sageStyle}
        width={width}
        height={height}
        at={AT_HERO}
        stops={SAGE}
      />
      <Tint
        style={radishStyle}
        width={width}
        height={height}
        at={AT_HERO}
        stops={RADISH}
      />
    </View>
  );
}

/**
 * A value that swings from 0 to 1 and back on a sine, `half` milliseconds
 * each way, while `running`. It rests in the middle until it first runs.
 * Stopped, it holds where it is; started again, it eases back to 0 first, so
 * the swing keeps its full range.
 */
function useSwing(half: number, running: boolean): SharedValue<number> {
  const value = useSharedValue(0.5);
  useEffect(() => {
    if (!running) return;
    const sine = { duration: half, easing: curves.sine };
    value.set(
      withSequence(
        withTiming(0, { ...sine, duration: half * value.get() }),
        withRepeat(withTiming(1, sine), -1, true),
      ),
    );
    return () => cancelAnimation(value);
  }, [half, running, value]);
  return value;
}

/**
 * A count that goes up by one each time something fails in front of the
 * user: a refresh that stops working, or a payment that turns failed
 * between one read and the next. The first read of a wallet sets what is
 * already there.
 */
function useFailures(snapshot: WalletSnapshot, error: string): number {
  const [count, setCount] = useState(0);
  const last = useRef<{ wallet: string; failed: Set<string> } | null>(null);
  const hadError = useRef(!!error);
  useEffect(() => {
    const failed = new Set(
      snapshot.activity
        .filter(item => item.status === 'failed')
        .map(item => item.id),
    );
    const before = last.current;
    last.current = { wallet: snapshot.wallet.id, failed };
    if (!before || before.wallet !== snapshot.wallet.id) return;
    if ([...failed].some(id => !before.failed.has(id))) {
      setCount(value => value + 1);
    }
  }, [snapshot]);
  useEffect(() => {
    const was = hadError.current;
    hadError.current = !!error;
    if (error && !was) setCount(value => value + 1);
  }, [error]);
  return count;
}

/** G0: the still wash, a touch of violet at the top down to roast. */
const Wash = memo(function WashSvg({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const id = `wash${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stopsOf(G0.stops)}
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
});

/** A radial glow `radius` points wide, centred `cx`, `cy` points in. */
const Glow = memo(function GlowSvg({
  width,
  height,
  cx,
  cy,
  radius,
  stops,
}: {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  stops: Stops;
}) {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r={radius}
        >
          {stopsOf(stops)}
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
});

/** One G3 tint, fading out from `at`, shown as far as `style` lets it. */
function Tint({
  style,
  width,
  height,
  at,
  stops,
}: {
  style: ReturnType<typeof useAnimatedStyle>;
  width: number;
  height: number;
  at: { cx: number; cy: number };
  stops: Stops;
}) {
  return (
    <Reanimated.View style={[styles.layer, style]}>
      <Glow
        width={width}
        height={height}
        cx={at.cx * width}
        cy={at.cy * height}
        radius={0.9 * width}
        stops={stops}
      />
    </Reanimated.View>
  );
}

/** The stops of a gradient, as react-native-svg takes them. */
const stopsOf = (stops: Stops) =>
  stops.map(stop => (
    <Stop
      key={stop.offset}
      offset={stop.offset}
      stopColor={stop.color}
      stopOpacity={stop.opacity}
    />
  ));

const styles = StyleSheet.create({
  ground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.roast,
    overflow: 'hidden',
  },
  layer: StyleSheet.absoluteFill,
  // Night is a flat wash; its strength is the most its layer's opacity
  // reaches.
  night: { backgroundColor: G3.night.color },
});
