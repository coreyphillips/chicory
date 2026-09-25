import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Body } from '../../components/ui';
import type { useWalletSession } from '../../services/useWalletSession';
import { colors, space } from '../../theme';

type Session = ReturnType<typeof useWalletSession>;

/** The wait while a wallet closes, is erased, or hands over to another network. */
export function Transit({
  erasing,
  closing,
  switchTarget,
}: Pick<Session, 'erasing' | 'closing' | 'switchTarget'>) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} />
      <Body>
        {erasing
          ? 'Erasing your wallet from this phone…'
          : closing
          ? 'Closing your wallet…'
          : `Closing this wallet and opening ${
              switchTarget || 'the selected network'
            }…`}
      </Body>
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
