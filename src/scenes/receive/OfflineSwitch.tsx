import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { copy } from '../../design/copy';
import { GLYPHS, strokeFor } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';

const TRACK = { width: 60, height: 36 };
const KNOB = 28;
const INSET = (TRACK.height - KNOB) / 2;
const TRAVEL = TRACK.width - KNOB - INSET * 2;
const MOON = 18;

/**
 * Receiving offline, as a switch with the moon for its knob (REDESIGN.md 6,
 * Receive): off it is an outline on husk, and on it slides across and the
 * moon fills. A screen reader hears a switch with its state, and in its hint
 * what an offline receive is and what it can take.
 */
export function OfflineSwitch({
  on,
  cap,
  disabled,
  onToggle,
}: {
  on: boolean;
  cap?: number;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const live = usePaneActive();
  const { reduced } = useMotionPrefs();
  const slide = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    slide.set(reduced ? (on ? 1 : 0) : withSpring(on ? 1 : 0, springs.snap));
    return () => cancelAnimation(slide);
  }, [on, reduced, slide]);
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: TRAVEL * slide.get() }],
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={copy.receive.offline}
      accessibilityHint={
        on ? copy.receive.offlineOnHint(cap) : copy.receive.offlineOffHint
      }
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={
        live
          ? () => {
              haptics.tick();
              onToggle(!on);
            }
          : undefined
      }
      style={[styles.track, on && styles.on, disabled && styles.disabled]}
    >
      <Reanimated.View style={[styles.knob, on && styles.knobOn, knob]}>
        <Svg
          width={MOON}
          height={MOON}
          viewBox="0 0 24 24"
          stroke={on ? palette.ink : palette.steam}
          strokeWidth={strokeFor(MOON)}
          strokeLinejoin="round"
        >
          <Path d={GLYPHS.moon[0].d} fill={on ? palette.ink : 'none'} />
        </Svg>
      </Reanimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    ...TRACK,
    borderRadius: TRACK.height / 2,
    backgroundColor: palette.husk,
    padding: INSET,
  },
  on: { backgroundColor: palette.bloomNight },
  disabled: { opacity: 0.5 },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.mocha,
  },
  knobOn: { backgroundColor: palette.bloom },
});
