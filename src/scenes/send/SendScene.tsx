import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Activity } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { SendScreen } from '../../screens/Send';
import type { SendHandle } from '../../screens/Send';
import type { RegionProps } from '../../stage/Canvas';
import { MINI_STRIP, STATUS_ROW } from '../../stage/layout';
import { Arriving } from '../../stage/panes/Arriving';
import { usePaneActive } from '../../stage/panes/Pane';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import {
  useIsCurrentScene,
  useSceneBack,
  useStage,
} from '../../stage/StageContext';
import { useScanReceiver } from '../../stage/useScanReceiver';
import { isTestNetwork } from '../home/visual';
import type { Origin } from './RequestEntry';

/**
 * Send, in the top slot under the status row and the mini strip. `prefill`
 * is the request a scanned code or a tapped link brought with the scene,
 * never sent without a review.
 *
 * `sceneKey` is the key of the scene this Send is. A scan started from this
 * Send delivers its code here: the receiver is armed by this Send's own scan
 * button and stays registered, through `useIsCurrentScene(sceneKey)`, while
 * the overlay covers the pane (REDESIGN.md 2.3). Android back steps from the
 * review to compose before the stage closes the scene. A completed payment
 * goes home on its own, and a held one opens the payment it waits on.
 * Amounts follow the balance: hidden while it is, and in its unit. On a
 * test network slate stands in for bloom, as it does across the canvas.
 *
 * Send lays no ground of its own: the canvas's backdrop shows through, with
 * the tints the screen asks for, honey while an outcome is unknown and a
 * radish flash as a payment fails (REDESIGN.md 3.2, G3).
 */
export function SendScene({
  prefill,
  client,
  snapshot,
  stale,
  session,
  view,
  sceneKey,
}: RegionProps & {
  sceneKey: number;
  prefill: string;
}) {
  const { actions, state, dispatch } = useStage();
  const insets = useSafeAreaInsets();
  const screen = useRef<SendHandle>(null);
  const current = useIsCurrentScene(sceneKey);

  // Armed from the scan button until the overlay it opened closes, so only
  // a scan this Send asked for fills in its request.
  const [armed, setArmed] = useState(false);
  const scanOpen = state.overlay?.name === 'scan';
  useEffect(() => {
    if (armed && !scanOpen) setArmed(false);
  }, [armed, scanOpen]);
  const scan = useCallback(
    (origin: Origin | null) => {
      setArmed(true);
      actions.openScan(origin ?? undefined);
    },
    [actions],
  );
  useScanReceiver(
    useCallback((code: string) => screen.current?.receive(code), []),
    current && armed,
  );
  useSceneBack(() => screen.current?.back() ?? false, usePaneActive());

  // Send opens no payment's detail itself, so a held payment opens by way
  // of Activity, which does. Back from its detail then returns to the
  // history the payment sits in.
  const openHeld = useCallback(
    (item: Activity) => {
      dispatch({ type: 'open', scene: { name: 'activity' } });
      dispatch({ type: 'open', scene: { name: 'detail', item, from: null } });
    },
    [dispatch],
  );

  return (
    <Arriving>
      {/* The balance rests here as the mini strip, so Send leaves it
          clear. */}
      <View style={styles.mini} />
      <View style={styles.fill}>
        <SceneSlot label={copy.scene.send} offset={STATUS_ROW + MINI_STRIP}>
          <View style={[styles.fill, { paddingBottom: insets.bottom }]}>
            <SendScreen
              ref={screen}
              client={client}
              initialRequest={prefill}
              disabled={stale}
              balance={snapshot.balance}
              activity={snapshot.activity}
              onActivity={actions.openActivity}
              onRefresh={session.refresh}
              onBusy={actions.setBusy}
              onScan={scan}
              onDetail={openHeld}
              onDone={actions.home}
              masked={view.hidden}
              unit={view.unit}
              test={isTestNetwork(snapshot.wallet.network)}
            />
          </View>
        </SceneSlot>
      </View>
    </Arriving>
  );
}

const styles = StyleSheet.create({
  mini: { height: MINI_STRIP },
  fill: { flex: 1 },
});
