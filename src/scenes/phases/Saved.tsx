import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Network } from '@beignet/wallet-core';
import {
  Body,
  Button,
  LinkButton,
  Notice,
  Skeleton,
  Title,
} from '../../components/ui';
import { NetworkSettings } from '../../screens/NetworkSettings';
import { errorMessage } from '../../services/useWalletSession';
import type { useWalletSession } from '../../services/useWalletSession';
import { usePhaseBack } from '../../stage/StageContext';
import { space } from '../../theme';

type Session = ReturnType<typeof useWalletSession>;

/** The wallet saved on this device, when it could not be opened, and the ways back into it. */
export function Saved({
  name,
  network,
  error,
  switchError,
  connecting,
  networkEditor,
  openWallet,
  setError,
  setNetworkEditor,
  setDeviceVisible,
  switchNetwork,
}: Pick<
  Session,
  | 'error'
  | 'switchError'
  | 'connecting'
  | 'networkEditor'
  | 'openWallet'
  | 'setError'
  | 'setNetworkEditor'
  | 'setDeviceVisible'
  | 'switchNetwork'
> & {
  name?: string;
  network: Network;
}) {
  // Back closes the network editor before it leaves the app.
  usePhaseBack(() => {
    if (!networkEditor) return false;
    setNetworkEditor(false);
    return true;
  });
  return (
    <View style={styles.stack}>
      <Title>{name || 'Your wallet'}</Title>
      {error || switchError ? (
        <Body>
          This wallet is still on your phone. It could not be opened just now.
        </Body>
      ) : null}
      {switchError || error ? (
        <Notice kind="error" icon="alert">
          {switchError || error}
        </Notice>
      ) : (
        <View style={styles.skeletons}>
          <Skeleton width="55%" height={22} />
          <Skeleton width="80%" height={14} />
        </View>
      )}
      <Button
        label="Open device wallet"
        busy={connecting}
        onPress={() => {
          openWallet().catch(e => setError(errorMessage(e)));
        }}
      />
      <LinkButton
        label={
          networkEditor
            ? 'Hide network settings'
            : 'Change network or Bitcoin server'
        }
        disabled={connecting}
        onPress={() => setNetworkEditor(!networkEditor)}
      />
      {networkEditor ? (
        <NetworkSettings initialNetwork={network} onApply={switchNetwork} />
      ) : null}
      <LinkButton
        label="Device connection settings"
        tone="muted"
        disabled={connecting}
        onPress={() => setDeviceVisible(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  skeletons: { gap: space.sm },
});
