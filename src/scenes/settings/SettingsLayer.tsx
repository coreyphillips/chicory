import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../../design/copy';
import { palette } from '../../design/palette';
import { SettingsScreen } from '../../screens/Settings';
import type { RegionProps } from '../../stage/Canvas';
import { STATUS_ROW } from '../../stage/layout';
import { CornerControl } from '../../stage/panes/CornerControl';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import { space, type } from '../../theme';
import { Note, SettingsSurface } from './ui';

/**
 * Settings, the one scene that may keep words on screen (REDESIGN.md rule
 * 2): its title and close control, a failed refresh if there is one, then
 * everything it holds. A recovery phrase still to be saved is drawn by
 * Settings itself, as its leading section.
 *
 * Its root carries the copy guard's marker, `scene-settings`, which lets
 * the guard skip everything under it. No other scene may render one; only
 * the setup surfaces do (the new wallet sheet and first-run network setup),
 * and none of them is ever drawn beside Settings.
 */
export function SettingsLayer({
  snapshot,
  client,
  session,
  backup,
}: RegionProps) {
  // Settings covers the whole canvas, under the system bars too, so it
  // starts below the status bar and ends above the home indicator. Starting
  // there, rather than padding down to it, keeps the slot's keyboard offset
  // measured from the top of the safe area.
  const { top, bottom } = useSafeAreaInsets();
  return (
    <SettingsSurface
      style={[styles.layer, { marginTop: top, paddingBottom: bottom }]}
    >
      <View style={styles.bar}>
        {/* The slot below names the scene for a screen reader already. */}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.title}
        >
          {copy.settings.title}
        </Text>
        <CornerControl home={false} />
      </View>
      <SceneSlot
        label={copy.settings.title}
        refreshControl={
          <RefreshControl
            refreshing={session.refreshing}
            onRefresh={session.manualRefresh}
            tintColor={palette.bloom}
            colors={[palette.bloom]}
          />
        }
      >
        <View style={styles.stack}>
          {session.error ? (
            <Note tone="error">{copy.notice.refreshFailed(session.error)}</Note>
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
    </SettingsSurface>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  bar: {
    height: STATUS_ROW,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { ...type.title, color: palette.cream },
  stack: { gap: space.md },
});
