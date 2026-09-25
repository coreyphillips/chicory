import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import type { Network } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { palette } from '../../design/palette';
import { Bloom } from '../../glyphs/Bloom';
import { Whisper } from '../../glyphs/Whisper';
import { stagger } from '../../motion/presets';
import { curves, durations } from '../../motion/tokens';
import { motionReduced } from '../../services/motion';
import { radius, space, type as typography } from '../../theme';
import { GlyphButton, PhaseRoot, useRunning } from './parts';
import { bloomTone, SIZES, WAVE } from './visual';

/**
 * The wallet page before its first figures, drawn as the canvas will be:
 * the mark and the wallet's name, five husk dots breathing in a wave where
 * the balance will stand, the vessel's hairline, the actions as husk
 * outlines that cannot be used yet, and skeleton rows in the sheet. The lock
 * stays in its corner, since a wallet that never answers must still be
 * closable.
 */
export function OpeningWallet({
  name,
  network,
  busy,
  onDisconnect,
}: {
  name?: string;
  network: Network;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <PhaseRoot style={styles.canvas}>
      <View style={styles.status}>
        <View style={styles.identity}>
          <Bloom
            size={SIZES.mark}
            tone={bloomTone(network)}
            accessibilityLabel={name ? undefined : copy.phase.yourWallet}
          />
          {name ? (
            <Text numberOfLines={1} style={styles.name}>
              {name}
            </Text>
          ) : null}
        </View>
        <GlyphButton
          glyph="lock"
          size={SIZES.cog}
          label={copy.phase.lockDevice}
          disabled={busy}
          onPress={onDisconnect}
        />
      </View>
      <Wave label={copy.phase.opening} />
      <View style={styles.vessel} />
      <View
        style={styles.actions}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.action, styles.side]} />
        <View style={[styles.action, styles.centre]} />
        <View style={[styles.action, styles.side]} />
      </View>
      <View
        style={styles.sheet}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SKELETON_ROWS.map((width, row) => (
          <Reanimated.View
            key={width}
            entering={stagger(row)}
            style={styles.row}
          >
            <View style={styles.ring} />
            <View style={styles.lines}>
              <View style={[styles.bar, { width }]} />
              <View style={[styles.bar, styles.short]} />
            </View>
          </Reanimated.View>
        ))}
      </View>
    </PhaseRoot>
  );
}

/** The skeleton rows' first lines, each a little shorter than the last. */
const SKELETON_ROWS = ['60%', '48%', '36%'] as const;
const DOTS = Array.from({ length: WAVE.dots }, (_, i) => i);

/** Where a dot rests when the wave cannot run: a still, dim row of dots. */
const STILL = 0.4;

/**
 * Five husk dots breathing one after another, which is the whole of the
 * wait: a screen reader hears it as busy, and a long press whispers it. When
 * the figures arrive the dots shrink away as the digits roll in (R-3).
 */
function Wave({ label }: { label: string }) {
  const running = useRunning(true);
  return (
    <Whisper label={label}>
      <Reanimated.View
        exiting={shrinkOut()}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        style={styles.wave}
      >
        {DOTS.map(index => (
          <WaveDot key={index} index={index} running={running} />
        ))}
      </Reanimated.View>
    </Whisper>
  );
}

function shrinkOut(): EntryExitAnimationFunction {
  const reduced = motionReduced();
  return () => {
    'worklet';
    const config = {
      duration: reduced ? durations.crossfade : durations.exit,
      easing: curves.exit,
      reduceMotion: ReduceMotion.Never,
    };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scale: withTiming(reduced ? 1 : 0.3, config) }],
      },
    };
  };
}

function WaveDot({ index, running }: { index: number; running: boolean }) {
  const breath = useSharedValue(STILL);
  useEffect(() => {
    if (!running) {
      cancelAnimation(breath);
      breath.set(withTiming(STILL, { duration: durations.crossfade }));
      return;
    }
    breath.set(0);
    breath.set(
      withDelay(
        index * WAVE.step,
        withRepeat(
          withTiming(1, { duration: durations.pulse / 2, easing: curves.sine }),
          -1,
          true,
        ),
      ),
    );
    return () => cancelAnimation(breath);
  }, [running, index, breath]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * breath.get(),
    transform: [{ scale: 0.7 + 0.3 * breath.get() }],
  }));
  return <Reanimated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  canvas: { alignItems: 'stretch', justifyContent: 'flex-start' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  identity: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  name: { ...typography.micro, color: palette.steam, flexShrink: 1 },
  wave: {
    height: typography.hero.lineHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  dot: {
    width: WAVE.size,
    height: WAVE.size,
    borderRadius: WAVE.size / 2,
    backgroundColor: palette.husk,
  },
  vessel: {
    alignSelf: 'center',
    width: '60%',
    height: 2,
    borderRadius: radius.round,
    backgroundColor: palette.husk,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
  },
  action: {
    borderRadius: radius.round,
    borderWidth: 1.5,
    borderColor: palette.husk,
  },
  side: { width: SIZES.secondary, height: SIZES.secondary },
  centre: { width: 76, height: 76 },
  sheet: {
    gap: space.xs,
    paddingTop: space.lg,
    paddingHorizontal: space.md,
    borderTopLeftRadius: radius.pane,
    borderTopRightRadius: radius.pane,
    backgroundColor: palette.espresso,
  },
  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  ring: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: palette.husk,
  },
  lines: { flex: 1, gap: space.xs },
  bar: { height: 12, borderRadius: radius.sm, backgroundColor: palette.husk },
  short: { width: '28%', height: 8 },
});
