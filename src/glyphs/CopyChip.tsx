import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import type { GlyphName } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { usePaneActive } from '../stage/panes/Pane';
import { radius, space, type as typography } from '../theme';

/**
 * A reference, request or address as a chip that copies it (REDESIGN.md 5,
 * CopyChip). The value shows in mono, in groups of four, shortened in the
 * middle; a long press shows all of it. A tap copies it and a screen reader
 * hears "{label} copied", which is all the confirmation there is: no toast.
 *
 * `label` names the value, as in "Transaction", and `glyph` swaps the copy
 * glyph for one that says what the value is.
 *
 * This version confirms with the announcement and a tick only. The copy to
 * check morph and the cream wash come later and keep this signature.
 */
export interface CopyChipProps {
  label: string;
  value: string;
  glyph?: GlyphName;
}

/** Characters kept at each end of a shortened value. */
const KEEP = 8;

const groups = (text: string) => text.match(/.{1,4}/g)?.join(' ') ?? '';

/** The value as shown: grouped in fours, and shortened when it is long. */
export function chipText(value: string, full = false): string {
  if (full || value.length <= KEEP * 2 + 4) return groups(value);
  return `${groups(value.slice(0, KEEP))} … ${groups(value.slice(-KEEP))}`;
}

export function CopyChip({ label, value, glyph = 'copy' }: CopyChipProps) {
  const live = usePaneActive();
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.detail.copy(label)}
      accessibilityValue={{ text: value }}
      onPress={
        live
          ? () => {
              haptics.tick();
              Clipboard.setString(value);
              announce(copy.detail.copied(label));
            }
          : undefined
      }
      onLongPress={live ? () => setExpanded(open => !open) : undefined}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text
        style={styles.value}
        numberOfLines={expanded ? undefined : 1}
        maxFontSizeMultiplier={1.4}
      >
        {chipText(value, expanded)}
      </Text>
      <Glyph name={glyph} size={16} color={palette.steam} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: palette.mocha,
  },
  pressed: { backgroundColor: palette.cocoa },
  value: { ...typography.mono, flexShrink: 1, color: palette.cream },
});
