import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { riseIn } from '../../motion/presets';
import { overlap, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { usePaneActive } from '../../stage/panes/Pane';
import { type as typography } from '../../theme';
import type { KeyName } from './keys';

/** 1 to 9, then a blank, 0 and backspace (REDESIGN.md 5, Keypad). */
const ROWS: (KeyName | null)[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [null, '0', 'back'],
];

/**
 * The rows rise in after the scene has started to arrive, one after another
 * (REDESIGN.md 7, T1).
 */
const FIRST_ROW_MS = 120;
const ROW_STEP_MS = 30;

/** Holding backspace this long clears the whole amount. */
export const CLEAR_AFTER_MS = 450;

/**
 * The hold that clears, as an action a screen reader can take: TalkBack
 * offers it as double tap and hold, which it cannot pass through as a touch,
 * and VoiceOver lists it among the actions by its label.
 */
const CLEAR_ACTIONS = [
  { name: 'longpress' as const, label: copy.keypad.clear },
];

const KEY_HEIGHT = 60;

const Key = memo(function KeyView({
  name,
  live,
  onKey,
  onClear,
}: {
  name: KeyName;
  live: boolean;
  onKey: (key: KeyName) => void;
  onClear: () => void;
}) {
  const { reduced } = useMotionPrefs();
  const pressed = useSharedValue(0);
  // The disc springs in behind the key; under Reduce Motion it only fades.
  const disc = useAnimatedStyle(
    () => ({
      opacity: pressed.get(),
      transform: [{ scale: reduced ? 1 : 0.6 + 0.4 * pressed.get() }],
    }),
    [reduced],
  );
  const back = name === 'back';
  return (
    <Pressable
      accessibilityRole={back ? 'button' : 'keyboardkey'}
      accessibilityLabel={
        back ? copy.keypad.backspace : copy.keypad.digits[Number(name)]
      }
      accessibilityHint={back ? copy.keypad.backspaceHint : undefined}
      accessibilityState={{ disabled: !live }}
      disabled={!live}
      onPressIn={
        live
          ? () => {
              haptics.tick();
              pressed.set(withSpring(1, springs.snap));
            }
          : undefined
      }
      onPressOut={
        live ? () => pressed.set(withSpring(0, springs.snap)) : undefined
      }
      onPress={live ? () => onKey(name) : undefined}
      onLongPress={live && back ? onClear : undefined}
      accessibilityActions={back ? CLEAR_ACTIONS : undefined}
      onAccessibilityAction={
        live && back
          ? (event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === 'longpress') onClear();
            }
          : undefined
      }
      delayLongPress={CLEAR_AFTER_MS}
      style={styles.key}
    >
      <Reanimated.View style={[styles.disc, disc]} />
      {back ? (
        <Glyph name="backspace" size={26} color={palette.steam} />
      ) : (
        <Text style={styles.digit} maxFontSizeMultiplier={1.2}>
          {name}
        </Text>
      )}
    </Pressable>
  );
});

/**
 * The amount keypad, in place of the system keyboard (REDESIGN.md 10.3). It
 * only reports keys: `onKey` for a digit or backspace, `onClear` when
 * backspace is held. What a key does to the amount is the caller's.
 *
 * The container is labelled "Amount keypad", each digit with its digit and
 * backspace with its own words, which is how the suites find and press them.
 * Holding backspace clears the amount, and a screen reader clears it with
 * backspace's `longpress` action.
 * While `disabled`, or while its pane is out of use, no key takes a touch.
 */
export const Keypad = memo(function KeypadView({
  onKey,
  onClear,
  disabled = false,
}: {
  onKey: (key: KeyName) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const live = usePaneActive() && !disabled;
  return (
    <View
      accessibilityLabel={copy.keypad.label}
      accessibilityState={{ disabled }}
      style={styles.pad}
    >
      {ROWS.map((row, index) => (
        <Reanimated.View
          key={index}
          entering={riseIn(overlap.rise, FIRST_ROW_MS + index * ROW_STEP_MS)}
          style={styles.row}
        >
          {row.map(name =>
            name ? (
              <Key
                key={name}
                name={name}
                live={live}
                onKey={onKey}
                onClear={onClear}
              />
            ) : (
              <View key="blank" style={styles.key} />
            ),
          )}
        </Reanimated.View>
      ))}
    </View>
  );
});

Keypad.displayName = 'Keypad';

const styles = StyleSheet.create({
  pad: { alignSelf: 'stretch' },
  row: { flexDirection: 'row' },
  key: {
    flex: 1,
    height: KEY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    position: 'absolute',
    width: KEY_HEIGHT,
    height: KEY_HEIGHT,
    borderRadius: KEY_HEIGHT / 2,
    backgroundColor: palette.mocha,
  },
  digit: { ...typography.keypad, color: palette.cream },
});
