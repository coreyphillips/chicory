import React from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { durations } from '../motion/tokens';
import { usePaneActive } from '../stage/panes/Pane';

/**
 * Hold to send (REDESIGN.md rule 5). A payment commits only after the circle
 * is held for 700ms, or 1000ms when the engine has `warning`s about it, so a
 * brush of the thumb never pays anyone. A plain tap does nothing, and there
 * is no `onPress` to call.
 *
 * A screen reader has no hold to give, so it gets one `activate` action that
 * commits at once: the confirmation is the deliberate double tap.
 *
 * This version commits on the long press. The ring that fills as it is held,
 * the ramp of haptics and the launch come later and keep this signature.
 */
export interface HoldButtonProps {
  accessibilityLabel: string;
  onCommit: () => void;
  warning?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** What sits in the circle instead of the send glyph. */
  children?: ReactNode;
}

const ACTIONS = [{ name: 'activate' as const }];

export function HoldButton({
  accessibilityLabel,
  onCommit,
  warning = false,
  disabled = false,
  busy = false,
  children,
}: HoldButtonProps) {
  const live = usePaneActive() && !disabled && !busy;
  const commit = () => {
    haptics.thud();
    onCommit();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={copy.send.holdHint}
      accessibilityState={{ disabled, busy }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={
        live
          ? (event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === 'activate') commit();
            }
          : undefined
      }
      onLongPress={live ? commit : undefined}
      delayLongPress={warning ? durations.holdWarning : durations.hold}
      disabled={disabled || busy}
      style={[
        styles.circle,
        warning && styles.warning,
        (disabled || busy) && styles.inactive,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.cream} />
      ) : (
        children ?? <Glyph name="send" size={32} color={palette.cream} />
      )}
    </Pressable>
  );
}

const SIZE = 88;

const styles = StyleSheet.create({
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 4,
    borderColor: palette.bloom,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bloomSoft,
  },
  warning: { borderColor: palette.honey, backgroundColor: palette.honeySoft },
  inactive: { opacity: 0.5 },
});
