import React from 'react';
import { IconButton } from '../../components/ui';
import { copy } from '../../design/copy';
import { useStage } from '../StageContext';
import { usePaneActive } from './Pane';

/**
 * The one control in the top right corner: Settings from home, and the way
 * back from everywhere else. It is disabled while a payment or a new wallet is
 * in flight, since back would abandon it. Under Settings the canvas's own
 * corner stays drawn but takes no touches; Settings has its own.
 */
export function CornerControl({ home }: { home: boolean }) {
  const { state, actions } = useStage();
  const live = usePaneActive();
  return home ? (
    <IconButton
      name="cog"
      tone="plain"
      accessibilityLabel={copy.home.settings}
      onPress={live ? actions.openSettings : undefined}
    />
  ) : (
    <IconButton
      name="close"
      tone="plain"
      accessibilityLabel={copy.home.close}
      disabled={state.busy}
      onPress={live ? actions.back : undefined}
    />
  );
}
