import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { Bloom } from '../../glyphs/Bloom';
import type { BloomEvent } from '../../glyphs/Bloom';
import { PulseDot } from '../../glyphs/PulseDot';
import { Whisper } from '../../glyphs/Whisper';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import type { RegionProps } from '../../stage/Canvas';
import type { CanvasSceneName } from '../../stage/layout';
import { STATUS_ROW } from '../../stage/layout';
import { CORNER_ROOM } from '../../stage/panes/CornerControl';
import { usePaneActive } from '../../stage/panes/Pane';
import { useStage } from '../../stage/StageContext';
import { useIncoming } from '../../stage/useIncoming';
import { HIT_SLOP, space } from '../../theme';
import { BackupTile } from './BackupTile';
import { GestureRoot } from './GestureRoot';
import { useAppActive } from './useAppActive';
import { healthText, markVisual } from './visual';

/** The mark's size, and the touch target around it. */
const MARK = 28;
const TARGET = 48;

/**
 * The status row, which every scene on the canvas keeps: the bloom mark,
 * which is how the wallet is, and at home the shield tile of a recovery
 * phrase still to save. The canvas runs under the system status bar, so the
 * row starts below it.
 *
 * The mark is the refresh control. Its petals open with the wallet's
 * lightning setup, ratchet while a refresh runs and go dormant while the
 * balance is old; its PulseDot is the connection. What it all means is its
 * accessibility value, and a long press whispers it. The network shows as a
 * colour, slate off mainnet with a flask beside the mark, and the wallet's
 * name is left to Settings.
 *
 * The corner control at its right is the canvas's own, drawn after Home so a
 * screen reader reaches it in order (REDESIGN.md 9); the row leaves it room.
 */
export function StatusRow({
  shown,
  snapshot,
  session,
  stale,
  backup,
}: RegionProps & {
  /** The scene the canvas shows. */
  shown: CanvasSceneName;
}) {
  const live = usePaneActive();
  const { actions } = useStage();
  const { top } = useSafeAreaInsets();
  const { reduced } = useMotionPrefs();
  const awake = useAppActive();
  const refreshing = session.refreshing || session.connecting;
  const health = {
    snapshot,
    stale,
    refreshing: session.refreshing,
    connecting: session.connecting,
    error: session.error,
    backupPending: !!backup?.pending,
  };
  const mark = markVisual(health);
  const value = healthText(health);
  const arrived = useIncoming(snapshot);
  const event = useMarkEvent(mark.droop, arrived);
  const refresh = useCallback(() => {
    haptics.tick();
    session.manualRefresh();
  }, [session]);
  return (
    <View
      style={[styles.status, { paddingTop: top, height: top + STATUS_ROW }]}
    >
      <GestureRoot style={styles.identity}>
        <Whisper label={value}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.home.refresh}
            accessibilityValue={{ text: value }}
            accessibilityState={{ disabled: refreshing, busy: refreshing }}
            disabled={refreshing}
            hitSlop={HIT_SLOP}
            onPress={live ? refresh : undefined}
            style={styles.mark}
          >
            <Bloom
              size={MARK}
              detail="mark"
              mode={mark.mode}
              open={mark.open}
              tone={mark.tone}
              halo={mark.halo}
              event={event}
            />
            {/* The dot is part of the mark: its words are the mark's. */}
            <View
              style={styles.dot}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <PulseDot state={mark.pulse} pingKey={snapshot.updatedAt} />
            </View>
            {mark.droop ? <View style={styles.pip} /> : null}
          </Pressable>
        </Whisper>
        {mark.flask ? (
          <Glyph name="flask" size={14} color={palette.slate} />
        ) : null}
        {/* The tile only leads anywhere from home; elsewhere the halo stays. */}
        {backup?.pending && shown === 'home' ? (
          <BackupTile
            running={live && awake && !reduced}
            onOpen={live ? actions.openSettings : undefined}
          />
        ) : null}
      </GestureRoot>
    </View>
  );
}

/**
 * The one-off the mark plays: it wilts when setup stops short, and bursts
 * when money arrives, unless it is drooping.
 */
function useMarkEvent(droop: boolean, arrived: number): BloomEvent | undefined {
  const [event, setEvent] = useState<BloomEvent>();
  const last = useRef({ droop: false, arrived });
  useEffect(() => {
    const before = last.current;
    last.current = { droop, arrived };
    const kind =
      droop && !before.droop
        ? 'wilt'
        : arrived !== before.arrived && !droop
        ? 'burst'
        : null;
    if (kind) setEvent(prior => ({ kind, key: (prior?.key ?? 0) + 1 }));
  }, [droop, arrived]);
  return event;
}

const styles = StyleSheet.create({
  status: {
    paddingLeft: space.xl - (TARGET - MARK) / 2,
    paddingRight: space.xl + CORNER_ROOM,
    flexDirection: 'row',
    alignItems: 'center',
  },
  identity: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  mark: {
    width: TARGET,
    height: TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The PulseDot at the mark's lower right, and the setup pip at its upper
  // right, each just inside the petals' reach.
  dot: {
    position: 'absolute',
    right: (TARGET - MARK) / 2 - 1,
    bottom: (TARGET - MARK) / 2 - 1,
  },
  pip: {
    position: 'absolute',
    top: (TARGET - MARK) / 2 - 1,
    right: (TARGET - MARK) / 2 - 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.honey,
  },
});
