import React, { memo, useEffect } from 'react';
import Reanimated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { GLYPHS, GLYPH_LENGTHS, strokeFor } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { curves } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/** How one part of a glyph draws: over `duration`, `delay` after the mount. */
export interface Stroke {
  duration: number;
  delay?: number;
}

function Part({
  d,
  length,
  stroke,
  still,
}: {
  d: string;
  length: number;
  stroke: Stroke;
  still: boolean;
}) {
  const drawn = useSharedValue(still ? 1 : 0);
  const { duration, delay = 0 } = stroke;
  useEffect(() => {
    if (still) {
      drawn.set(1);
      return;
    }
    drawn.set(0);
    drawn.set(
      withDelay(delay, withTiming(1, { duration, easing: curves.enter })),
    );
  }, [still, duration, delay, drawn]);
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - drawn.get()),
  }));
  return (
    <AnimatedPath
      d={d}
      strokeDasharray={[length, length]}
      animatedProps={animatedProps}
    />
  );
}

/**
 * A glyph that draws itself in once, part by part, as a pen would
 * (REDESIGN.md 4, Animated glyphs): the check's one stroke, the cross's two,
 * the bang's line and then its dot. `strokes` times each part in turn, and
 * the last timing serves any part after it. SVG attributes animate here only
 * because the draw is one-off; nothing loops.
 *
 * Under Reduce Motion the glyph is simply there.
 */
export const DrawnGlyph = memo(function DrawnGlyphSvg({
  name,
  size,
  color,
  strokes,
}: {
  name: GlyphName;
  size: number;
  color: string;
  strokes: Stroke[];
}) {
  const { reduced } = useMotionPrefs();
  const lengths = GLYPH_LENGTHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {GLYPHS[name].map((part, index) => (
        <Part
          key={part.id}
          d={part.d}
          length={lengths[index]}
          stroke={strokes[Math.min(index, strokes.length - 1)]}
          still={reduced}
        />
      ))}
    </Svg>
  );
});
DrawnGlyph.displayName = 'DrawnGlyph';
