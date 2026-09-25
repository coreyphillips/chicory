import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { riseIn, sceneOut } from '../../motion/presets';
import { number, radius, space, type as typography } from '../../theme';
import { useRefusal } from './controls';
import { Pulse } from './loops';
import type { AmountCue as Cue } from './model';

/**
 * What the amount means, as a glyph over it (REDESIGN.md 6, Receive): an
 * infinity while it is empty and the sender may choose; a sprout and a
 * blinking caret while an amount is needed for a channel made just in time;
 * the moon and the cap an offline receive can take, radish past it and dust
 * below the floor. It shakes when it refuses: when the cap is passed, and
 * when the engine says an amount is needed after all.
 *
 * It draws only glyphs and the cap, which is data; the words are its label.
 */
export function AmountCue({
  cue,
  cap,
  message,
}: {
  cue: Cue;
  cap?: number;
  /** What the engine said when it asked for an amount. */
  message?: string;
}) {
  const { play: refuse, shaken, tinted } = useRefusal();
  // A refusal is news once: passing the cap, which the finger feels too, or
  // an amount turning required.
  const refused = cue.over || cue.kind === 'required';
  const was = useRef(refused);
  useEffect(() => {
    if (refused && !was.current) {
      if (cue.over) haptics.rigid();
      refuse();
    }
    was.current = refused;
  }, [refused, cue.over, refuse]);

  let label: string | undefined;
  let hint: string | undefined;
  let face: React.ReactNode = null;
  if (cue.kind === 'offline') {
    const tone = cue.over
      ? palette.radish
      : cue.under
      ? palette.dust
      : palette.steam;
    label =
      cue.over && cap !== undefined
        ? copy.receive.offlineOver(cap)
        : copy.receive.offlineRange(cap);
    face = (
      <>
        <Glyph name="moon" size={18} color={palette.bloom} />
        {cap !== undefined ? (
          <>
            <Text
              style={[styles.cap, { color: tone }]}
              maxFontSizeMultiplier={1.4}
            >
              ≤
            </Text>
            <Text
              style={[styles.cap, { color: tone }]}
              maxFontSizeMultiplier={1.4}
            >
              {number(cap)}
            </Text>
          </>
        ) : null}
      </>
    );
  } else if (cue.kind === 'required') {
    label = copy.amount.required;
    hint = copy.receive.enterAmount;
    face = (
      <>
        {cue.empty ? (
          <Pulse period={1000} low={0}>
            <View style={styles.caret} />
          </Pulse>
        ) : null}
        <Glyph name="sprout" size={20} color={palette.bloom} />
      </>
    );
  } else if (cue.empty) {
    label = copy.amount.any;
    face = <Glyph name="infinity" size={32} color={palette.bloom} />;
  }
  return (
    <Reanimated.View style={[styles.strip, shaken]}>
      {face ? (
        <Reanimated.View
          key={cue.kind}
          entering={riseIn(8)}
          exiting={sceneOut()}
          accessible
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityValue={message ? { text: message } : undefined}
          style={styles.face}
        >
          <Reanimated.View pointerEvents="none" style={[styles.tint, tinted]} />
          {face}
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  strip: { height: 40, alignItems: 'center', justifyContent: 'center' },
  face: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    minHeight: 32,
  },
  tint: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.round,
    backgroundColor: palette.radishSoft,
  },
  caret: {
    width: 2,
    height: 24,
    borderRadius: 1,
    backgroundColor: palette.bloom,
  },
  cap: { ...typography.meta, fontSize: 13 },
});
