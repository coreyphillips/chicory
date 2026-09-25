import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Activity } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { DetailScreen } from '../../screens/wallet/Detail';
import type { RegionProps } from '../../stage/Canvas';
import { DetailCard, DetailReturn } from '../../stage/layers/DetailCard';
import { usePanes } from '../../stage/panes/Pane';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import type { Rect } from '../../stage/scene';
import { useStage } from '../../stage/StageContext';
import { measureRow } from '../activity/rowRects';
import { DETAIL_DROP } from '../activity/sheet';

/**
 * A payment's detail, in the slot the canvas keeps at the sheet's compact
 * stop. `item` is the live payment, so a status that changes while it is
 * open changes here too; `from` is the tapped row, for the card to grow out
 * of.
 *
 * The card folds back into its row when it closes onto the list it came
 * from, which stays at this stop. Back to home the list is on its way down,
 * so the card fades instead. While it is open a poll can move the row, so it
 * is found again whenever the history changes.
 */
export function DetailLayer({
  item,
  from,
  snapshot,
  client,
  view,
  session,
}: RegionProps & {
  item: Activity;
  from: Rect | null;
}) {
  const { state, actions } = useStage();
  const panes = usePanes();
  const { top, bottom } = useSafeAreaInsets();
  const below = state.stack[state.stack.length - 1]?.name;
  const returns = below === 'activity';
  const back = useSharedValue<Rect | null>(returns ? from : null);

  const opened = useRef(snapshot.activity);
  useEffect(() => {
    if (!returns) {
      back.set(null);
      return;
    }
    // The first answer is the rect the row was tapped at.
    if (opened.current === snapshot.activity) return;
    // The rows under a detail sit a little lower, and come back up as it
    // closes.
    const rect = measureRow(item.id);
    back.set(rect && { ...rect, y: rect.y - DETAIL_DROP });
  }, [returns, snapshot.activity, item.id, back]);

  return (
    <DetailReturn value={back}>
      <DetailCard item={item} from={from}>
        <SceneSlot label={copy.scene.detail} offset={panes.stops.compact - top}>
          <DetailScreen
            item={item}
            client={client}
            hidden={view.hidden}
            unit={view.unit}
            onRefresh={session.refresh}
            onBusy={actions.setBusy}
          />
          {/* The canvas runs under the system bars; the end of the detail
              stays clear of them. */}
          <View style={{ height: bottom }} />
        </SceneSlot>
      </DetailCard>
    </DetailReturn>
  );
}
