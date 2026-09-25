import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Activity } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { DetailScreen } from '../../screens/wallet/Detail';
import type { RegionProps } from '../../stage/Canvas';
import { DetailCard } from '../../stage/layers/DetailCard';
import { usePanes } from '../../stage/panes/Pane';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import type { Rect } from '../../stage/scene';
import { useStage } from '../../stage/StageContext';

/**
 * A payment's detail, in the slot the canvas keeps at the sheet's compact
 * stop. `item` is the live payment, so a status that changes while it is
 * open changes here too; `from` is the tapped row, for the card to grow out
 * of.
 */
export function DetailLayer({
  item,
  from,
  client,
  view,
  session,
}: RegionProps & {
  item: Activity;
  from: Rect | null;
}) {
  const { actions } = useStage();
  const panes = usePanes();
  const { top } = useSafeAreaInsets();
  return (
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
      </SceneSlot>
    </DetailCard>
  );
}
