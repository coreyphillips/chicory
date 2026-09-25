import React, { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type {
  AccessibilityActionEvent,
  AccessibilityValue,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { curves, durations, springs } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { Orbit } from '../scenes/send/Orbit';
import { bloomFor } from '../scenes/send/tone';
import { usePaneActive } from '../stage/panes/Pane';

/**
 * Hold to send (REDESIGN.md rule 5 and 5, HoldButton). A payment commits
 * only after the circle is held for 700ms, or 1000ms when the engine has
 * `warning`s about it, so a brush of the thumb never pays anyone. A plain tap
 * does nothing, and there is no `onPress` to call.
 *
 * Held, the circle dips and its ring fills, with a tick at each quarter.
 * Complete, it thuds, flashes cream, pops, and the arrow launches as twelve
 * petal sparks burst. Let go early, the fill drains away. With warnings the
 * fill is honey. While `busy` an orbit runs round the ring. On a test
 * network (`test`) slate stands in for bloom throughout.
 *
 * A screen reader has no hold to give, so it gets one `activate` action that
 * commits at once: the confirmation is the deliberate double tap. TalkBack
 * sends that as the action, and VoiceOver as an accessibility tap, since on
 * the new architecture iOS lists `activate` only among the custom actions;
 * both commit. Its words are the caller's, and a caller gives the whole of
 * what is committed in `accessibilityValue`, as Send gives the review.
 */
export interface HoldButtonProps {
  accessibilityLabel: string;
  /** What a screen reader hears after the label, such as the time left. */
  accessibilityValue?: AccessibilityValue;
  onCommit: () => void;
  warning?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** A test network, where slate stands in for bloom. */
  test?: boolean;
  /** What sits in the circle instead of the send glyph. */
  children?: ReactNode;
  /** The circle itself, for a screen that moves a screen reader to it. */
  ref?: Ref<ComponentRef<typeof View>>;
}

const ACTIONS = [{ name: 'activate' as const }];

const SIZE = 88;
const RING = 4;
const R = (SIZE - RING) / 2;
const AROUND = 2 * Math.PI * R;
/** The fill gathers slowly, then commits quickly. */
const FILL_CURVE = Easing.bezier(0.35, 0, 0.25, 1);
/** The arrow leaves up and to the right, this far, as it fades. */
const LAUNCH = 28;
const LAUNCH_MS = 240;
const SPARKS = 12;
/** How far past the rim a spark flies. */
const REACH = 34;
const BURST_MS = 700;

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

/** One petal of the burst, flying out from the rim at its angle. */
function Spark({
  index,
  burst,
  color,
}: {
  index: number;
  burst: SharedValue<number>;
  color: string;
}) {
  const angle = (index * 2 * Math.PI) / SPARKS;
  const style = useAnimatedStyle(() => {
    const t = burst.get();
    const out = SIZE / 2 + REACH * t;
    return {
      opacity: t > 0 && t < 1 ? 1 - t : 0,
      transform: [
        { translateX: Math.sin(angle) * out },
        { translateY: -Math.cos(angle) * out },
        { rotate: `${index * 30}deg` },
        { scale: 1 - 0.5 * t },
      ],
    };
  });
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[styles.spark, { backgroundColor: color }, style]}
    />
  );
}

const SPARK_INDEXES = Array.from({ length: SPARKS }, (_, index) => index);

export function HoldButton({
  accessibilityLabel,
  accessibilityValue,
  onCommit,
  warning = false,
  disabled = false,
  busy = false,
  test = false,
  children,
  ref,
}: HoldButtonProps) {
  const live = usePaneActive() && !disabled && !busy;
  const { reduced } = useMotionPrefs();
  const hold = warning ? durations.holdWarning : durations.hold;
  const fill = useSharedValue(0);
  const scale = useSharedValue(1);
  const flash = useSharedValue(0);
  const launch = useSharedValue(0);
  const burst = useSharedValue(0);
  // One list for the button's life, emptied and refilled with each hold.
  const ramp = useRef<ReturnType<typeof setTimeout>[]>([]);
  const committed = useRef(false);

  const stopRamp = () => {
    ramp.current.forEach(clearTimeout);
    ramp.current.length = 0;
  };
  useEffect(() => {
    const timers = ramp.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Sending shows no arrow. Back from sending without a result, as when the
  // send itself was refused, the circle is ready to be held again.
  useEffect(() => {
    if (busy) {
      if (!committed.current) launch.set(1);
      return;
    }
    committed.current = false;
    launch.set(withTiming(0, { duration: durations.enter }));
    fill.set(withSpring(0, springs.snap));
  }, [busy, launch, fill]);

  const begin = () => {
    committed.current = false;
    haptics.tap();
    if (!reduced) scale.set(withSpring(0.94, springs.snap));
    // The fill runs under Reduce Motion too: it is the hold's only clock.
    fill.set(
      withTiming(1, {
        duration: hold,
        easing: FILL_CURVE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    stopRamp();
    for (const step of [1, 2, 3]) {
      ramp.current.push(
        setTimeout(() => haptics.holdRamp(step), (hold * step) / 4),
      );
    }
  };

  const release = () => {
    stopRamp();
    if (committed.current) return;
    scale.set(withSpring(1, springs.snap));
    fill.set(withSpring(0, springs.snap));
  };

  const commit = () => {
    stopRamp();
    committed.current = true;
    haptics.holdRamp(4);
    fill.set(1);
    flash.set(
      withSequence(
        withTiming(1, { duration: durations.tick }),
        withTiming(0, { duration: durations.move }),
      ),
    );
    if (reduced) {
      launch.set(withTiming(1, { duration: durations.crossfade }));
    } else {
      scale.set(
        withSequence(
          withSpring(1.06, springs.reveal),
          withSpring(1, springs.snap),
        ),
      );
      launch.set(withTiming(1, { duration: LAUNCH_MS, easing: curves.exit }));
      burst.set(0);
      burst.set(withTiming(1, { duration: BURST_MS, easing: curves.enter }));
    }
    onCommit();
  };

  const fillProps = useAnimatedProps(() => ({
    strokeDashoffset: AROUND * (1 - fill.get()),
  }));
  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: 0.9 * flash.get() }));
  // Under Reduce Motion the arrow only fades: nothing travels.
  const arrowStyle = useAnimatedStyle(
    () => ({
      opacity: 1 - launch.get(),
      transform: reduced
        ? []
        : [
            { translateX: LAUNCH * launch.get() },
            { translateY: -LAUNCH * launch.get() },
          ],
    }),
    [reduced],
  );

  const bloom = bloomFor(test);
  const tone = disabled ? palette.dust : warning ? palette.honey : bloom.tone;
  return (
    <Reanimated.View style={[styles.frame, frameStyle]}>
      {SPARK_INDEXES.map(index => (
        <Spark key={index} index={index} burst={burst} color={bloom.hi} />
      ))}
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValue}
        accessibilityHint={copy.send.holdHint}
        accessibilityState={{ disabled, busy }}
        accessibilityActions={ACTIONS}
        onAccessibilityAction={
          live
            ? (event: AccessibilityActionEvent) => {
                if (event.nativeEvent.actionName === 'activate') commit();
              }
            : undefined
        }
        onAccessibilityTap={live ? commit : undefined}
        onPressIn={live ? begin : undefined}
        onPressOut={live ? release : undefined}
        onLongPress={live ? commit : undefined}
        delayLongPress={hold}
        disabled={disabled || busy}
        style={[
          styles.circle,
          { backgroundColor: bloom.soft },
          warning && styles.warning,
          disabled && styles.inactive,
        ]}
      >
        <Svg
          width={SIZE}
          height={SIZE}
          style={styles.fill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={palette.husk}
            strokeWidth={RING}
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth={RING}
            strokeLinecap="round"
            strokeDasharray={[AROUND, AROUND]}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            animatedProps={fillProps}
          />
        </Svg>
        <Reanimated.View
          pointerEvents="none"
          style={[styles.flash, flashStyle]}
        />
        <Reanimated.View style={arrowStyle}>
          {children ?? <Glyph name="send" size={32} color={palette.cream} />}
        </Reanimated.View>
        {busy ? <Orbit size={SIZE} stroke={RING} color={tone} /> : null}
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warning: { backgroundColor: palette.honeySoft },
  inactive: { backgroundColor: palette.mocha },
  fill: { position: 'absolute', top: 0, left: 0 },
  flash: {
    ...StyleSheet.absoluteFill,
    borderRadius: SIZE / 2,
    backgroundColor: palette.cream,
  },
  spark: {
    position: 'absolute',
    width: 6,
    height: 12,
    borderRadius: 3,
  },
});
