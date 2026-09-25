import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { GLYPHS, strokeFor } from '../../design/glyphs';
import { useLoop } from './motion';

/** The clock's hands go round once in this long while it waits. */
const TURN_MS = 6000;

const [FACE, HANDS] = GLYPHS.clock;

/**
 * The clock of something that waits, such as money still arriving or a
 * funding not yet confirmed (REDESIGN.md 4, Animated glyphs): the face
 * holds still while the hands go round once every 6s. Only the view around
 * the hands turns, and it rests under Reduce Motion and while nobody can
 * see it.
 */
export const WaitingClock = memo(function WaitingClockView({
  size,
  color,
}: {
  size: number;
  color: string;
}) {
  const turn = useLoop(TURN_MS, true);
  const hands = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 360}deg` }],
  }));
  const svg = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: strokeFor(size),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg {...svg}>
        <Path d={FACE.d} />
      </Svg>
      <Reanimated.View style={[StyleSheet.absoluteFill, hands]}>
        <Svg {...svg}>
          <Path d={HANDS.d} />
        </Svg>
      </Reanimated.View>
    </View>
  );
});
WaitingClock.displayName = 'WaitingClock';
