import React from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { sceneIn, sceneOut } from '../../motion/presets';

/**
 * A scene in the top slot. It arrives once the outgoing one is on its way and
 * leaves with a short fade, so for a moment both are drawn and neither pops.
 * The canvas keys it by scene, so each open arrives afresh.
 */
export function Arriving({ children }: PropsWithChildren) {
  return (
    <Reanimated.View
      entering={sceneIn()}
      exiting={sceneOut()}
      style={styles.flex}
    >
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
