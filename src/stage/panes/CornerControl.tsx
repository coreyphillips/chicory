import React from 'react';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { IconButton } from '../../components/ui';
import { copy } from '../../design/copy';
import { spinIn, spinOut } from '../../motion/presets';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { space } from '../../theme';
import { useStage } from '../StageContext';
import { useCanvasPanes, usePaneActive } from './Pane';

/**
 * The room the canvas's corner control takes at the right of the status row,
 * an icon button and the gap before it, which the row leaves free.
 */
export const CORNER_ROOM = 40 + space.xxs;

/** How far the cog turns as Settings covers the canvas (REDESIGN.md 7, T6). */
export const COG_TURN = 120;

/**
 * The one control in the top right corner: Settings from home, and the way
 * back from everywhere else. It is disabled while a payment or a new wallet is
 * in flight, since back would abandon it. The canvas draws its own after Home,
 * at the top right, so a screen reader reaches it after the actions. Under
 * Settings the canvas's corner stays drawn but takes no touches; Settings has
 * its own.
 *
 * The cog spins out as the close spins in, and back (REDESIGN.md 7, T1), and
 * on the canvas the cog turns 120 degrees with Settings as it covers the
 * canvas, and back with it, the swipe that closes Settings included (T6).
 * Under Reduce Motion the two crossfade and the cog stays still.
 */
export function CornerControl({ home }: { home: boolean }) {
  const { state, actions } = useStage();
  const live = usePaneActive();
  const panes = useCanvasPanes();
  const { reduced } = useMotionPrefs();
  // Only the cog turns: Settings' own close comes in over it, upright.
  const turns = home && !reduced ? panes : null;
  const turn = useAnimatedStyle(() => {
    const cover = turns ? turns.cover.get() : 0;
    return { transform: [{ rotate: `${cover * COG_TURN}deg` }] };
  }, [turns]);
  return (
    <Reanimated.View style={turn}>
      <Reanimated.View
        key={home ? 'cog' : 'close'}
        entering={spinIn()}
        exiting={spinOut()}
      >
        {home ? (
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
        )}
      </Reanimated.View>
    </Reanimated.View>
  );
}
