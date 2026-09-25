import React from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import type { Activity } from '@beignet/wallet-core';
import { sceneIn, sceneOut } from '../../motion/presets';
import { colors, radius } from '../../theme';
import type { Rect } from '../scene';

/**
 * A payment's detail, as a card on the sheet at its compact stop (REDESIGN.md
 * 7, T4). The canvas places it and keys it by scene, so each open is a new
 * card; `children` are laid out from its top edge.
 *
 * `from` is the tapped row's rect in window coordinates, when it could be
 * measured, for the card to grow out of; without one the card fades in. This
 * version always fades: the ring and amount clones that fly to the header
 * come later, and use `item` to draw them.
 */
export function DetailCard({
  children,
}: PropsWithChildren<{ item: Activity; from: Rect | null }>) {
  return (
    <Reanimated.View
      entering={sceneIn()}
      exiting={sceneOut()}
      style={styles.card}
    >
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.pane,
    borderTopRightRadius: radius.pane,
  },
});
