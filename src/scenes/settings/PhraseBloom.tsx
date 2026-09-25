import React, { memo, useEffect, useId, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { durations, shake, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { RING, petalAngle, phraseBloom } from './motion';

const SIZE = 120;

/** The bloom's petal, pointing up from the centre (REDESIGN.md 5, Bloom). */
const PETAL =
  'M-1.6,-8 C-4.2,-18 -9.8,-31 -10.4,-41.5 L-8.3,-44.8 L-6.25,-42.6 L-4.2,-45.6 L-2.1,-43.3 L0,-46 L2.1,-43.3 L4.2,-45.6 L6.25,-42.6 L8.3,-44.8 L10.4,-41.5 C9.8,-31 4.2,-18 1.6,-8 Z';

/** How long each ring's petals are, against the full flower. */
const REACH = { inner: 0.62, outer: 1 } as const;

type Ring = keyof typeof REACH;
type Tint = 'live' | 'test' | 'over' | 'wilted';

const INDICES = Array.from({ length: RING }, (_, index) => index);

/** Where a petal sits in the 100 grid: at the centre, turned and sized. */
const placed = (ring: Ring, index: number) =>
  `translate(50 50) rotate(${petalAngle(ring, index)}) scale(${REACH[ring]})`;

/** One ring's empty places, drawn once as a faint outline. */
const Slots = memo(function SlotRing({ ring }: { ring: Ring }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 100 100">
      {INDICES.map(index => (
        <G key={index} transform={placed(ring, index)}>
          <Path d={PETAL} fill="none" stroke={palette.husk} strokeWidth={1.2} />
        </G>
      ))}
    </Svg>
  );
});

/** One lit petal's shape, still; its view does the moving. */
const PetalShape = memo(function PetalSvg({
  ring,
  tint,
}: {
  ring: Ring;
  tint: Tint;
}) {
  // SVG ids are document-wide on some renderers, so each petal names its own.
  const gradient = `word${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fill =
    tint === 'live'
      ? `url(#${gradient})`
      : tint === 'test'
      ? palette.slate
      : tint === 'over'
      ? palette.radish
      : palette.dust;
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="-8"
          x2="0"
          y2="-46"
        >
          <Stop offset="0" stopColor={palette.bloomNight} />
          <Stop offset="0.45" stopColor={palette.bloomDeep} />
          <Stop offset="1" stopColor={palette.bloomHi} />
        </LinearGradient>
      </Defs>
      <G transform={`translate(50 50) scale(${REACH[ring]})`}>
        <Path d={PETAL} fill={fill} />
      </G>
    </Svg>
  );
});

/**
 * A petal lighting for a word: it unfolds on the reveal spring from a turned,
 * narrow bud into its place, the way the bloom's own petals open. Under
 * Reduce Motion it only fades in.
 */
const Petal = memo(function PetalView({
  ring,
  index,
  lit,
  tint,
}: {
  ring: Ring;
  index: number;
  lit: boolean;
  tint: Tint;
}) {
  const { reduced } = useMotionPrefs();
  const angle = petalAngle(ring, index);
  const q = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    const target = lit ? 1 : 0;
    q.set(
      reduced
        ? withTiming(target, { duration: durations.crossfade })
        : withSpring(target, springs.reveal),
    );
  }, [lit, reduced, q]);
  const pose = useAnimatedStyle(() => {
    const open = q.get();
    return {
      opacity: open,
      transform: [
        { rotate: `${reduced ? angle : angle - 14 * (1 - open)}deg` },
        { scale: reduced ? 1 : 0.4 + 0.6 * open },
      ],
    };
  });
  return (
    <Reanimated.View style={[StyleSheet.absoluteFill, pose]}>
      <PetalShape ring={ring} tint={tint} />
    </Reanimated.View>
  );
});

/**
 * Restore entry's count of words (REDESIGN.md 6, Backup and setup): each
 * typed word lights the next petal, clockwise from the top. From the
 * thirteenth a second ring lights between the first. Exactly 12 or 24 pops
 * the centre to sage, which is when the restore control wakes. More than 24
 * turns the petals radish and shakes them, and a phrase the wallet refused
 * wilts them to dust.
 *
 * `test` draws a test network's phrase in slate, as the mark does.
 */
export function PhraseBloom({
  count,
  test = false,
  wilted = false,
}: {
  count: number;
  test?: boolean;
  wilted?: boolean;
}) {
  const { reduced } = useMotionPrefs();
  const { inner, outer, ready, over } = phraseBloom(count);
  const tint: Tint = wilted ? 'wilted' : over ? 'over' : test ? 'test' : 'live';

  const sway = useSharedValue(0);
  const center = useSharedValue(1);
  const second = useSharedValue(inner === RING ? 1 : 0);
  const before = useRef(count);
  useEffect(() => {
    const was = before.current;
    before.current = count;
    if (count === was) return;
    if (count > 2 * RING) {
      haptics.rigid();
      if (!reduced) sway.set(shake());
    } else if (count === RING || count === 2 * RING) {
      haptics.success();
      if (!reduced) {
        center.set(
          withSequence(
            withSpring(1.3, springs.boing),
            withSpring(1, springs.boing),
          ),
        );
      }
    } else if (count > was) {
      haptics.soft();
    }
  }, [count, reduced, sway, center]);
  useEffect(() => {
    if (!wilted) return;
    haptics.error();
    if (!reduced) sway.set(shake());
  }, [wilted, reduced, sway]);
  useEffect(() => {
    second.set(
      withTiming(inner === RING ? 1 : 0, { duration: durations.enter }),
    );
  }, [inner, second]);
  useEffect(
    () => () => {
      cancelAnimation(sway);
      cancelAnimation(center);
      cancelAnimation(second);
    },
    [sway, center, second],
  );

  const swaying = useAnimatedStyle(() => ({
    transform: [{ translateX: sway.get() }],
  }));
  const popping = useAnimatedStyle(() => ({
    transform: [{ scale: center.get() }],
  }));
  const outerSlots = useAnimatedStyle(() => ({ opacity: second.get() }));

  const words = copy.settings.create;
  const centre = wilted
    ? palette.dust
    : over
    ? palette.radish
    : ready
    ? palette.sage
    : palette.stamen;
  return (
    <Reanimated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={words.words}
      accessibilityValue={{
        min: 0,
        max: 2 * RING,
        now: count,
        ...(count
          ? {
              text: ready ? words.wordsReady(count) : words.wordCount(count),
            }
          : {}),
      }}
      style={[styles.bloom, swaying]}
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, outerSlots]}>
        <Slots ring="outer" />
      </Reanimated.View>
      {INDICES.map(index => (
        <Petal
          key={`outer${index}`}
          ring="outer"
          index={index}
          lit={index < outer}
          tint={tint}
        />
      ))}
      <View style={StyleSheet.absoluteFill}>
        <Slots ring="inner" />
      </View>
      {INDICES.map(index => (
        <Petal
          key={`inner${index}`}
          ring="inner"
          index={index}
          lit={index < inner}
          tint={tint}
        />
      ))}
      <Reanimated.View style={[styles.center, popping]}>
        <Svg width={CENTER} height={CENTER} viewBox="0 0 20 20">
          <Circle cx="10" cy="10" r="9" fill={centre} />
        </Svg>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const CENTER = SIZE * 0.17;

const styles = StyleSheet.create({
  bloom: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
  },
  center: {
    position: 'absolute',
    left: (SIZE - CENTER) / 2,
    top: (SIZE - CENTER) / 2,
    width: CENTER,
    height: CENTER,
  },
});
