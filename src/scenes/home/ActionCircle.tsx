import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { HostInstance } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { shake, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { REFUSED, tintTiming } from './motion';

/** A point in the window, where the scan reveal grows from. */
export type Point = { x: number; y: number };

const PRESSED = 0.92;

/**
 * One circle of Home's action row: Send and Receive at 56pt, Scan at 76.
 *
 * A stale balance gates it (REDESIGN.md 6, Wallet health). It turns dust,
 * says it is disabled, and a long press whispers why; the row it sits in
 * shrinks it. It still answers a tap, though not with its action: it shakes,
 * warns, and starts the refresh that will open the gate again. Under Reduce
 * Motion the shake is a radish tint instead.
 *
 * Its props are named apart from the pressable's own, so a suite that finds
 * the control by its label reaches the one that holds the gate.
 */
export function ActionCircle({
  glyph,
  size,
  label,
  hint,
  primary = false,
  test = false,
  stale,
  onAct,
  onRefresh,
}: {
  glyph: GlyphName;
  size: 56 | 76;
  label: string;
  hint: string;
  /** The row's main control, filled with bloom. */
  primary?: boolean;
  /** A test network, where slate stands in for bloom. */
  test?: boolean;
  stale: boolean;
  /** The action, given where the circle sits; absent while out of use. */
  onAct?: (origin?: Point) => void;
  /** Starts a refresh, for a tap on a gated circle. */
  onRefresh?: () => void;
}) {
  const { reduced } = useMotionPrefs();
  const view = useRef<HostInstance>(null);
  const origin = useRef<Point | undefined>(undefined);
  const press = useSharedValue(1);
  const nudge = useSharedValue(0);
  const tint = useSharedValue(0);

  // Where the circle is, in the window. Read when it is laid out and again
  // as a finger lands, so a reveal grows from where the circle is now.
  const measure = useCallback(() => {
    view.current?.measureInWindow((x, y, width, height) => {
      origin.current = { x: x + width / 2, y: y + height / 2 };
    });
  }, []);

  const refuse = useCallback(() => {
    haptics.warning();
    if (reduced) {
      tint.set(
        withSequence(
          withTiming(1, tintTiming(REFUSED.in)),
          withTiming(0, tintTiming(REFUSED.out)),
        ),
      );
    } else {
      nudge.set(shake());
    }
    announce(copy.health.staleAction, { assertive: true });
    onRefresh?.();
  }, [reduced, tint, nudge, onRefresh]);

  const onPress = onAct
    ? () => (stale ? refuse() : onAct(origin.current))
    : undefined;
  const onPressIn = onAct
    ? () => {
        measure();
        if (stale) return;
        haptics.tap();
        press.set(withSpring(PRESSED, springs.snap));
      }
    : undefined;
  const onPressOut = onAct
    ? () => press.set(withSpring(1, springs.snap))
    : undefined;

  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.get() }, { scale: press.get() }],
  }));
  const refused = useAnimatedStyle(() => ({ opacity: tint.get() }));

  const bloom = test ? palette.slate : palette.bloom;
  const fill = stale ? 'transparent' : primary ? bloom : palette.mocha;
  const ink = stale ? palette.dust : primary ? palette.ink : palette.cream;
  const circle = (
    <Reanimated.View style={motion}>
      <Pressable
        ref={view}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: stale }}
        accessibilityValue={stale ? { text: copy.health.stale } : undefined}
        onLayout={measure}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fill,
            borderColor: stale || !primary ? palette.husk : fill,
          },
        ]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.refused, { borderRadius: size / 2 }, refused]}
        />
        <Glyph name={glyph} size={size === 76 ? 30 : 24} color={ink} />
      </Pressable>
    </Reanimated.View>
  );
  // Only a gated circle whispers: a live one says what it does by doing it.
  return stale ? <Whisper label={copy.health.stale}>{circle}</Whisper> : circle;
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  refused: { ...StyleSheet.absoluteFill, backgroundColor: palette.radishSoft },
});
