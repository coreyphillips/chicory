import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  AccessibilityActionEvent,
  AccessibilityValue,
} from 'react-native';
import {
  GestureDetector,
  useLongPressGesture,
} from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
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
 * The hold is a long press the gesture handler times on the UI thread, where
 * the fill runs: the complete plays as the ring fills however busy the
 * JavaScript thread is, the payment follows as soon as that thread is free,
 * and a finger lifted after the ring is whole cannot take it back. Lifted
 * before, nothing is paid. Held, the circle dips and its ring fills, with a
 * tick at each quarter. Complete, it thuds, flashes cream and pops, and as
 * the flash peaks the arrow launches, twelve petal sparks burst and the fill
 * drains away. Let go early, the fill drains with the snap spring. With
 * warnings the fill is honey. While `busy` an orbit runs round the emptied
 * ring, in bloom for money in flight. On a test network (`test`) slate
 * stands in for bloom throughout.
 *
 * A screen reader has no hold to give, so it gets one `activate` action that
 * commits at once: the confirmation is the deliberate double tap. TalkBack
 * sends that as the action, and VoiceOver as an accessibility tap, since on
 * the new architecture iOS lists `activate` only among the custom actions;
 * both commit. However many of these arrive, `onCommit` is called once until
 * the circle is ready again. Its words are the caller's, and a caller gives
 * the whole of what is committed in `accessibilityValue`, as Send gives the
 * review.
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
/** A finger that strays this far from where it pressed lets go. */
const STRAY = SIZE / 2;

/*
 * The complete, in order: the flash rises over a tick, and the launch, the
 * burst and the drain start as it peaks. The flash, the reduced launch and
 * the drain are a colour, a fade and a ring emptying, which move nothing
 * through space, so they play under Reduce Motion too.
 */
const FLASH_IN = {
  duration: durations.tick,
  reduceMotion: ReduceMotion.Never,
};
const FLASH_OUT = {
  duration: durations.move,
  reduceMotion: ReduceMotion.Never,
};
const DRAIN = {
  duration: durations.move,
  easing: curves.standard,
  reduceMotion: ReduceMotion.Never,
};
const FADE = {
  duration: durations.crossfade,
  reduceMotion: ReduceMotion.Never,
};
const FLIGHT = { duration: LAUNCH_MS, easing: curves.exit };
const BURST = { duration: BURST_MS, easing: curves.enter };

/** The parts of the hold that move, driven from the UI thread. */
export interface HoldParts {
  fill: SharedValue<number>;
  scale: SharedValue<number>;
  flash: SharedValue<number>;
  launch: SharedValue<number>;
  burst: SharedValue<number>;
  /** Set as the hold commits, until the circle is ready to be held again. */
  sealed: SharedValue<boolean>;
}

/**
 * A finger comes down: the circle dips and the fill runs over `hold` ms.
 * The fill runs under Reduce Motion too: it is the hold's only clock.
 * Returns false on a circle that has already committed, which takes no
 * new hold.
 */
export function pressIn(
  parts: HoldParts,
  hold: number,
  reduced: boolean,
): boolean {
  'worklet';
  if (parts.sealed.get()) return false;
  if (!reduced) parts.scale.set(withSpring(0.94, springs.snap));
  parts.fill.set(
    withTiming(1, {
      duration: hold,
      easing: FILL_CURVE,
      reduceMotion: ReduceMotion.Never,
    }),
  );
  return true;
}

/** The finger lifts before the hold completes: the fill drains away. */
export function letGo(parts: HoldParts) {
  'worklet';
  if (parts.sealed.get()) return;
  parts.scale.set(withSpring(1, springs.snap));
  parts.fill.set(withSpring(0, springs.snap));
}

/**
 * The hold completes (REDESIGN.md 5, HoldButton): the ring is whole, a cream
 * flash rises and the circle pops to 1.06; as the flash peaks the arrow
 * launches, the sparks burst and the fill drains, so the orbit that runs
 * while the payment is sent has the track to itself. Under Reduce Motion the
 * arrow only fades and nothing pops or bursts. Returns false when the hold
 * had already committed, so it plays once.
 */
export function seal(parts: HoldParts, reduced: boolean): boolean {
  'worklet';
  if (parts.sealed.get()) return false;
  parts.sealed.set(true);
  parts.fill.set(1);
  parts.fill.set(
    withDelay(durations.tick, withTiming(0, DRAIN), ReduceMotion.Never),
  );
  parts.flash.set(
    withSequence(withTiming(1, FLASH_IN), withTiming(0, FLASH_OUT)),
  );
  if (reduced) {
    parts.launch.set(
      withDelay(durations.tick, withTiming(1, FADE), ReduceMotion.Never),
    );
    return true;
  }
  parts.scale.set(
    withSequence(withSpring(1.06, springs.reveal), withSpring(1, springs.snap)),
  );
  parts.launch.set(withDelay(durations.tick, withTiming(1, FLIGHT)));
  parts.burst.set(0);
  parts.burst.set(withDelay(durations.tick, withTiming(1, BURST)));
  return true;
}

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
  const sealed = useSharedValue(false);
  const parts = useMemo<HoldParts>(
    () => ({ fill, scale, flash, launch, burst, sealed }),
    [fill, scale, flash, launch, burst, sealed],
  );
  // One list for the button's life, emptied and refilled with each hold.
  const ramp = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Whether `onCommit` has been called since the circle was last ready.
  const committed = useRef(false);
  const latest = useRef(onCommit);
  useLayoutEffect(() => {
    latest.current = onCommit;
  });

  const stopRamp = useCallback(() => {
    ramp.current.forEach(clearTimeout);
    ramp.current.length = 0;
  }, []);
  useEffect(() => {
    const timers = ramp.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  /** A finger came down: a tap, then a tick at each quarter of the hold. */
  const began = useCallback(() => {
    haptics.tap();
    stopRamp();
    for (const step of [1, 2, 3]) {
      ramp.current.push(
        setTimeout(() => haptics.holdRamp(step), (hold * step) / 4),
      );
    }
  }, [hold, stopRamp]);

  /** The hold committed: the thud, and the payment, once. */
  const landed = useCallback(() => {
    stopRamp();
    if (committed.current) return;
    committed.current = true;
    haptics.holdRamp(4);
    latest.current();
  }, [stopRamp]);

  // Sending shows no arrow. Back from sending without a result, as when the
  // send itself was refused, the circle is ready to be held again and the
  // arrow comes back. Under Reduce Motion that is only a fade, so it plays.
  useEffect(() => {
    if (busy) {
      if (!committed.current) launch.set(1);
      return;
    }
    committed.current = false;
    sealed.set(false);
    launch.set(
      withTiming(0, {
        duration: reduced ? durations.crossfade : durations.enter,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    fill.set(withSpring(0, springs.snap));
  }, [busy, reduced, launch, fill, sealed]);

  // The hold is timed where the fill runs, on the UI thread: it commits the
  // moment the ring is whole, and a finger lifted after that cannot undo it.
  const gesture = useLongPressGesture(
    useMemo(
      () => ({
        enabled: live,
        minDuration: hold,
        maxDistance: STRAY,
        onBegin: () => {
          'worklet';
          if (pressIn(parts, hold, reduced)) scheduleOnRN(began);
        },
        onActivate: () => {
          'worklet';
          if (seal(parts, reduced)) scheduleOnRN(landed);
        },
        onFinalize: () => {
          'worklet';
          letGo(parts);
          scheduleOnRN(stopRamp);
        },
      }),
      [live, hold, reduced, parts, began, landed, stopRamp],
    ),
  );

  /** A screen reader's commit, which has no hold to give. */
  const commitNow = () => {
    if (committed.current) return;
    seal(parts, reduced);
    landed();
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
  // The payment is in flight whatever the fill was, so the orbit is bloom.
  const orbit = disabled ? palette.dust : bloom.tone;
  return (
    <Reanimated.View style={[styles.frame, frameStyle]}>
      {SPARK_INDEXES.map(index => (
        <Spark key={index} index={index} burst={burst} color={bloom.hi} />
      ))}
      <GestureDetector gesture={gesture}>
        <View
          ref={ref}
          collapsable={false}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={accessibilityValue}
          accessibilityHint={copy.send.holdHint}
          accessibilityState={{ disabled, busy }}
          accessibilityActions={ACTIONS}
          onAccessibilityAction={
            live
              ? (event: AccessibilityActionEvent) => {
                  if (event.nativeEvent.actionName === 'activate') {
                    commitNow();
                  }
                }
              : undefined
          }
          onAccessibilityTap={live ? commitNow : undefined}
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
          {busy ? <Orbit size={SIZE} stroke={RING} color={orbit} /> : null}
        </View>
      </GestureDetector>
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
