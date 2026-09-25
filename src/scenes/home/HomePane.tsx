import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { HomeScreen } from '../../screens/wallet/Home';
import type { RegionProps } from '../../stage/Canvas';
import { canvasScene } from '../../stage/layout';
import { usePanes } from '../../stage/panes/Pane';
import { useStage } from '../../stage/StageContext';
import { useIncoming } from '../../stage/useIncoming';
import type { Point } from './ActionCircle';
import { useSafetySignal } from './signals';
import { isTestNetwork } from './visual';

/**
 * Everything the home pane shows under the status row: the balance, its
 * vessel and the actions. The canvas places the pane; `hero` and `bar` from
 * its panes move what is in it.
 *
 * It also holds what Home's safety states owe beyond the screen (REDESIGN.md
 * rule 4): an old balance, a recovery phrase still to save and a test
 * network are each felt, spoken and logged as they begin. A refresh that
 * fails is spoken too, politely, since the notice that once said so is now
 * the mark's value.
 *
 * Pulling the pane down refreshes. That is a pan of Home's own rather than a
 * scroll view's refresh control: it behaves the same on both platforms, and
 * the bloom it opens is drawn instead of a spinner. The mark in the status
 * row ratchets while the refresh runs.
 */
export function HomePane({
  snapshot,
  session,
  view,
  stale,
  backup,
}: RegionProps & {
  /** Home is the scene the canvas shows, whether or not Settings covers it. */
  home: boolean;
}) {
  const { state, actions } = useStage();
  const panes = usePanes();
  const { hidden, setHidden, unit, setUnit } = view;
  const network = snapshot.wallet.network;
  const arrived = useIncoming(snapshot);
  useSafetySignal(stale, copy.health.stale, haptics.warning);
  useSafetySignal(
    !!backup?.pending,
    copy.health.backupPending,
    haptics.warning,
  );
  useSafetySignal(
    isTestNetwork(network),
    copy.health.testNetwork(network),
    haptics.tick,
  );
  useEffect(() => {
    if (session.error) announce(copy.health.refreshFailedDetail(session.error));
  }, [session.error]);

  // The canvas runs to the bottom edge. The pane ends at the sheet, well above
  // it, unless the screen is so short that the sheet's home stop falls into
  // the bottom inset; then the actions keep clear of it.
  const { bottom } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const clear = Math.max(0, panes.stops.home - (height - bottom));

  // On its way to Send or Receive the hero rolls from the total to what can
  // be spent (REDESIGN.md 7, T1).
  const shown = canvasScene(state);
  const spending = shown === 'send' || shown === 'receive';

  // Send opens empty, whatever a control passes its handler.
  const openSend = useCallback(() => actions.openSend(), [actions]);
  const openScan = useCallback(
    (origin?: Point) => actions.openScan(origin),
    [actions],
  );
  const toggleUnit = useCallback(
    () => setUnit(value => (value === 'sats' ? 'btc' : 'sats')),
    [setUnit],
  );
  const toggleHidden = useCallback(
    () => setHidden(value => !value),
    [setHidden],
  );
  return (
    <View style={[styles.region, { paddingBottom: clear }]}>
      <HomeScreen
        snapshot={snapshot}
        hidden={hidden}
        unit={unit}
        stale={stale}
        heroSats={spending ? snapshot.balance.availableSats : undefined}
        progress={panes}
        launching={spending ? shown : 'none'}
        arrived={arrived}
        onSend={openSend}
        onReceive={actions.openReceive}
        onScan={openScan}
        onActivity={actions.openActivity}
        onDetail={actions.openDetail}
        onToggleUnit={toggleUnit}
        onToggleHidden={toggleHidden}
        onRefresh={session.manualRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({ region: { flex: 1 } });
