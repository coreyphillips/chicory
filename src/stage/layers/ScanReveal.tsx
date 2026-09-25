import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Scanner } from '../../components/Scanner';
import { colors, space } from '../../theme';

/**
 * The scan overlay (REDESIGN.md 2.3 and 5, Scan reveal): a disc that grows
 * out of the scan button at `origin`, in window coordinates, with the camera
 * inside it. `target` is where a code goes: a new Send from home, or the Send
 * already open. `onDetected` gets the code as read; `onCancel` closes it.
 *
 * On Android the camera is a SurfaceView, which ignores clipping, alpha and
 * transforms, so the camera only mounts once the disc has finished growing.
 *
 * This version is the existing Scanner, full screen, with no reveal. The
 * disc, the reticle and the detected and refused states come later and keep
 * this signature.
 */
export interface ScanRevealProps {
  origin: { x: number; y: number } | null;
  target: 'home' | 'send';
  onDetected: (value: string) => void;
  onCancel: () => void;
}

export function ScanReveal({ onDetected, onCancel }: ScanRevealProps) {
  // The canvas it covers runs under the system bars; the scanner keeps
  // clear of them.
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.layer,
        {
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
        },
      ]}
      accessibilityViewIsModal
    >
      <Scanner onDetected={onDetected} onCancel={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    padding: space.xl,
    backgroundColor: colors.background,
  },
});
