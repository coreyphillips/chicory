import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RegionProps } from '../../stage/Canvas';
import { colors } from '../../theme';

export type BackdropProps = Pick<
  RegionProps,
  'snapshot' | 'stale' | 'backup' | 'session'
>;

/**
 * The ground of the top pane, drawn first so everything else sits on it. It
 * fills the pane edge to edge, under the status bar too, and takes no touches
 * and says nothing.
 *
 * It will carry the top pane's gradients and the one state tint at a time
 * (REDESIGN.md 3.2, G0 to G3), read from the wallet, its staleness, a backup
 * still to save and the session. Until then it is the plain background.
 */
export function Backdrop(_: BackdropProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.ground}
    />
  );
}

const styles = StyleSheet.create({
  ground: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
});
