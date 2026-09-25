import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Network } from '@beignet/wallet-core';
import { Body, LinkButton, Skeleton, Title } from '../../components/ui';
import { space } from '../../theme';

/** The wallet page before its first figures: identity and a short wait, nothing to act on. */
export function OpeningWallet({
  name,
  network: _network,
  busy,
  onDisconnect,
}: {
  name?: string;
  network: Network;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Title>{name || 'Your wallet'}</Title>
      <Body>Opening…</Body>
      <View style={styles.skeletons}>
        <Skeleton width="55%" height={22} />
        <Skeleton width="80%" height={14} />
        <Skeleton width="40%" height={14} />
      </View>
      <LinkButton
        label="Lock device wallet"
        tone="muted"
        disabled={busy}
        onPress={onDisconnect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  skeletons: { gap: space.sm },
});
