import React, { useEffect, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { riseIn } from '../../motion/presets';
import { shake, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';
import { space, type as typography } from '../../theme';
import type { Focus } from './focus';
import { Pulse, Spin } from './loops';

/** How long a refusal tints a control instead of shaking it (REDESIGN.md 8). */
const TINT_MS = 400;

/**
 * Plays once each time `key` changes to a new truthy value, never on mount:
 * a shake or a pulse that answers something that just happened.
 */
function useOnce(key: number | undefined, play: () => void) {
  const seen = useRef(key);
  useEffect(() => {
    if (!key || key === seen.current) return;
    seen.current = key;
    play();
  });
}

/**
 * A round glyph control, the only kind Receive has (REDESIGN.md 6). Its
 * label, hint and state carry the words a button used to show.
 *
 * `disabled` takes no taps. `blocked` looks and reads disabled but still
 * answers a tap with `onBlocked`, as a control held back by a stale balance
 * shakes and refreshes. A new `shake` refuses; a new `pulse` swells once to
 * say it is the way on; `halo` rings it in bloom for as long as it is the
 * only way on. `busy` turns an orbit round it. Children sit beside the glyph
 * as data, such as the amount a request is for. `focusRef` is where a
 * screen reader's focus is sent when this is the way on.
 */
export function GlyphButton({
  glyph,
  label,
  hint,
  onPress,
  onBlocked,
  size = 56,
  tone = 'raised',
  disabled = false,
  blocked = false,
  busy = false,
  shake: shakeKey,
  pulse: pulseKey,
  halo = false,
  expanded,
  focusRef,
  children,
}: PropsWithChildren<{
  glyph: GlyphName;
  label: string;
  hint?: string;
  onPress: () => void;
  onBlocked?: () => void;
  size?: number;
  tone?: 'primary' | 'raised';
  disabled?: boolean;
  blocked?: boolean;
  busy?: boolean;
  shake?: number;
  pulse?: number;
  halo?: boolean;
  /** For a control that opens something: whether it is open. */
  expanded?: boolean;
  focusRef?: Focus;
}>) {
  const live = usePaneActive();
  const { reduced } = useMotionPrefs();
  const press = useSharedValue(1);
  const x = useSharedValue(0);
  const swell = useSharedValue(1);
  const tint = useSharedValue(0);
  useOnce(shakeKey, () => {
    if (reduced) {
      tint.set(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(0, { duration: TINT_MS }),
        ),
      );
    } else {
      x.set(shake());
    }
  });
  useOnce(pulseKey, () => {
    if (reduced) return;
    swell.set(
      withSequence(
        withSpring(1.12, springs.reveal),
        withSpring(1, springs.reveal),
      ),
    );
  });
  useEffect(
    () => () => {
      cancelAnimation(x);
      cancelAnimation(swell);
      cancelAnimation(tint);
      cancelAnimation(press);
    },
    [x, swell, tint, press],
  );
  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { scale: swell.get() * press.get() }],
  }));
  const tinted = useAnimatedStyle(() => ({ opacity: tint.get() }));

  const quiet = disabled || blocked;
  const primary = tone === 'primary' && !quiet;
  const ink = quiet ? palette.dust : primary ? palette.ink : palette.cream;
  const to = (scale: number) =>
    press.set(reduced ? 1 : withSpring(scale, springs.snap));
  const round = { width: size, height: size, borderRadius: size / 2 };
  const pill = { minHeight: size, borderRadius: size / 2 };
  return (
    <Reanimated.View style={moved}>
      {halo ? (
        <Pulse style={[styles.around, around(size)]}>
          <View style={[styles.haloRing, ring(size)]} />
        </Pulse>
      ) : null}
      <Pressable
        ref={focusRef}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: quiet, busy, expanded }}
        disabled={disabled || busy}
        onPressIn={live ? () => to(0.94) : undefined}
        onPressOut={live ? () => to(1) : undefined}
        onPress={
          live
            ? () => {
                if (blocked) {
                  onBlocked?.();
                  return;
                }
                if (primary) haptics.tap();
                else haptics.tick();
                onPress();
              }
            : undefined
        }
        style={[
          styles.control,
          children ? [styles.pill, pill] : round,
          primary ? styles.primary : styles.raised,
          quiet && styles.quiet,
        ]}
      >
        <Glyph name={glyph} size={Math.round(size * 0.42)} color={ink} />
        {children ? (
          <Text
            style={[styles.data, { color: ink }]}
            maxFontSizeMultiplier={1.4}
          >
            {children}
          </Text>
        ) : null}
        <Reanimated.View
          pointerEvents="none"
          style={[styles.tint, children ? pill : round, tinted]}
        />
      </Pressable>
      {busy ? (
        <Spin style={[styles.around, around(size)]}>
          <Orbit size={size + ORBIT_GAP * 2} />
        </Spin>
      ) : null}
    </Reanimated.View>
  );
}

const ORBIT_GAP = 5;

/** A circle just outside a control `size` across. */
const ring = (size: number) => ({
  width: size + ORBIT_GAP * 2,
  height: size + ORBIT_GAP * 2,
  borderRadius: size / 2 + ORBIT_GAP,
});

/** Where that circle sits, from the control's own corner. */
const around = (size: number) => ({
  top: -ORBIT_GAP,
  left: -ORBIT_GAP,
  ...ring(size),
});

/** A quarter arc in bloom, which turns while something is being prepared. */
function Orbit({ size }: { size: number }) {
  const stroke = 2.5;
  const r = size / 2 - stroke;
  const circumference = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={palette.bloom}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={[circumference / 4, circumference]}
      />
    </Svg>
  );
}

/**
 * Something went wrong with what was just asked: a radish bang beside the
 * control that asked it. It says nothing on screen; a screen reader reads
 * the whole message, at once.
 */
export function ErrorPip({ message }: { message: string }) {
  return (
    <Reanimated.View
      entering={riseIn(8)}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={message}
      style={styles.errorPip}
    >
      <Glyph name="bang" size={18} color={palette.radish} />
    </Reanimated.View>
  );
}

/**
 * What the engine warned about, as honey pips: one each, each carrying its
 * warning for a screen reader.
 */
export function WarningPips({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <View style={styles.pips}>
      {warnings.map((warning, i) => (
        <View
          key={i}
          accessible
          accessibilityLabel={warning}
          style={styles.pip}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: palette.bloom },
  raised: { backgroundColor: palette.mocha },
  quiet: { backgroundColor: palette.espresso, transform: [{ scale: 0.94 }] },
  data: { ...typography.line },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.radishSoft,
  },
  around: { position: 'absolute' },
  haloRing: { borderWidth: 2, borderColor: palette.bloom },
  errorPip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.radishSoft,
  },
  pips: { flexDirection: 'row', gap: space.xs, justifyContent: 'center' },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.honey,
  },
});
