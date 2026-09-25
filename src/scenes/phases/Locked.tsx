import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Reanimated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type {
  EntryExitAnimationFunction,
  ExitAnimationsValues,
} from 'react-native-reanimated';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Bloom } from '../../glyphs/Bloom';
import type { BloomEvent } from '../../glyphs/Bloom';
import { Whisper } from '../../glyphs/Whisper';
import { useFocus } from '../../motion/focus';
import { curves, durations } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { BIOMETRY_NAMES, supportedBiometry } from '../../services/lock';
import type { BiometryKind } from '../../services/lock';
import { motionReduced } from '../../services/motion';
import { space } from '../../theme';
import { useRunning } from './parts';
import {
  BUD_OPEN,
  lockVisual,
  markFlight,
  markPoint,
  QUIET_MS,
  SIZES,
  unlockGlyph,
} from './visual';
import type { Point } from './visual';

/**
 * What someone sees when the app lock is on and they have not authenticated.
 *
 * Nothing about the wallet is shown here, no name, no network, no balance,
 * because the point of the lock is that the phone's holder has not proved they
 * are the owner yet. A closed bud breathes above the glyph for the way this
 * phone proves its owner, and the whole screen is the one control.
 *
 * While the system prompt is up the glyph draws itself over and over. A
 * refusal shakes the bud and turns the glyph radish until the next try, with
 * an error haptic and the reason spoken at once. Unlocking unfolds the bud and
 * flies it toward the wallet's mark as the wallet builds under it (R-1).
 */
export function LockScreen({
  prompting,
  error,
  onUnlock,
}: {
  prompting: boolean;
  error: string;
  onUnlock: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { reduced } = useMotionPrefs();
  const look = lockVisual({ prompting, error });
  // Unknown until the keychain answers, so no glyph shows that might be wrong.
  const [kind, setKind] = useState<BiometryKind | null | undefined>();
  useEffect(() => {
    let active = true;
    supportedBiometry().then(value => {
      if (active) setKind(value);
    });
    return () => {
      active = false;
    };
  }, []);

  // Each refusal plays once: the bud shakes, or under Reduce Motion a radish
  // tint stands in for the shake.
  const [refusal, setRefusal] = useState<BloomEvent | undefined>();
  useEffect(() => {
    if (!error) return;
    haptics.error();
    announce(error, { assertive: true });
    setRefusal(last => ({ kind: 'shake', key: (last?.key ?? 0) + 1 }));
  }, [error]);
  const tint = useSharedValue(0);
  useEffect(() => {
    if (!error || !reduced) return;
    tint.set(
      withSequence(
        withTiming(1, { duration: durations.tick }),
        withTiming(0, { duration: TINT_MS - durations.tick }),
      ),
    );
  }, [error, reduced, tint]);
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() * 0.14 }));

  // The screen leaves only when the lock opens, so leaving straight after a
  // prompt is an unlock and says so in the hand.
  const prompted = useRef(prompting);
  useEffect(() => {
    prompted.current = prompting;
  }, [prompting]);
  useEffect(
    () => () => {
      if (prompted.current) haptics.success();
    },
    [],
  );

  const focus = useFocus();
  const mark = markPoint(insets);
  const glyph = kind === undefined ? null : unlockGlyph(kind);
  return (
    <Reanimated.View entering={budIn()} style={styles.root}>
      <SafeAreaView style={styles.root} edges={EDGES}>
        <StatusBar barStyle="light-content" />
        <Pressable
          ref={focus}
          accessibilityRole="button"
          accessibilityLabel={copy.phase.unlock}
          accessibilityHint={
            kind === undefined
              ? undefined
              : copy.phase.unlockWith(BIOMETRY_NAMES[kind ?? 'passcode'])
          }
          accessibilityValue={{ text: look.value }}
          accessibilityState={{ disabled: prompting, busy: prompting }}
          disabled={prompting}
          onPress={onUnlock}
          style={styles.screen}
        >
          <View style={styles.bud}>
            <Reanimated.View style={[styles.tint, tintStyle]} />
            <Reanimated.View
              exiting={unfoldOut(mark, reduced)}
              style={styles.flower}
            >
              <Bloom size={SIZES.bud} open={1} />
            </Reanimated.View>
            <Reanimated.View exiting={budOut(reduced)}>
              <Bloom
                size={SIZES.bud}
                open={BUD_OPEN}
                mode="breathe"
                event={reduced ? undefined : refusal}
              />
            </Reanimated.View>
          </View>
          {glyph ? (
            <Whisper label={look.status}>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={look.status}
                style={styles.glyph}
              >
                <UnlockGlyph
                  name={glyph}
                  drawing={look.drawing}
                  refused={look.refused}
                />
              </View>
            </Whisper>
          ) : null}
        </Pressable>
      </SafeAreaView>
    </Reanimated.View>
  );
}

const EDGES = ['top', 'bottom', 'left', 'right'] as const;

/** How long the Reduce Motion tint that stands in for a shake lasts. */
const TINT_MS = 400;

const GLYPH_SIZE = 32;

/** One pass of the prompting draw, and the rest before the next. */
const DRAW_LOOP_MS = 900;
const DRAW_REST_MS = 360;

/**
 * The unlock glyph. While the system prompt is up it draws itself in from
 * the left, over and over, like a scan: a window slides across the glyph
 * while the glyph slides the other way inside it and so stays put. Only
 * transforms move, and the glyph's drawing never changes. A refusal lays the
 * same glyph in radish over it, flashing as it arrives and holding until the
 * next try.
 */
function UnlockGlyph({
  name,
  drawing,
  refused,
}: {
  name: GlyphName;
  drawing: boolean;
  refused: boolean;
}) {
  const { reduced } = useMotionPrefs();
  const running = useRunning(drawing);
  const drawn = useSharedValue(1);
  useEffect(() => {
    if (!running) {
      cancelAnimation(drawn);
      drawn.set(withTiming(1, { duration: durations.draw }));
      return;
    }
    drawn.set(
      withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(1, { duration: DRAW_LOOP_MS, easing: curves.standard }),
          withTiming(1, { duration: DRAW_REST_MS }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(drawn);
  }, [running, drawn]);
  const windowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -GLYPH_SIZE * (1 - drawn.get()) }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: GLYPH_SIZE * (1 - drawn.get()) }],
  }));

  const flash = useSharedValue(0);
  useEffect(() => {
    if (!refused) {
      flash.set(withTiming(0, { duration: durations.enter }));
      return;
    }
    flash.set(
      reduced
        ? 1
        : withSequence(
            withTiming(1, { duration: 60 }),
            withTiming(0.35, { duration: durations.tick }),
            withTiming(1, { duration: durations.tick }),
          ),
    );
  }, [refused, reduced, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  // Under Reduce Motion the prompt is a still state: the glyph dims.
  const waiting = reduced && drawing;

  return (
    <View style={[styles.glyphFrame, waiting && styles.waiting]}>
      <Reanimated.View style={[styles.window, windowStyle]}>
        <Reanimated.View style={glyphStyle}>
          <Glyph name={name} size={GLYPH_SIZE} color={palette.steam} />
        </Reanimated.View>
      </Reanimated.View>
      <Reanimated.View style={[styles.overlay, flashStyle]}>
        <Glyph name={name} size={GLYPH_SIZE} color={palette.radish} />
      </Reanimated.View>
    </View>
  );
}

/**
 * The lock check leaves the screen plain roast, and the bud surfaces after a
 * beat (REDESIGN.md 6), so a lock that opens at once never shows.
 */
function budIn(): EntryExitAnimationFunction {
  const reduced = motionReduced();
  return () => {
    'worklet';
    const config = {
      duration: reduced ? durations.crossfade : durations.draw,
      easing: curves.enter,
      reduceMotion: ReduceMotion.Never,
    };
    return {
      initialValues: { opacity: 0, transform: [{ scale: reduced ? 1 : 0.96 }] },
      animations: {
        opacity: withDelay(QUIET_MS, withTiming(1, config)),
        transform: [{ scale: withDelay(QUIET_MS, withTiming(1, config)) }],
      },
    };
  };
}

/** The bud gives way to the open flower beneath it. */
function budOut(reduced: boolean): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = {
      duration: reduced ? durations.crossfade : durations.enter,
      easing: curves.exit,
      reduceMotion: ReduceMotion.Never,
    };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scale: withTiming(reduced ? 1 : 1.08, config) }],
      },
    };
  };
}

/**
 * R-1's first beats: the flower, drawn unseen under the bud all along, opens
 * as the bud fades (0 to 500ms), then flies to the status row's mark and
 * shrinks to it (500 to 880ms) as the wallet builds beneath. Under Reduce
 * Motion it only crossfades in and out where it is.
 */
function unfoldOut(mark: Point, reduced: boolean): EntryExitAnimationFunction {
  return (values: ExitAnimationsValues) => {
    'worklet';
    if (reduced) {
      const fade = {
        duration: durations.crossfade,
        reduceMotion: ReduceMotion.Never,
      };
      return {
        initialValues: { opacity: 0 },
        animations: {
          opacity: withSequence(
            withTiming(1, fade),
            withDelay(UNFOLD_MS - durations.crossfade, withTiming(0, fade)),
          ),
        },
      };
    }
    const flight = markFlight(
      mark,
      {
        x: values.currentGlobalOriginX + values.currentWidth / 2,
        y: values.currentGlobalOriginY + values.currentHeight / 2,
      },
      SIZES.bud,
    );
    const open = { duration: UNFOLD_MS, easing: curves.enter };
    const fly = { duration: FLIGHT_MS, easing: curves.standard };
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0.7 }],
      },
      animations: {
        opacity: withSequence(
          withTiming(1, { duration: durations.enter, easing: curves.enter }),
          withDelay(
            UNFOLD_MS + FLIGHT_MS - durations.enter - durations.exit,
            withTiming(0, { duration: durations.exit, easing: curves.exit }),
          ),
        ),
        transform: [
          { translateX: withDelay(UNFOLD_MS, withTiming(flight.dx, fly)) },
          { translateY: withDelay(UNFOLD_MS, withTiming(flight.dy, fly)) },
          {
            scale: withSequence(
              withTiming(1, open),
              withTiming(flight.scale, fly),
            ),
          },
        ],
      },
    };
  };
}

const UNFOLD_MS = 500;
const FLIGHT_MS = 380;

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxl,
  },
  bud: {
    width: SIZES.bud,
    height: SIZES.bud,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flower: { ...StyleSheet.absoluteFill, opacity: 0 },
  tint: {
    ...StyleSheet.absoluteFill,
    borderRadius: SIZES.bud / 2,
    backgroundColor: palette.radish,
  },
  glyph: { padding: space.xs },
  glyphFrame: { width: GLYPH_SIZE, height: GLYPH_SIZE },
  window: { width: GLYPH_SIZE, height: GLYPH_SIZE, overflow: 'hidden' },
  waiting: { opacity: 0.6 },
  overlay: StyleSheet.absoluteFill,
});
