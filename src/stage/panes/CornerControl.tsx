import React from 'react';
import { IconButton } from '../../components/ui';
import { copy } from '../../design/copy';
import { space } from '../../theme';
import { useStage } from '../StageContext';
import { usePaneActive } from './Pane';

/**
 * The room the canvas's corner control takes at the right of the status row,
 * an icon button and the gap before it, which the row leaves free.
 */
export const CORNER_ROOM = 40 + space.xxs;

/**
 * The one control in the top right corner: Settings from home, and the way
 * back from everywhere else. It is disabled while a payment or a new wallet is
 * in flight, since back would abandon it. The canvas draws its own after Home,
 * at the top right, so a screen reader reaches it after the actions. Under
 * Settings the canvas's corner stays drawn but takes no touches; Settings has
 * its own.
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
