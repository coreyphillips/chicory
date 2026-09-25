import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import Reanimated, {
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Bloom } from '../../glyphs/Bloom';
import { space } from '../../theme';
import { PETALS, pullPetals, pullProgress } from './motion';

/**
 * The bloom a pull on the home pane opens (REDESIGN.md 6, manual refresh).
 * It rises into the gap the pull makes above the balance, turning upright,
 * and its petals open a step at a time, so it is in full flower exactly
 * when letting go would refresh.
 *
 * The pull moves every frame; the petals only change as it crosses each
 * twelfth, so this bloom, and nothing else on Home, draws again at most a
 * dozen times a pull.
 */
export function PullBloom({
  pull,
  test,
}: {
  /** How far the finger has pulled, in points. */
  pull: SharedValue<number>;
  /** A test network, where the bloom is slate. */
  test: boolean;
}) {
  const [open, setOpen] = useState(0);
  useAnimatedReaction(
    () => pullPetals(pull.get()),
    (petals, before) => {
      if (petals !== before) scheduleOnRN(setOpen, petals);
    },
  );
  const style = useAnimatedStyle(() => {
    const reach = pullProgress(pull.get());
    return {
      opacity: reach,
      transform: [
        { scale: 0.5 + 0.5 * reach },
        { rotate: `${-90 * (1 - reach)}deg` },
      ],
    };
  });
  return (
    <Reanimated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.pull, style]}
    >
      <Bloom size={32} tone={test ? 'test' : 'live'} open={open / PETALS} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  pull: {
    position: 'absolute',
    top: space.xs,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
