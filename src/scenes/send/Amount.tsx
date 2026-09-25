import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '../../design/palette';
import { number, type as typography } from '../../theme';

const UNIT = 'sats';

/**
 * An amount of a payment at 48pt, with its unit, in `color`. It reads as
 * itself, the digits and the unit, and needs no other words.
 */
export function Amount({
  sats,
  color = palette.cream,
}: {
  sats: number;
  color?: string;
}) {
  return (
    <View style={styles.row}>
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
