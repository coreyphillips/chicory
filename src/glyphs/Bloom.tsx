import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { palette } from '../design/palette';

/**
 * The chicory bloom (REDESIGN.md 5): the mark, the loader and the lock bud.
 *
 * `open` is how far the petals have unfolded, from a closed bud (0) to the
 * full flower (1). `mode` is the loop it runs while nothing else happens, and
 * `event` a one-off it plays each time `key` changes. `tone` follows the
 * network and the wallet's state, and `halo` is the honey ring a pending
 * backup puts around it. `detail` 'mark' drops the veins and draws a plain
 * centre, and is the default below 40pt, where the tips also keep three
 * teeth instead of five.
 *
 * This version draws the flower still, at `open`, from the geometry below.
 * The loops and events come later and keep this signature.
 */
export type BloomMode = 'still' | 'breathe' | 'chase' | 'ratchet';
export type BloomTone = 'live' | 'test' | 'dormant';
export type BloomEvent = {
  kind: 'burst' | 'wilt' | 'fold' | 'fall' | 'shake';
  key: number;
};

export interface BloomProps {
  size: number;
  mode?: BloomMode;
  open?: number;
  tone?: BloomTone;
  halo?: boolean;
  event?: BloomEvent;
  detail?: 'full' | 'mark';
  /** Without one, the bloom is decoration and hidden from screen readers. */
  accessibilityLabel?: string;
}

/** Each petal's length, so the flower is hand-drawn rather than stamped. */
const LENGTHS = [1, 0.96, 0.99, 0.94, 1, 0.97, 0.95, 1, 0.98, 0.95, 0.99, 0.96];

/** A petal pointing up from the centre, with a fringed five-tooth tip. */
const PETAL =
  'M-1.6,-8 C-4.2,-18 -9.8,-31 -10.4,-41.5 L-8.3,-44.8 L-6.25,-42.6 L-4.2,-45.6 L-2.1,-43.3 L0,-46 L2.1,-43.3 L4.2,-45.6 L6.25,-42.6 L8.3,-44.8 L10.4,-41.5 C9.8,-31 4.2,-18 1.6,-8 Z';
/** Below 40pt five teeth blur together, so the tip keeps three. */
const PETAL_SMALL =
  'M-1.6,-8 C-4.2,-18 -9.8,-31 -10.4,-41.5 L-6.9,-45 L-3.5,-42.6 L0,-45.8 L3.5,-42.6 L6.9,-45 L10.4,-41.5 C9.8,-31 4.2,-18 1.6,-8 Z';
const VEIN = 'M0,-12 L0,-38';

/** A petal's resting angle: 30 degrees apart, nudged so none sit square. */
function angle(i: number) {
  return 30 * i + (i % 2 ? 2 : 0) - (i % 3 === 0 ? 1.5 : 0);
}

/** `n` dots of radius `r` spaced evenly on a circle of `at` around the centre. */
function dots(n: number, at: number, r: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: 50 + at * Math.sin(t), y: 50 - at * Math.cos(t), r };
  });
}
const ANTHERS = dots(8, 9.5, 1.1);
const POLLEN = dots(5, 5, 0.9);

/** Slate stands in for bloom on a test network; dormant is husk and bark. */
const OUTLINE = { fill: 'none', stroke: palette.slate, strokeWidth: 1.6 };
const TONES = {
  live: {
    center: { fill: palette.stamen },
    anther: palette.stamen,
    pollen: palette.bloomHi,
  },
  test: { center: OUTLINE, anther: palette.slate, pollen: palette.slate },
  dormant: {
    center: { fill: palette.bark },
    anther: palette.bark,
    pollen: palette.husk,
  },
} as const;

export function Bloom({
  size,
  open = 1,
  tone = 'live',
  halo = false,
  detail = size < 40 ? 'mark' : 'full',
  accessibilityLabel,
}: BloomProps) {
  // SVG ids are document-wide on some renderers, so each bloom names its own.
  const gradient = `petal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const q = Math.min(1, Math.max(0, open));
  const full = detail === 'full';
  const colors = TONES[tone];
  const petal =
    tone === 'live'
      ? { fill: `url(#${gradient})` }
      : tone === 'test'
      ? OUTLINE
      : { fill: palette.husk, stroke: palette.bark, strokeWidth: 1 };
  const labelled = !!accessibilityLabel;
  return (
    <View
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!labelled}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient
            id={gradient}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="-8"
            x2="0"
            y2="-46"
          >
            <Stop offset="0" stopColor={palette.bloomNight} />
            <Stop offset="0.45" stopColor={palette.bloomDeep} />
            <Stop offset="1" stopColor={palette.bloomHi} />
          </LinearGradient>
        </Defs>
        {halo ? (
          <Circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke={palette.honey}
            strokeWidth="2"
          />
        ) : null}
        {LENGTHS.map((length, i) => (
          <G
            key={i}
            opacity={0.25 + 0.75 * q}
            transform={`translate(50 50) rotate(${
              angle(i) - 14 * (1 - q)
            }) scale(${0.18 + 0.82 * q} ${(0.25 + 0.75 * q) * length})`}
          >
            <Path d={size < 40 ? PETAL_SMALL : PETAL} {...petal} />
            {full && tone === 'live' ? (
              <Path
                d={VEIN}
                stroke={palette.bloomNight}
                strokeOpacity={0.35}
                strokeWidth={0.8}
              />
            ) : null}
          </G>
        ))}
        <Circle cx="50" cy="50" r={full ? 7.5 : 8} {...colors.center} />
        {full
          ? [...ANTHERS, ...POLLEN].map((dot, i) => (
              <Circle
                key={i}
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                fill={i < ANTHERS.length ? colors.anther : colors.pollen}
              />
            ))
          : null}
      </Svg>
    </View>
  );
}
