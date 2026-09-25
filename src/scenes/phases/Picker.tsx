import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WalletRecord } from '@beignet/wallet-core';
import { Eyebrow, LinkButton, Notice } from '../../components/ui';
import { NetworkSettings } from '../../screens/NetworkSettings';
import { WalletPicker } from '../../screens/Settings';
import type { useWalletSession } from '../../services/useWalletSession';
import { space } from '../../theme';

type Session = ReturnType<typeof useWalletSession>;

/** The device is open and no wallet is chosen yet: the saved ones, and how to add one. */
export function Picker({
  wallets,
  activeProfile,
  error,
  switchError,
  networkEditor,
  selecting,
  switchNetwork,
  setNetworkEditor,
  selectWallet,
  createDefaultWallet,
  disconnect,
  onCreateWallet,
}: Pick<
  Session,
  | 'activeProfile'
  | 'error'
  | 'switchError'
  | 'networkEditor'
  | 'selecting'
  | 'switchNetwork'
  | 'setNetworkEditor'
  | 'selectWallet'
  | 'createDefaultWallet'
  | 'disconnect'
> & {
  /** The saved wallets on the open network. */
  wallets: WalletRecord[];
  /** Opens the new wallet sheet, in restore mode when `restoring` is set. */
  onCreateWallet: (restoring: boolean) => void;
}) {
  return (
    <View style={styles.stack}>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Eyebrow>{activeProfile.network}</Eyebrow>
      {switchError ? (
        <Notice kind="error" icon="alert">
          {switchError}
        </Notice>
      ) : null}
      {networkEditor ? (
        <NetworkSettings
          initialNetwork={activeProfile.network}
          onApply={switchNetwork}
        />
      ) : null}
      <LinkButton
        label={networkEditor ? 'Hide network settings' : 'Network settings'}
        disabled={selecting}
        onPress={() => setNetworkEditor(!networkEditor)}
      />
      <WalletPicker
        wallets={wallets}
        busy={selecting}
        onSelect={wallet => {
          selectWallet(wallet).catch(() => {});
        }}
        onCreate={() => {
          // A network with no primary node cannot have a wallet made from
          // its defaults: the shared client refuses one without a node. Open
          // the form that asks for it instead of failing with a message
          // about a URI nobody was given a chance to type.
          if (!activeProfile.primaryUri.trim()) {
            onCreateWallet(false);
            return;
          }
          createDefaultWallet().catch(() => {});
        }}
      />
      <LinkButton
        label="Restore from recovery phrase"
        disabled={selecting}
        onPress={() => onCreateWallet(true)}
      />
      <LinkButton
        label="Lock device wallet"
        disabled={selecting}
        onPress={() => {
          disconnect();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: space.lg } });
