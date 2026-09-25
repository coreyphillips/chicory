import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  useAnimatedReaction,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { HomeScreen } from '../../screens/wallet/Home';
import type { RegionProps } from '../../stage/Canvas';
import { canvasScene } from '../../stage/layout';
import { useBuild } from '../../stage/panes/Build';
import { usePanes } from '../../stage/panes/Pane';
import { useStage } from '../../stage/StageContext';
import type { Point } from './ActionCircle';
import { rowBack } from './motion';
import type { Launch } from './motion';
import { useOverdue, useSafetySignal } from './signals';
import { isTestNetwork } from './visual';

/**
 * Everything the home pane shows under the status row: the balance, its
 * vessel and the actions. The canvas places the pane; `hero` and `bar` from
 * its panes move what is in it.
 *
 * It also holds what Home's safety states owe beyond the screen (REDESIGN.md
 * rule 4): an old balance, a recovery phrase still to save and a test
 * network are each felt, spoken and logged as they begin, and spoken once
 * focus has landed, together and in order of how much they matter. A
 * refresh that fails is spoken too, politely, since the notice that once
 * said so is now the mark's value.
 *
 * An old balance is spoken for by the scene in front: while Send or Receive
 * is open it is theirs to warn about, so Home stays quiet rather than warn
 * twice.
 *
 * A cached launch opens on old figures while the wallet starts. The dormant,
 * ratcheting mark says so, and the gate holds the actions. The live figures
 * are expected any moment, so the warning waits for them: once they are
 * overdue (LIVE_OVERDUE_MS) the old balance is warned about like any other.
 *
 * Pulling the pane down refreshes. That is a pan of Home's own rather than a
 * scroll view's refresh control: it behaves the same on both platforms, and
 * the status row's mark opens its petals with it, through the canvas's
 * `pull`, instead of a spinner. The mark ratchets while the refresh runs.
 */
export function HomePane({
  snapshot,
  session,
  view,
  stale,
  backup,
  arrived,
}: RegionProps & {
  /** Home is the scene the canvas shows, whether or not Settings covers it. */
  home: boolean;
}) {
  const { state, actions } = useStage();
  const panes = usePanes();
  const { hidden, setHidden, unit, setUnit } = view;
  const network = snapshot.wallet.network;

  // On its way to Send or Receive the hero rolls from the total to what can
  // be spent (REDESIGN.md 7, T1).
  const shown = canvasScene(state);
  const spending = shown === 'send' || shown === 'receive';
  // The circle that opened Send or Receive is kept while the canvas comes
  // home, so it travels back into the row rather than snapping there, and
  // the mini strip grows from the band it rested in. It is let go once the
  // row is back (`rowBack`): from then on the three circles move as one
  // row, as the sheet's drag moves them, and the strip heads for the status
  // row. Anywhere else it is let go at once.
  const [launched, setLaunched] = useState<Launch>('none');
  const launching: Launch = spending
    ? shown
    : shown === 'home'
    ? launched
    : 'none';
  if (launching !== launched) setLaunched(launching);
  const returning = shown === 'home' && launching !== 'none';
  useAnimatedReaction(
    () => panes.bar.get(),
    (bar, before) => {
      if (returning && rowBack(bar, before)) scheduleOnRN(setLaunched, 'none');
    },
    [returning, panes.bar],
  );

  // As the canvas builds in, the hero counts up from 0 on its beat (R-1):
  // it holds 0 until then, unseen, and rolls to the balance as it fades
  // in. A hidden balance, and one under Reduce Motion, simply shows.
  const { reduced } = useMotionPrefs();
  const build = useBuild();
  const [beats] = useState(() => build?.beats);
  const [counting, setCounting] = useState(
    () => !!build && !hidden && !reduced,
  );
  const counted = useSharedValue(0);
  useEffect(() => {
    if (!counting || !beats) return;
    counted.set(
      withDelay(
        beats.hero,
        withTiming(1, { duration: 0 }, done => {
          'worklet';
          if (done) scheduleOnRN(setCounting, false);
        }),
      ),
    );
  }, [counting, beats, counted]);

  const overdue = useOverdue(stale && session.connecting, LIVE_OVERDUE_MS);
  const aged = stale && (!session.connecting || overdue) && !spending;
  useSafetySignal(aged, copy.health.stale, haptics.warning, 'stale');
  useSafetySignal(
    !!backup?.pending,
    copy.health.backupPending,
    haptics.warning,
    'backup',
  );
  useSafetySignal(
    isTestNetwork(network),
    copy.health.testNetwork(network),
    haptics.tick,
    'testNetwork',
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
        heroSats={
          counting ? 0 : spending ? snapshot.balance.availableSats : undefined
        }
        build={beats}
        progress={panes}
        launching={launching}
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

/**
 * How long a cached launch waits for its first live read before the old
 * balance it shows is warned about: longer than a poll's interval, so a
 * start that is going well is never warned about.
 */
export const LIVE_OVERDUE_MS = 15_000;

const styles = StyleSheet.create({ region: { flex: 1 } });
