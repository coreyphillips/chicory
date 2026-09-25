import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Notice } from '../../components/ui';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { ActivityScreen } from '../../screens/wallet/Activity';
import type { RegionProps } from '../../stage/Canvas';
import type { CanvasSceneName } from '../../stage/layout';
import { usePaneActive } from '../../stage/panes/Pane';
import { useStage } from '../../stage/StageContext';
import { HIT_SLOP, colors, radius, space } from '../../theme';
import { BackupBanner } from '../shared/BackupBanner';

/**
 * Everything on the sheet: the one Activity list, which keeps its instance,
 * scroll and search from Home to Activity. At home a grip above it opens
 * Activity; opened, a failed refresh and a backup still to save sit above
 * the list instead.
 */
export function SheetPane({
  shown,
  snapshot,
  session,
  view,
  backup,
}: RegionProps & {
  /** The scene the canvas shows. */
  shown: CanvasSceneName;
}) {
  const { actions } = useStage();
  const live = usePaneActive();
  const opened = shown === 'activity';
  return (
    <>
      {shown === 'home' ? (
        <SheetHandle />
      ) : opened && session.error ? (
        <View style={styles.notice}>
          <Notice kind="error" icon="alert">
            {copy.notice.refreshFailed(session.error)}
          </Notice>
        </View>
      ) : null}
      <ActivityScreen
        snapshot={snapshot}
        hidden={view.hidden}
        unit={view.unit}
        onDetail={actions.openDetail}
        filter={view.filter}
        onFilter={view.setFilter}
        query={view.query}
        onQuery={view.setQuery}
        refreshing={session.refreshing}
        onRefresh={session.manualRefresh}
        // The backup brings controls of its own, so it only sits in a pane
        // in use. Under Settings it shows there instead.
        banner={
          opened && live && backup?.pending ? (
            <BackupBanner backup={backup} />
          ) : undefined
        }
      />
    </>
  );
}

/** The grip at the top of the sheet at home, which opens Activity. */
function SheetHandle() {
  const { actions } = useStage();
  const live = usePaneActive();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.home.activity}
      hitSlop={HIT_SLOP}
      onPress={
        live
          ? () => {
              haptics.tick();
              actions.openActivity();
            }
          : undefined
      }
      style={styles.handle}
    >
      <View style={styles.grabber} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  handle: { alignItems: 'center', paddingVertical: space.sm },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.round,
    backgroundColor: colors.line,
  },
  notice: { paddingHorizontal: space.xl, paddingTop: space.md },
});
