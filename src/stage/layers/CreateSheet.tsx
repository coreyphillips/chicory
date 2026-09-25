import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WalletRecord } from '@beignet/wallet-core';
import { CreateWalletScreen } from '../../screens/Settings';
import { copy } from '../../design/copy';
import type { NetworkProfile } from '../../services/networks';
import type { WalletAdapter } from '../../services/wallet';
import { colors, space } from '../../theme';
import { CornerControl } from '../panes/CornerControl';
import { SceneSlot } from '../panes/SceneSlot';
import { useStage } from '../StageContext';

/**
 * A new or restored wallet, drawn over whatever the shell is showing: the
 * picker, the first-run screen or the wallet itself.
 */
export function CreateSheet({
  client,
  profile,
  restoring,
  onCreated,
}: {
  client: WalletAdapter;
  profile: NetworkProfile;
  restoring: boolean;
  onCreated: (wallet: WalletRecord) => Promise<void>;
}) {
  const { actions } = useStage();
  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.header}>
        <CornerControl home={false} />
      </View>
      <SceneSlot label={copy.scene.create}>
        <CreateWalletScreen
          client={client}
          profile={profile}
          initialRestoring={restoring}
          onCreated={onCreated}
          onBusy={actions.setBusy}
        />
      </SceneSlot>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
  header: {
    paddingHorizontal: space.xl,
    paddingVertical: space.xs,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
