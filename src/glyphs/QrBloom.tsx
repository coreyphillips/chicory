import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import { usePaneActive } from '../stage/panes/Pane';
import { radius } from '../theme';

/**
 * A payment request's QR, always ink on cream (REDESIGN.md 5, QrBloom).
 *
 * Only a request that can still be paid is drawn as a code. An expired
 * request, one whose address was reused and one already paid leave the card
 * without it, so nothing on screen can be scanned into a payment that would
 * go wrong. `onPress` enlarges it and `onLongPress` offers it to copy.
 *
 * This version swaps the states outright. The banded reveal, the dissolves
 * and the enlarge transition come later and keep this signature.
 */
export type QrState = 'shown' | 'expired' | 'paid' | 'scattered';

export interface QrBloomProps {
  value: string;
  size: number;
  state: QrState;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}

/** The quiet zone around the modules, which scanners need to find the code. */
const QUIET = 12;

export function QrBloom({
  value,
  size,
  state,
  onPress,
  onLongPress,
  accessibilityLabel,
}: QrBloomProps) {
  const live = usePaneActive();
  const pressable = state === 'shown' && (!!onPress || !!onLongPress);
  return (
    <Pressable
      accessibilityRole={pressable ? 'button' : 'image'}
      accessibilityLabel={accessibilityLabel}
      disabled={!pressable}
      onPress={live && pressable ? onPress : undefined}
      onLongPress={live && pressable ? onLongPress : undefined}
      style={[
        styles.card,
        { width: size + QUIET * 2, height: size + QUIET * 2 },
        (state === 'expired' || state === 'scattered') && styles.gone,
      ]}
    >
      {state === 'shown' ? (
        <QRCode
          value={value}
          size={size}
          backgroundColor={palette.cream}
          color={palette.ink}
        />
      ) : state === 'paid' ? (
        <Glyph name="check" size={size / 3} color={palette.ink} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.qr,
    backgroundColor: palette.cream,
  },
  gone: { opacity: 0.35 },
});
