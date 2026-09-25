import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { palette } from '../design/palette';
import { useNow } from '../services/clock';

/**
 * How long a quote or request has left, as a ring that runs down around the
 * control or frame it belongs to (REDESIGN.md 5, ExpiryRing). It turns honey
 * in its last 10 seconds and is gone at zero, when `onExpired` fires once.
 *
 * `createdAt` is when the countdown started, so the ring shows the share
 * left rather than a full ring that suddenly empties; without it the ring is
 * full when it mounts. `shape` 'rect' runs it around a `width` by `height`
 * frame with corner `radius`, such as a request's QR.
 *
 * This version steps once a second. The single linear timing, the pulse in
 * the last 3 seconds and the collapse come later and keep this signature.
 */
export interface ExpiryRingProps {
  size: number;
  expiresAt: number;
  createdAt?: number;
  shape?: 'circle' | 'rect';
  width?: number;
  height?: number;
  radius?: number;
  onExpired?: () => void;
}

/** Time left when the ring warns. */
const LATE_MS = 10_000;
const STROKE = 2.5;

export function ExpiryRing({
  size,
  expiresAt,
  createdAt,
  shape = 'circle',
  width = size,
  height = size,
  radius = 0,
  onExpired,
}: ExpiryRingProps) {
  // Without a start, the ring is full when it first appears.
  const [mounted] = useState(Date.now);
  const start = createdAt ?? mounted;
  const now = useNow(1000);
  const left = Math.max(0, expiresAt - now);
  const share = expiresAt > start ? left / (expiresAt - start) : 0;

  // Once per deadline, however often it re-renders past it. A new deadline,
  // such as a refreshed quote, is told again when it runs out.
  const expired = left === 0;
  const told = useRef<number | null>(null);
  useEffect(() => {
    if (!expired || told.current === expiresAt) return;
    told.current = expiresAt;
    onExpired?.();
  }, [expired, expiresAt, onExpired]);

  const color = left <= LATE_MS ? palette.honey : palette.bloom;
  const inset = STROKE / 2;
  const w = shape === 'rect' ? width : size;
  const h = shape === 'rect' ? height : size;
  const length =
    shape === 'rect'
      ? 2 * (w + h - 4 * inset) - (8 - 2 * Math.PI) * radius
      : Math.PI * (size - STROKE);
  const drawn = {
    fill: 'none',
    stroke: color,
    strokeWidth: expired ? 0 : STROKE,
    strokeLinecap: 'round' as const,
    strokeDasharray: [length * share, length],
  };
  return (
    <View
      style={{ width: w, height: h }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={w} height={h}>
        {shape === 'rect' ? (
          <Rect
            x={inset}
            y={inset}
            width={w - STROKE}
            height={h - STROKE}
            rx={radius}
            {...drawn}
          />
        ) : (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={(size - STROKE) / 2}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            {...drawn}
          />
        )}
      </Svg>
    </View>
  );
}
