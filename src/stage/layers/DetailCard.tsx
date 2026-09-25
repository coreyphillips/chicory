import React, { createContext, useContext, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import type { Activity } from '@beignet/wallet-core';
import { palette } from '../../design/palette';
import {
  CARD_RADIUS,
  collapseTo,
  expandFrom,
} from '../../scenes/detail/motion';
import { sceneOut } from '../../motion/presets';
import type { Rect } from '../scene';

/**
 * Where a closing card goes back to: the row it came from, in window
 * coordinates, or null to fade. The detail's layer keeps it current and
 * gives it here; a card drawn without one simply fades out.
 */
export const DetailReturn = createContext<SharedValue<Rect | null> | null>(
  null,
);

/**
 * A payment's detail, as a card on the sheet at its compact stop (REDESIGN.md
 * 7, T4). The canvas places it and keys it by scene, so each open is a new
 * card; `children` are laid out from its top edge.
 *
 * `from` is the tapped row's rect in window coordinates, when it could be
 * measured: the card grows out of it, its corners opening from a row's to a
 * pane's over 380ms, while what it holds stays laid out at its final size
 * and is uncovered as it grows. Leaving, it folds back into the row it came
 * from while that row is where it was, and otherwise fades. Without a rect,
 * and under Reduce Motion, it only fades.
 */
export function DetailCard({
  from,
  children,
}: PropsWithChildren<{ item: Activity; from: Rect | null }>) {
  const back = useContext(DetailReturn);
  // Read once, as the card mounts: these only ever run at its two ends.
  const [entering] = useState(() => expandFrom(from));
  const [exiting] = useState(() => (back ? collapseTo(back) : sceneOut()));
  return (
    <Reanimated.View entering={entering} exiting={exiting} style={styles.card}>
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: palette.espresso,
    borderRadius: CARD_RADIUS,
  },
});
