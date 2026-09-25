import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import type { RingVisual } from '../scenes/activity/visual';
import { radius } from '../theme';

export type { RingVisual } from '../scenes/activity/visual';

/**
 * A payment's state as a ring around its glyph (REDESIGN.md 5, StatusRing),
 * at 40pt in a row, 96pt in a detail header and 120pt for a result.
 * `ringVisual` decides what it shows; this draws it. The ring is decoration:
 * the row or control around it carries the words.
 *
 * This version draws each pattern still. The orbit, the slow dash turn, the
 * halo loop and the transitions between states come later and keep this
 * signature.
 */
export interface StatusRingProps {
  size: 40 | 96 | 120;
  visual: RingVisual;
}

const TONES: Record<RingVisual['tone'], string> = {
  bloom: palette.bloom,
  sage: palette.sage,
  honey: palette.honey,
  radish: palette.radish,
  dust: palette.dust,
  steam: palette.steam,
};

const STROKE = { 40: 2.5, 96: 4, 120: 5 };
const GLYPH = { 40: 18, 96: 40, 120: 48 };
/** How much of the ring an orbit's arc covers before any progress. */
const ORBIT = 0.25;
/** An open ring: the status could not be read. */
const GAP = 0.82;

export function StatusRing({ size, visual }: StatusRingProps) {
  const stroke = STROKE[size];
  const c = size / 2;
  // Room inside the box for the held halo, a stroke further out.
  const r = c - stroke * 2;
  const color = TONES[visual.tone];
  const circle = {
    cx: c,
    cy: c,
    r,
    fill: 'none',
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
  };
  // Arcs start at twelve o'clock and run clockwise.
  const around = 2 * Math.PI * r;
  const arc = (share: number) => ({
    ...circle,
    strokeDasharray: [around * share, around],
    transform: `rotate(-90 ${c} ${c})`,
  });
  const dashes = [stroke * 1.2, stroke * 2];

  let ring: React.ReactNode;
  switch (visual.pattern) {
    case 'orbit':
      ring = <Circle {...arc(visual.progress || ORBIT)} />;
      break;
    case 'dashed':
      ring = <Circle {...circle} strokeDasharray={dashes} />;
      break;
    case 'split':
      ring = (
        <>
          <Circle {...circle} stroke={palette.honey} strokeDasharray={dashes} />
          <Circle {...arc(visual.split ?? 0)} />
        </>
      );
      break;
    case 'held':
      ring = (
        <>
          <Circle {...circle} r={r + stroke} strokeOpacity={0.3} />
          <Circle {...circle} />
        </>
      );
      break;
    case 'gap':
      ring = <Circle {...arc(GAP)} />;
      break;
    case 'expired':
      ring = <Circle {...circle} strokeDasharray={dashes} opacity={0.55} />;
      break;
    case 'full':
      ring = <Circle {...circle} />;
  }

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size}>
        <Circle {...circle} stroke={palette.husk} />
        {ring}
      </Svg>
      <View style={styles.center}>
        <Glyph name={visual.glyph} size={GLYPH[size]} color={color} />
      </View>
      {visual.badge ? (
        <View style={styles.badge}>
          <Glyph
            name={visual.badge}
            size={Math.round(size * 0.3)}
            color={color}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderRadius: radius.round,
    backgroundColor: palette.roast,
  },
});
