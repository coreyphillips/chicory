import React, { useEffect } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { popIn, useShake } from '../../motion/effects';
import { useLoop, wave } from '../../motion/loops';
import { durations } from '../../motion/tokens';
import { usePaneActive } from '../../stage/panes/Pane';
import { CONTROL } from './Controls';
import { BANG, DrawnGlyph } from './DrawnGlyph';
import type { Stroke } from './DrawnGlyph';
import type { ResultVisual } from './model';
import { Orbit } from './Orbit';
import { useBloom } from './tone';

const SIZE = 120;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;

/** The pause bars pop in one after the other, then hold still. */
const PAUSE: Stroke[] = [
  { pop: { x: 9, y: 12 } },
  { pop: { x: 15, y: 12 }, delay: 60 },
];

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

interface FaceProps {
  visual: ResultVisual;
}

/**
 * Done: a cream disc, and an ink check drawing across it. At rest, for a
 * payment seen before, the check is simply there.
 */
function Disc({ visual }: FaceProps) {
  return (
    <View style={styles.disc}>
      {visual.resting ? (
        <Glyph name="check" size={56} color={palette.ink} />
      ) : (
        <DrawnGlyph
          name="check"
          size={56}
          color={palette.ink}
          strokes={[{ duration: durations.draw, delay: 120 }]}
        />
      )}
    </View>
  );
}

/** On its way: an orbit round the arrow that left, slate on a test network. */
function Moving() {
  const bloom = useBloom();
  return (
    <>
      <Ring color={palette.husk} />
      <Orbit size={SIZE} stroke={STROKE} color={bloom.tone} />
      <Glyph name="send" size={44} color={bloom.tone} />
    </>
  );
}

/**
 * Held: a steady honey ring, a halo breathing round it and the pause bars.
 * Nothing about it moves toward done, because nothing is known to be. While
 * the payment is still under way a honey orbit runs round the ring, the
 * motion that says money is moving (REDESIGN.md 3.5), and never rests.
 */
function Held({ visual }: FaceProps) {
  // Out and back once each 1600ms.
  const halo = useLoop(durations.halo, true);
  const haloStyle = useAnimatedStyle(() => {
    const out = wave(halo.get());
    return {
      opacity: 0.15 + 0.35 * out,
      transform: [{ scale: 1.04 + 0.08 * out }],
    };
  });
  return (
    <>
      <Reanimated.View style={[styles.layer, styles.halo, haloStyle]} />
      <Ring color={palette.honey} />
      {visual.orbit ? (
        <Orbit size={SIZE} stroke={STROKE} color={palette.honey} />
      ) : null}
      <DrawnGlyph
        name="pause"
        size={48}
        color={palette.honey}
        strokes={PAUSE}
      />
    </>
  );
}

/** Failed: a radish outline, and a bang drawing in. */
function Broken() {
  return (
    <>
      <Ring color={palette.radish} />
      <DrawnGlyph name="bang" size={48} color={palette.radish} strokes={BANG} />
    </>
  );
}

const FACES: Record<ResultVisual['shape'], (props: FaceProps) => ReactNode> = {
  disc: Disc,
  orbit: Moving,
  held: Held,
  broken: Broken,
};

/**
 * How a payment ended, as a 120pt mark grown from the control it was sent
 * with (REDESIGN.md 6, Send). A failure shakes as it lands. A mark at rest
 * (`visual.resting`), for a payment seen before, is simply there.
 *
 * The mark carries the words: `accessibilityLabel` for what happened,
 * `accessibilityValue` for the status, and `accessibilityHint` for the
 * engine's message, which a long press also shows through Whisper. With
 * `onPress` it is a control, such as a failure that returns to the payment.
 * `ref` is the mark, which the screen moves a screen reader to as it lands.
 */
export function ResultMark({
  visual,
  accessibilityLabel,
  accessibilityValue,
  accessibilityHint,
  onPress,
  ref,
}: {
  visual: ResultVisual;
  accessibilityLabel: string;
  accessibilityValue: string;
  accessibilityHint: string;
  onPress?: () => void;
  ref?: Ref<ComponentRef<typeof View>>;
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
        entering={visual.resting ? undefined : popIn(CONTROL / SIZE)}
        style={[styles.mark, refusal.style]}
      >
        <Pressable
          ref={ref}
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
          <Face visual={visual} />
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
