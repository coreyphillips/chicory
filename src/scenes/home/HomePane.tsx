import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { HomeScreen } from '../../screens/wallet/Home';
import type { RegionProps } from '../../stage/Canvas';
import { HERO_MINI } from '../../stage/layout';
import { usePaneActive, usePanes } from '../../stage/panes/Pane';
import { useStage } from '../../stage/StageContext';
import { colors, space } from '../../theme';
import { BackupBanner } from '../shared/BackupBanner';
import { RefreshFailed } from './StatusRow';

/**
 * Everything the home pane shows under the status row: the balance and the
 * actions, with a pull to refresh, and above them what must not wait, a
 * backup still to save and a refresh that failed.
 *
 * The canvas places the pane; this moves what is in it with the panes'
 * `hero` and `bar`.
 */
export function HomePane({
  home,
  snapshot,
  session,
  view,
  stale,
  backup,
}: RegionProps & {
  /** Home is the scene the canvas shows, whether or not Settings covers it. */
  home: boolean;
}) {
  const { actions } = useStage();
  const panes = usePanes();
  const live = usePaneActive();
  const { hidden, unit, setUnit } = view;
  // Send opens empty, whatever a control passes its handler. The scan
  // overlay grows from the scan button; until Home measures it, from nowhere
  // in particular.
  const openSend = useCallback(() => actions.openSend(), [actions]);
  const openScan = useCallback(() => actions.openScan(), [actions]);
  const toggleUnit = useCallback(
    () => setUnit(value => (value === 'sats' ? 'btc' : 'sats')),
    [setUnit],
  );
  // Two values, each for its own part: the balance shrinks toward the mini
  // strip with `hero`, and only the action row fades with `bar`.
  const heroStyle = useAnimatedStyle(() => ({
    transform: [{ scale: HERO_MINI + (1 - HERO_MINI) * panes.hero.get() }],
  }));
  const barStyle = useAnimatedStyle(() => ({ opacity: panes.bar.get() }));
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={session.refreshing}
          onRefresh={session.manualRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* The backup brings controls of its own, so it only sits in a pane
          in use. Under Settings it shows there instead. */}
      {live ? <BackupBanner backup={backup} /> : null}
      {home ? <RefreshFailed error={session.error} /> : null}
      <HomeScreen
        snapshot={snapshot}
        hidden={hidden}
        unit={unit}
        stale={stale}
        onSend={openSend}
        onReceive={actions.openReceive}
        onScan={openScan}
        onActivity={actions.openActivity}
        onDetail={actions.openDetail}
        onToggleUnit={toggleUnit}
        heroStyle={heroStyle}
        barStyle={barStyle}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.lg,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
});
