import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import type { GlyphName } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { durations } from '../../motion/tokens';
import { DrawnGlyph } from './DrawnGlyph';
import type { Stroke } from './DrawnGlyph';
import type { Failure } from './model';
import { useShake } from './motion';

/**
 * How each glyph an error shows draws in (REDESIGN.md 4, Animated glyphs):
 * the cross in two quick strokes, the bang's line and then its dot, the bolt
 * quickly, and anything else at the drawing pace.
 */
const STROKES: Partial<Record<GlyphName, Stroke[]>> = {
  cross: [{ duration: 140 }, { duration: 140, delay: 60 }],
  bang: [{ duration: 200 }, { duration: durations.tick, delay: 200 }],
  bolt: [{ duration: 240 }],
};
const DRAW: Stroke[] = [{ duration: durations.draw }];

/**
 * What the engine said no with (REDESIGN.md 6, Engine errors): its glyphs,
 * drawn in, in honey or radish, and a shake when it is radish. The engine's
 * own message is what a screen reader hears, as an alert, and what a long
 * press shows through Whisper.
 */
export function FailureMark({ failure }: { failure: Failure }) {
  const color = failure.tone === 'honey' ? palette.honey : palette.radish;
  const refusal = useShake();
  const { play } = refusal;
  useEffect(() => {
    if (failure.shake) play();
  }, [failure, play]);
  return (
    <Whisper label={failure.message}>
      <Reanimated.View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={failure.message}
        style={[styles.mark, refusal.style]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.tint, refusal.tint]}
        />
        <View style={styles.glyphs}>
          {failure.glyphs.map(glyph => (
            <DrawnGlyph
              key={glyph}
              name={glyph}
              size={22}
              color={color}
              strokes={STROKES[glyph] ?? DRAW}
            />
          ))}
        </View>
      </Reanimated.View>
    </Whisper>
  );
}

const styles = StyleSheet.create({
  mark: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tint: {
    ...StyleSheet.absoluteFill,
    borderRadius: 22,
    backgroundColor: palette.radishWash,
  },
  glyphs: { flexDirection: 'row', gap: 2 },
});
