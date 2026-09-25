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
import { RecoveryPhrase } from '../../components/RecoveryPhrase';
import { NetworkSettings } from '../../screens/NetworkSettings';
import type { NetworkProfile } from '../../services/networks';
import { space } from '../../theme';

/**
 * The wallet is here, its network is not.
 *
 * Identity, the wallet's own saved setup diagnostic, a connection retry, a
 * setup retry, the network editor and the recovery phrase all stay reachable,
 * because this is exactly the screen where someone needs them.
 */
export function OfflineWallet({
  name,
  network,
  setupError,
  error,
  busy,
  networkEditor,
  onRetryConnection,
  onRetrySetup,
  onToggleNetwork,
  onApplyNetwork,
  onChooseWallet,
  onDisconnect,
  loadPhrase,
}: {
  name?: string;
  network: Network;
  setupError?: string;
  error: string;
  busy: boolean;
  networkEditor: boolean;
  onRetryConnection: () => void;
  onRetrySetup: () => void;
  onToggleNetwork: () => void;
  onApplyNetwork: (profile: NetworkProfile) => Promise<void>;
  onChooseWallet: () => void;
  onDisconnect: () => void;
  loadPhrase: () => Promise<string>;
}) {
  return (
    <View style={styles.stack}>
      <Title>{name || 'Your wallet'}</Title>
      <Body>
        {error
          ? 'Balances are unavailable until the connection is restored.'
          : 'Connecting…'}
      </Body>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : (
        <View style={styles.skeletons}>
          <Skeleton width="55%" height={22} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="40%" height={14} />
        </View>
      )}
      {setupError ? (
        <Notice kind="warning" icon="info">
          {setupError}
        </Notice>
      ) : null}
      <Button
        label="Retry connection"
        onPress={onRetryConnection}
        busy={busy}
      />
      <Button
        secondary
        label="Retry wallet setup"
        icon="refresh"
        disabled={busy}
        accessibilityHint="Asks the wallet to run its Lightning setup again."
        onPress={onRetrySetup}
      />
      <LinkButton
        label={
          networkEditor
            ? 'Hide network settings'
            : 'Change network or Bitcoin server'
        }
        disabled={busy}
        onPress={onToggleNetwork}
      />
      {networkEditor ? (
        <NetworkSettings initialNetwork={network} onApply={onApplyNetwork} />
      ) : null}
      <RecoveryPhrase loadPhrase={loadPhrase} />
      <LinkButton
        label="Choose another wallet"
        disabled={busy}
        onPress={onChooseWallet}
      />
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
