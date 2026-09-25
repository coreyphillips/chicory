import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../../design/copy';
import { gradients } from '../../design/palette';
import { curves } from '../../motion/tokens';
import { ReceiveScreen } from '../../screens/Receive';
import type { RegionProps } from '../../stage/Canvas';
import { STATUS_ROW } from '../../stage/layout';
import { Arriving } from '../../stage/panes/Arriving';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import { useSceneBack, useStage } from '../../stage/StageContext';
import { colors } from '../../theme';
import { ReceiveHostContext } from './host';
import type { ReceiveHost, Tint } from './host';

/**
 * Receive, in the top slot under the status row. `sceneKey` is the key of
 * the scene this Receive is, for anything in it that must tell whether it is
 * still the scene the stage shows, overlays aside (`useIsCurrentScene`).
 *
 * The scene answers Android back for the screen and tints the ground behind
 * it: night while an offline receive is chosen (REDESIGN.md 3.2, G3). It runs
 * to the bottom edge, so it keeps its content clear of the system bar.
 */
export function ReceiveScene({
  snapshot,
  client,
  stale,
  session,
  view,
}: RegionProps & { sceneKey: number }) {
  const { actions } = useStage();
  const { bottom } = useSafeAreaInsets();
  const [tint, setTint] = useState<Tint>(null);
  const host = useMemo<ReceiveHost>(
    () => ({ useBack: useSceneBack, setTint }),
    [],
  );
  return (
    <Arriving style={styles.ground}>
      <Night on={tint === 'night'} />
      <ReceiveHostContext.Provider value={host}>
        <SceneSlot label={copy.scene.receive} offset={STATUS_ROW}>
          <View style={[styles.content, { paddingBottom: bottom }]}>
            <ReceiveScreen
              client={client}
              receivableSats={snapshot.balance.receivableSats}
              offlineReceivableSats={snapshot.balance.offlineReceivableSats}
              disabled={stale}
              hidden={view.hidden}
              unit={view.unit}
              onRefresh={session.refresh}
              onActivity={actions.openActivity}
              onBusy={actions.setBusy}
            />
          </View>
        </SceneSlot>
      </ReceiveHostContext.Provider>
    </Arriving>
  );
}

/** The night tint, crossfading in and out as the G3 tints do. */
function Night({ on }: { on: boolean }) {
  const level = useSharedValue(0);
  useEffect(() => {
    level.set(
      withTiming(on ? gradients.G3.night.opacity : 0, {
        duration: gradients.G3.crossfade,
        easing: curves.standard,
      }),
    );
    return () => cancelAnimation(level);
  }, [on, level]);
  const style = useAnimatedStyle(() => ({ opacity: level.get() }));
  return <Reanimated.View pointerEvents="none" style={[styles.night, style]} />;
}

const styles = StyleSheet.create({
  // The balance stays drawn under the slot as the mini strip. Until the
  // scene leaves it a place (REDESIGN.md 7, T1), it draws its own ground.
  ground: { backgroundColor: colors.background },
  night: {
    ...StyleSheet.absoluteFill,
    backgroundColor: gradients.G3.night.color,
  },
  content: { flexGrow: 1 },
});
