import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';
import { DrawnGlyph } from './DrawnGlyph';
import { Orbit } from './Orbit';
import { useShake } from './motion';

/** The control's circle, the size the home circle grows to (REDESIGN.md 7, T1). */
export const CONTROL = 88;
const RING = 4;

type Tone = 'bloom' | 'honey';

const RINGS: Record<Tone, string> = {
  bloom: palette.bloom,
  honey: palette.honey,
};
const FILLS: Record<Tone, string> = {
  bloom: palette.bloomSoft,
  honey: palette.honeySoft,
};

/**
 * Send's round control at the foot of the scene, for a tap: review the
 * payment, or refresh a quote that ran out. While `busy` an orbit runs round
 * it. Without `onPress`, as before there is a request to review, it waits in
 * dust.
 *
 * `stale` is the gate a balance too old to spend against closes
 * (REDESIGN.md 6, Send): the control turns dust and says why, and a tap
 * shakes it before `onPress`, which the caller points at a refresh rather
 * than at going on. Its words show through Whisper, as a disabled
 * control's do.
 *
 * Like every control on the canvas, it is given `onPress` only while its
 * pane is in use, and only when a tap does something.
 */
export function CircleControl({
  accessibilityLabel,
  accessibilityHint,
  onPress,
  busy = false,
  stale = false,
  tone = 'bloom',
  children,
}: {
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  busy?: boolean;
  stale?: boolean;
  tone?: Tone;
  children?: ReactNode;
}) {
  const live = usePaneActive() && !busy;
  const { reduced } = useMotionPrefs();
  const refusal = useShake();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  const to = (value: number) => {
    if (!reduced) scale.set(withSpring(value, springs.snap));
  };
  const dust = !onPress || stale;
  const press = onPress
    ? () => {
        if (stale) {
          haptics.warning();
          refusal.play();
        } else {
          haptics.tap();
        }
        onPress();
      }
    : null;
  const control = (
    <Reanimated.View style={[refusal.style, pressStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: dust, busy }}
        onPressIn={live && press ? () => to(0.94) : undefined}
        onPressOut={live && press ? () => to(1) : undefined}
        onPress={live && press ? press : undefined}
        style={[
          styles.circle,
          {
            backgroundColor: dust ? palette.mocha : FILLS[tone],
            borderColor: dust ? palette.husk : RINGS[tone],
          },
        ]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.tint, refusal.tint]}
        />
        {children ?? (
          <Glyph
            name="send"
            size={32}
            color={dust ? palette.dust : palette.cream}
          />
        )}
        {busy ? (
          <View style={styles.orbit}>
            <Orbit size={CONTROL} stroke={RING} color={RINGS[tone]} />
          </View>
        ) : null}
      </Pressable>
    </Reanimated.View>
  );
  return stale ? (
    <Whisper label={accessibilityHint ?? accessibilityLabel}>{control}</Whisper>
  ) : (
    control
  );
}

/**
 * A quote that ran out (REDESIGN.md 5, ExpiryRing): the arrow turns away
 * and fades as the refresh glyph draws in, and a tap asks for a new quote
 * for the same payment.
 */
export function QuoteRefresh({
  onPress,
  busy,
}: {
  onPress?: () => void;
  busy: boolean;
}) {
  const { reduced } = useMotionPrefs();
  const turned = useSharedValue(0);
  useEffect(() => {
    turned.set(
      withTiming(1, {
        duration: reduced ? durations.crossfade : durations.move,
        easing: curves.standard,
      }),
    );
  }, [reduced, turned]);
  const arrow = useAnimatedStyle(
    () => ({
      opacity: 1 - turned.get(),
      transform: reduced ? [] : [{ rotate: `${-135 * turned.get()}deg` }],
    }),
    [reduced],
  );
  return (
    <CircleControl
      accessibilityLabel={copy.send.refreshQuote}
      accessibilityHint={copy.send.quoteExpired}
      onPress={onPress}
      busy={busy}
      tone="honey"
    >
      <Reanimated.View style={[styles.glyph, arrow]}>
        <Glyph name="send" size={32} color={palette.cream} />
      </Reanimated.View>
      <View style={styles.glyph}>
        <DrawnGlyph
          name="refresh"
          size={32}
          color={palette.honey}
          strokes={[{ duration: durations.draw, delay: durations.exit }]}
        />
      </View>
    </CircleControl>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tint: {
    ...StyleSheet.absoluteFill,
    borderRadius: CONTROL / 2,
    backgroundColor: palette.radishWash,
  },
  glyph: { position: 'absolute' },
  // Absolute children sit inside the border, so the orbit steps out over it.
  orbit: {
    position: 'absolute',
    top: -RING,
    left: -RING,
    width: CONTROL,
    height: CONTROL,
  },
});
