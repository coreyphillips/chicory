import React from 'react';
import type { ComponentRef, Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { copy } from '../../design/copy';
import { palette } from '../../design/palette';
import { number, type as typography } from '../../theme';

const UNIT = 'sats';

/**
 * An amount of a payment at 48pt, with its unit, in `color`. It is one
 * element to a screen reader, read as the amount in sats, as the odometer
 * is. `ref` is that element, where a screen reader lands on a review.
 */
export function Amount({
  sats,
  color = palette.cream,
  ref,
}: {
  sats: number;
  color?: string;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  return (
    <View
      ref={ref}
      accessible
      accessibilityLabel={copy.amount.spoken(sats)}
      style={styles.row}
    >
      <Text style={[styles.value, { color }]} maxFontSizeMultiplier={1.2}>
        {number(sats)}
      </Text>
      <Text style={styles.unit}>{UNIT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  value: typography.amount,
  unit: { ...typography.heroUnit, color: palette.steam },
});
