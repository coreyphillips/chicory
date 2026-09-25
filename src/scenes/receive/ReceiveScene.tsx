import React from 'react';
import { StyleSheet } from 'react-native';
import { copy } from '../../design/copy';
import { ReceiveScreen } from '../../screens/Receive';
import type { RegionProps } from '../../stage/Canvas';
import { STATUS_ROW } from '../../stage/layout';
import { Arriving } from '../../stage/panes/Arriving';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import { useStage } from '../../stage/StageContext';
import { colors } from '../../theme';

/**
 * Receive, in the top slot under the status row. `sceneKey` is the key of
 * the scene this Receive is, for anything in it that must tell whether it is
 * still the scene the stage shows, overlays aside (`useIsCurrentScene`).
 */
export function ReceiveScene({
  snapshot,
  client,
  stale,
  session,
}: RegionProps & { sceneKey: number }) {
  const { actions } = useStage();
  return (
    <Arriving style={styles.ground}>
      <SceneSlot label={copy.scene.receive} offset={STATUS_ROW}>
        <ReceiveScreen
          client={client}
          receivableSats={snapshot.balance.receivableSats}
          offlineReceivableSats={snapshot.balance.offlineReceivableSats}
          disabled={stale}
          onRefresh={session.refresh}
          onActivity={actions.openActivity}
          onBusy={actions.setBusy}
        />
      </SceneSlot>
    </Arriving>
  );
}

const styles = StyleSheet.create({
  // The balance stays drawn under the slot as the mini strip. Until the
  // scene leaves it a place (REDESIGN.md 7, T1), it draws its own ground.
  ground: { backgroundColor: colors.background },
});
