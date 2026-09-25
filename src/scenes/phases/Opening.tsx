import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Body } from '../../components/ui';
import { colors, space } from '../../theme';

/** The restore at launch, before it is known whether there is a wallet to show. */
export function Opening() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} />
      <Body>Opening your wallet…</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    gap: space.md,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
