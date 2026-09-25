import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WalletRecord } from '@beignet/wallet-core';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import { vesselVisual } from '../scenes/home/visual';
import type { VesselVisual } from '../scenes/home/visual';
import { radius, space } from '../theme';
import type { Unit } from '../theme';

/**
 * The pill under the hero: what can be spent now, solid, beside what is on
 * its way, as glass (REDESIGN.md 5, Vessel). `vesselVisual` decides how it
 * looks; this draws that.
 *
 * `unit` is for the tap that shows both figures for a moment, and `stale`
 * greys the solid part like the hero. A hidden balance hides the split too,
 * since the proportion alone says something.
 *
 * This version draws the pill still. The sheen, the bobbing seeds, the
 * channelize ripple and the tap come later and keep this signature.
 */
export interface VesselProps {
  availableSats: number;
  pendingSats: number;
  lfbw?: WalletRecord['lfbw'];
  unit: Unit;
  masked?: boolean;
  stale?: boolean;
}

/** Glass is a colour at 35%, as the arriving bloom glass is (REDESIGN.md 3.1). */
const FILLS: Record<VesselVisual['fill'], string> = {
  glass: palette.glass,
  seeds: palette.dust,
  honey: 'rgba(242,196,107,0.35)',
  radish: 'rgba(255,131,115,0.35)',
  sage: palette.sageWash,
};

const TONES: Record<VesselVisual['tone'], string> = {
  bloom: palette.bloom,
  honey: palette.honey,
  radish: palette.radish,
  sage: palette.sage,
  dust: palette.dust,
};

const HEIGHT = { hairline: 2, swollen: 8 };

export function Vessel({
  availableSats,
  pendingSats,
  lfbw,
  masked = false,
  stale = false,
}: VesselProps) {
  const visual = vesselVisual({ availableSats, pendingSats }, lfbw);
  const split = visual.weight === 'swollen' && !masked;
  return (
    <View
      accessible
      accessibilityLabel={
        masked
          ? copy.home.balanceHidden
          : copy.home.split(availableSats, pendingSats)
      }
      style={styles.row}
    >
      <View
        style={[
          styles.pill,
          { height: HEIGHT[split ? 'swollen' : 'hairline'] },
          !split && styles.hairline,
        ]}
      >
        {split ? (
          <>
            <View
              style={{
                flex: visual.solid,
                backgroundColor: stale ? palette.steam : palette.bloom,
              }}
            />
            <View
              style={{
                flex: 1 - visual.solid,
                backgroundColor: FILLS[visual.fill],
              }}
            />
          </>
        ) : null}
      </View>
      {visual.glyph && !masked ? (
        <View
          style={
            visual.retry && [styles.retry, { borderColor: TONES[visual.tone] }]
          }
        >
          <Glyph name={visual.glyph} size={16} color={TONES[visual.tone]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pill: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.round,
    overflow: 'hidden',
  },
  // Cream at 25%: there, but nothing to look at.
  hairline: { backgroundColor: 'rgba(243,236,223,0.25)' },
  retry: { borderWidth: 1.5, borderRadius: radius.round, padding: 2 },
});
