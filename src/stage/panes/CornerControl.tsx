import React from 'react';
import { IconButton } from '../../components/ui';
import { copy } from '../../design/copy';
import { useStage } from '../StageContext';

/**
 * The one control in the top right corner: Settings from home, and the way
 * back from everywhere else. It is disabled while a payment or a new wallet is
 * in flight, since back would abandon it.
 */
export function CornerControl({ home }: { home: boolean }) {
  const { state, actions } = useStage();
  return home ? (
    <IconButton
      name="cog"
      tone="plain"
      accessibilityLabel={copy.home.settings}
      onPress={actions.openSettings}
    />
  ) : (
    <IconButton
      name="close"
      tone="plain"
      accessibilityLabel={copy.home.close}
      disabled={state.busy}
      onPress={actions.back}
    />
  );
}
