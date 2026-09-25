import React from 'react';
import { copy } from '../../design/copy';
import { SendScreen } from '../../screens/Send';
import type { WalletAdapter } from '../../services/wallet';
import type { CanvasSession } from '../../stage/Canvas';
import { STATUS_ROW } from '../../stage/layout';
import { Arriving } from '../../stage/panes/Arriving';
import { SceneSlot } from '../../stage/panes/SceneSlot';
import { useStage } from '../../stage/StageContext';

/**
 * Send, in the top slot under the status row. `prefill` is the request a
 * scanned code or a tapped link brought with the scene, never sent without a
 * review; `scanning` opens it onto the camera.
 */
export function SendScene({
  prefill,
  scanning,
  client,
  stale,
  session,
}: {
  prefill: string;
  scanning: boolean;
  client: WalletAdapter;
  stale: boolean;
  session: Pick<CanvasSession, 'refresh'>;
}) {
  const { actions } = useStage();
  return (
    <Arriving>
      <SceneSlot label={copy.scene.send} offset={STATUS_ROW}>
        <SendScreen
          client={client}
          initialRequest={prefill}
          initialScanning={scanning}
          disabled={stale}
          onActivity={actions.openActivity}
          onRefresh={session.refresh}
          onBusy={actions.setBusy}
        />
      </SceneSlot>
    </Arriving>
  );
}
