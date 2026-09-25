import React from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { Notice } from '../../components/ui';
import { copy } from '../../design/copy';
import { SettingsScreen } from '../../screens/Settings';
import type { WalletAdapter } from '../../services/wallet';
import type { Backup, CanvasSession } from '../../stage/Canvas';
import { STATUS_ROW } from '../../stage/layout';
import { CornerControl } from '../../stage/panes/CornerControl';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import { colors, space } from '../../theme';
import { BackupBanner } from '../shared/BackupBanner';

/**
 * Settings, the one scene that may keep words on screen (REDESIGN.md rule
 * 2): its close control, then everything it holds, with a backup still to
 * save and a failed refresh above.
 *
 * Its root carries the copy guard's marker, `scene-settings`, which lets
 * the guard skip everything under it. No other scene may render one.
 */
export function SettingsLayer({
  snapshot,
  client,
  session,
  backup,
}: {
  snapshot: WalletSnapshot;
  client: WalletAdapter;
  session: Pick<
    CanvasSession,
    | 'error'
    | 'switchError'
    | 'refreshing'
    | 'manualRefresh'
    | 'disconnect'
    | 'chooseWallet'
    | 'switchNetwork'
    | 'eraseDevice'
  >;
  backup: Backup | null;
}) {
  // Settings covers the whole canvas, under the system bars too, so it
  // starts below the status bar and ends above the home indicator. Starting
  // there, rather than padding down to it, keeps the slot's keyboard offset
  // measured from the top of the safe area.
  const { top, bottom } = useSafeAreaInsets();
  return (
    <View
      testID="scene-settings"
      style={[styles.layer, { marginTop: top, paddingBottom: bottom }]}
    >
      <View style={styles.bar}>
        <CornerControl home={false} />
      </View>
      <SceneSlot
        label={copy.settings.title}
        refreshControl={
          <RefreshControl
            refreshing={session.refreshing}
            onRefresh={session.manualRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.stack}>
          <BackupBanner backup={backup} />
          {session.error ? (
            <Notice kind="error" icon="alert">
              {copy.notice.refreshFailed(session.error)}
            </Notice>
          ) : null}
          <SettingsScreen
            snapshot={snapshot}
            client={client}
            switchError={session.switchError}
            onDisconnect={session.disconnect}
            onChooseWallet={session.chooseWallet}
            onRefresh={session.manualRefresh}
            onNetwork={session.switchNetwork}
            onErase={session.eraseDevice}
            backupPending={backup?.pending}
            onBackupSaved={backup?.onSaved}
          />
        </View>
      </SceneSlot>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  bar: {
    height: STATUS_ROW,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  stack: { gap: space.lg },
});
