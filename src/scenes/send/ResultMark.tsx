import React, { useEffect, useState } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { popIn, useShake } from '../../motion/effects';
import { useLoop, wave } from '../../motion/loops';
import { fadeOut } from '../../motion/presets';
import { curves, durations } from '../../motion/tokens';
import { motionReduced } from '../../services/motion';
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

/**
 * The orbit of a held payment still under way, on a track of its own inside
 * the honey ring, a clear gap in from it, in cream at part strength. Drawn
 * on the ring itself, honey on honey, it could not be seen, and a payment
 * still going out looked exactly like one whose outcome is unknown (P12,
 * 06d4).
 */
export const HELD_ORBIT = { stroke: 3, gap: 4, alpha: 0.6 };
/** Across the held orbit's outer edge, just inside the ring and its gap. */
const HELD_ORBIT_SIZE = SIZE - 2 * (STROKE + HELD_ORBIT.gap);

/**
 * How big the disc starts as the held ring resolves into it: the ring's
 * inside, so it grows out of the ring as the ring fades.
 */
export const RESOLVE_FROM = (SIZE - 2 * STROKE) / SIZE;

/**
 * How long the held ring takes to fade as the disc grows out of it: as long
 * as anything leaving takes, or half a crossfade under Reduce Motion, as
 * `fadeOut` would have faded it.
 */
export const resolveOutMs = () =>
  motionReduced() ? durations.crossfade / 2 : durations.exit;

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
 * the payment is still under way an orbit runs just inside the ring, in
 * cream against its honey, the motion that says money is moving (REDESIGN.md
 * 3.5), and never rests. An outcome that is unknown has none.
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
        <View style={[styles.layer, styles.centred]}>
          <View style={styles.inside}>
            <Orbit
              size={HELD_ORBIT_SIZE}
              stroke={HELD_ORBIT.stroke}
              color={palette.cream}
              alpha={HELD_ORBIT.alpha}
            />
          </View>
        </View>
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

/** One of the mark's faces, on a layer of its own. */
interface Layer {
  key: string;
  face: ReactNode;
  entering?: EntryExitAnimationFunction;
  exiting?: EntryExitAnimationFunction;
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
 * (`visual.resting`), for a payment seen before, is simply there. The held
 * ring, seen to complete (`visual.resolves`), fades as the disc grows out
 * of it and its check draws, rather than cutting to the disc in a frame.
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

  // The held ring on screen, as whether it orbits, for a resolve to grow out
  // of: it stays where it is, under the disc, while it fades, and then goes.
  // Left to fade as a layer leaving, it was drawn over the disc on iOS, its
  // pause and orbit showing through the done disc as it filled (P14, 05r).
  const [ring, setRing] = useState<{ orbit: boolean } | null>(() =>
    visual.shape === 'held' ? { orbit: !!visual.orbit } : null,
  );
  const resolving = !!visual.resolves && ring !== null;
  if (visual.shape === 'held') {
    if (ring?.orbit !== !!visual.orbit) setRing({ orbit: !!visual.orbit });
  } else if (!resolving && ring !== null) {
    setRing(null);
  }
  const gone = useSharedValue(0);
  useEffect(() => {
    if (!resolving) {
      gone.set(0);
      return;
    }
    const ms = resolveOutMs();
    gone.set(
      withTiming(1, {
        duration: ms,
        easing: curves.exit,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    const timer = setTimeout(() => setRing(null), ms);
    return () => clearTimeout(timer);
  }, [resolving, gone]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 1 - gone.get() }));

  // Each shape is a layer of its own, the one drawn last on top. Resolving,
  // the ring keeps its layer and the disc's comes after it.
  const layers: Layer[] = resolving
    ? [
        {
          key: 'held',
          face: <Held visual={{ ...visual, orbit: ring?.orbit }} />,
        },
        {
          key: visual.shape,
          face: <Face visual={visual} />,
          entering: popIn(RESOLVE_FROM),
        },
      ]
    : [
        {
          key: visual.shape,
          face: <Face visual={visual} />,
          entering: visual.resolves ? popIn(RESOLVE_FROM) : undefined,
          exiting: visual.shape === 'held' ? fadeOut() : undefined,
        },
      ];
  return (
    <Whisper label={accessibilityHint}>
      <Reanimated.View
        entering={visual.resting ? undefined : popIn(CONTROL / SIZE)}
        style={[styles.mark, refusal.style]}
      >
        <Pressable
          ref={ref}
          accessibilityRole={onPress ? 'button' : 'none'}
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
          {layers.map(layer => (
            <Reanimated.View
              key={layer.key}
              entering={layer.entering}
              exiting={layer.exiting}
              style={[
                styles.layer,
                styles.centred,
                layer.key === 'held' && ringStyle,
              ]}
            >
              {layer.face}
            </Reanimated.View>
          ))}
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
  centred: { alignItems: 'center', justifyContent: 'center' },
  inside: { width: HELD_ORBIT_SIZE, height: HELD_ORBIT_SIZE },
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
