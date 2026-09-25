import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  useLongPressGesture,
} from 'react-native-gesture-handler';
import Reanimated, { ReduceMotion, withTiming } from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { curves, durations } from '../motion/tokens';
import { motionReduced } from '../services/motion';
import { radius, space } from '../theme';

/**
 * Whisper (REDESIGN.md rule 3): long-pressing a status glyph, ring or
 * disabled control for 400ms shows its accessibility string in a small cocoa
 * pill for 2.4 seconds. It is the only text a person can summon outside
 * Settings, and it is the same string a screen reader already hears, so the
 * pill itself is hidden from one.
 *
 * `WhisperProvider` draws the pill above everything, once, near the top of
 * the app. `Whisper` wraps what can be asked about and is otherwise
 * transparent: outside a provider it only renders its children.
 *
 * This version shows the pill just above the touch, centred across the
 * screen. Anchoring it to its source comes later and keeps this signature.
 */
const DELAY_MS = 400;
const SHOWN_MS = 2400;
/** How far above the finger the pill sits, so the finger does not cover it. */
const ABOVE = 64;

type Show = (label: string, y: number) => void;

const WhisperContext = createContext<Show | null>(null);

interface Shown {
  label: string;
  y: number;
  key: number;
}

/** Fades in over 160ms while growing from .92; under Reduce Motion it only fades. */
function pillIn(): EntryExitAnimationFunction {
  const from = motionReduced() ? 1 : 0.92;
  return () => {
    'worklet';
    const config = {
      duration: durations.crossfade,
      easing: curves.standard,
      reduceMotion: ReduceMotion.Never,
    };
    return {
      initialValues: { opacity: 0, transform: [{ scale: from }] },
      animations: {
        opacity: withTiming(1, config),
        transform: [{ scale: withTiming(1, config) }],
      },
    };
  };
}

export function WhisperProvider({ children }: PropsWithChildren) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<Show>((label, y) => {
    haptics.tick();
    clearTimeout(timer.current);
    setShown(last => ({ label, y, key: (last?.key ?? 0) + 1 }));
    timer.current = setTimeout(() => setShown(null), SHOWN_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <WhisperContext.Provider value={show}>
      <View style={styles.root}>
        {children}
        {shown ? (
          <View
            style={[styles.layer, { top: Math.max(0, shown.y - ABOVE) }]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Reanimated.View
              key={shown.key}
              entering={pillIn()}
              style={styles.pill}
            >
              <Text style={styles.text}>{shown.label}</Text>
            </Reanimated.View>
          </View>
        ) : null}
      </View>
    </WhisperContext.Provider>
  );
}

export function Whisper({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  const show = useContext(WhisperContext);
  const hold = useLongPressGesture({
    minDuration: DELAY_MS,
    runOnJS: true,
    enabled: !!show,
    onActivate: event => show?.(label, event.absoluteY),
  });
  return (
    <GestureDetector gesture={hold}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.round,
    backgroundColor: palette.cocoa,
  },
  text: { fontSize: 13, lineHeight: 18, color: palette.cream },
});
