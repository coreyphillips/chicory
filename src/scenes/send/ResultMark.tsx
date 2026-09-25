import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { durations } from '../../motion/tokens';
import { usePaneActive } from '../../stage/panes/Pane';
import { CONTROL } from './Controls';
import { DrawnGlyph } from './DrawnGlyph';
import type { ResultVisual } from './model';
import { popIn, useLoop, useShake } from './motion';
import { Orbit } from './Orbit';

const SIZE = 120;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;

/** A still ring round the mark, in `color`. */
function Ring({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} style={styles.layer}>
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
      />
    </Svg>
  );
}

/** Done: a cream disc, and an ink check drawing across it. */
function Disc() {
  return (
    <View style={styles.disc}>
      <DrawnGlyph
        name="check"
        size={56}
        color={palette.ink}
        strokes={[{ duration: durations.draw, delay: 120 }]}
      />
    </View>
  );
}

/** On its way: an orbit round the arrow that left. */
function Moving() {
  return (
    <>
      <Ring color={palette.husk} />
      <Orbit size={SIZE} stroke={STROKE} color={palette.bloom} />
      <Glyph name="send" size={44} color={palette.bloom} />
    </>
  );
}

/**
 * Held: a steady honey ring, a halo breathing round it and the pause bars.
 * Nothing about it moves toward done, because nothing is known to be.
 */
function Held() {
  // Out and back once each 1600ms.
  const halo = useLoop(durations.halo / 2, true, { mirror: true });
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + 0.35 * halo.get(),
    transform: [{ scale: 1.04 + 0.08 * halo.get() }],
  }));
  return (
    <>
      <Reanimated.View style={[styles.layer, styles.halo, haloStyle]} />
      <Ring color={palette.honey} />
      <DrawnGlyph
        name="pause"
        size={48}
        color={palette.honey}
        strokes={[{ duration: 220 }, { duration: 220, delay: 60 }]}
      />
    </>
  );
}

/** Failed: a radish outline, and a bang drawing in. */
function Broken() {
  return (
    <>
      <Ring color={palette.radish} />
      <DrawnGlyph
        name="bang"
        size={48}
        color={palette.radish}
        strokes={[{ duration: 200 }, { duration: durations.tick, delay: 200 }]}
      />
    </>
  );
}

const FACES = { disc: Disc, orbit: Moving, held: Held, broken: Broken };

/**
 * How a payment ended, as a 120pt mark grown from the control it was sent
 * with (REDESIGN.md 6, Send). A failure shakes as it lands.
 *
 * The mark carries the words: `accessibilityLabel` for what happened,
 * `accessibilityValue` for the status, and `accessibilityHint` for the
 * engine's message, which a long press also shows through Whisper. With
 * `onPress` it is a control, such as a failure that returns to the payment.
 */
export function ResultMark({
  visual,
  accessibilityLabel,
  accessibilityValue,
  accessibilityHint,
  onPress,
}: {
  visual: ResultVisual;
  accessibilityLabel: string;
  accessibilityValue: string;
  accessibilityHint: string;
  onPress?: () => void;
}) {
  const live = usePaneActive();
  const refusal = useShake();
  const { play } = refusal;
  const broken = visual.shape === 'broken';
  useEffect(() => {
    if (broken) play();
  }, [broken, play]);
  const Face = FACES[visual.shape];
  return (
    <Whisper label={accessibilityHint}>
      <Reanimated.View
        entering={popIn(CONTROL / SIZE)}
        style={[styles.mark, refusal.style]}
      >
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ text: accessibilityValue }}
          accessibilityHint={accessibilityHint}
          accessible
          onPress={
            live && onPress
              ? () => {
                  haptics.tick();
                  onPress();
                }
              : undefined
          }
          style={styles.face}
        >
          <Face />
          <Reanimated.View
            pointerEvents="none"
            style={[styles.layer, styles.tint, refusal.tint]}
          />
        </Pressable>
      </Reanimated.View>
    </Whisper>
  );
}

const styles = StyleSheet.create({
  mark: { width: SIZE, height: SIZE },
  face: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: { position: 'absolute', top: 0, left: 0, width: SIZE, height: SIZE },
  disc: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cream,
  },
  halo: { borderRadius: SIZE / 2, borderWidth: 2, borderColor: palette.honey },
  tint: { borderRadius: SIZE / 2, backgroundColor: palette.radishWash },
});
