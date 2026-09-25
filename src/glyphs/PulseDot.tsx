import React from 'react';
import { StyleSheet, View } from 'react-native';
import { copy } from '../design/copy';
import { palette } from '../design/palette';

/**
 * The connection, as a 7pt dot at the mark's lower right (REDESIGN.md 5,
 * PulseDot): sage when live, honey while reconnecting, a hollow radish ring
 * when the last refresh failed, and nothing at all when hidden. A new
 * `pingKey` is a poll that succeeded.
 *
 * This version holds still. The ping and the reconnecting pulse come later
 * and keep this signature.
 */
export type PulseState = 'live' | 'reconnecting' | 'failed' | 'hidden';

export interface PulseDotProps {
  state: PulseState;
  pingKey?: number;
}

const LABELS: Record<Exclude<PulseState, 'hidden'>, string> = {
  live: copy.health.fresh,
  reconnecting: copy.health.reconnecting,
  failed: copy.health.refreshFailed,
};

export function PulseDot({ state }: PulseDotProps) {
  if (state === 'hidden') return null;
  return (
    <View
      accessible
      accessibilityLabel={LABELS[state]}
      style={[
        styles.dot,
        state === 'live' && styles.live,
        state === 'reconnecting' && styles.reconnecting,
        state === 'failed' && styles.failed,
      ]}
    />
  );
}

const SIZE = 7;

const styles = StyleSheet.create({
  dot: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  live: { backgroundColor: palette.sage },
  reconnecting: { backgroundColor: palette.honey },
  failed: { borderWidth: 1.5, borderColor: palette.radish },
});
