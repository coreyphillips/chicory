import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { ReceiveStatus } from '@beignet/wallet-core';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import { CopyChip } from '../glyphs/CopyChip';
import { Odometer } from '../glyphs/Odometer';
import { curves } from '../motion/tokens';
import { useMotionPrefs } from '../motion/useMotionPrefs';
import { DrawnArc, DrawnGlyph } from '../scenes/receive/draw';
import type { Focus } from '../scenes/receive/focus';
import { Spin } from '../scenes/receive/loops';
import {
  CELEBRATION,
  PETALS,
  petalPose,
  receiptRing,
  receiptTransactions,
} from '../scenes/receive/model';
import { useBloom } from '../scenes/receive/tone';
import { useFlashTint } from '../stage/StageContext';
import { space } from '../theme';
import type { Unit } from '../theme';

/**
 * What arrived for a request (REDESIGN.md 5 and 6): a sage ring that is full
 * when the payment is complete, split into what arrived over what was asked
 * when only part of it has, and an orbit while it confirms on chain; the
 * amount that arrived under it; and for a Bitcoin receipt, each transaction
 * as a chip with a small ring that closes once it confirms.
 *
 * `celebrate` plays the arrival the first time it is seen: the ring draws,
 * the amount counts up, and a completed payment draws its check and bursts
 * its petals as the ground behind the canvas flashes sage (REDESIGN.md 3.2,
 * G3). A payment's detail shows the same receipt still. The words are in its
 * label, masked like the amounts when `hidden`.
 */
export function ReceiveReceipt({
  status,
  amountSats,
  hidden = false,
  unit = 'sats',
  celebrate = false,
  size = 96,
  focusRef,
}: {
  status: ReceiveStatus;
  amountSats: number | null;
  hidden?: boolean;
  unit?: Unit;
  /** Plays the arrival, where the request's code was. */
  celebrate?: boolean;
  /** The ring's size, the same as the code it replaces. */
  size?: number;
  /** Where a screen reader's focus is sent to hear what arrived. */
  focusRef?: Focus;
}) {
  const { reduced } = useMotionPrefs();
  const play = celebrate && !reduced;
  const ring = receiptRing(status, amountSats);
  const completed = status.phase === 'completed';
  const partial = status.phase === 'partial';
  const said = (value: number) =>
    hidden ? copy.amount.hidden : copy.amount.spoken(value);

  const title = completed
    ? copy.receive.received
    : partial
    ? copy.receive.partial
    : copy.receive.detected;
  const detail = completed
    ? copy.receive.receivedSats(said(status.receivedSats))
    : partial
    ? amountSats != null
      ? copy.receive.partialSplit(said(status.receivedSats), said(amountSats))
      : copy.receive.partialSoFar(said(status.receivedSats))
    : copy.receive.confirming;
  const summary = [title, detail, partial ? copy.receive.partialCheck : '']
    .filter(Boolean)
    .join(' ');
  const bitcoin = status.method === 'bitcoin';

  // The sage flash is a colour, so it plays under Reduce Motion too, at once
  // rather than with the burst it would have joined.
  const flash = useFlashTint();
  useEffect(() => {
    if (!celebrate || !completed) return;
    const timer = setTimeout(
      () => flash('sage'),
      play ? CELEBRATION.tint.delay : 0,
    );
    return () => clearTimeout(timer);
  }, [celebrate, completed, play, flash]);

  // The amount counts up from nothing once the ring has started to draw.
  const [counted, setCounted] = useState(play ? 0 : status.receivedSats);
  useEffect(() => {
    if (!play) {
      setCounted(status.receivedSats);
      return;
    }
    const timer = setTimeout(
      () => setCounted(status.receivedSats),
      CELEBRATION.count.delay,
    );
    return () => clearTimeout(timer);
  }, [play, status.receivedSats]);

  return (
    // Where it celebrates, Receive says what arrived itself.
    <View
      accessibilityLiveRegion={celebrate ? 'none' : 'polite'}
      style={styles.stack}
    >
      <View
        ref={focusRef}
        accessible
        accessibilityLabel={summary}
        accessibilityValue={
          bitcoin
            ? {
                text: copy.receive.breakdown(
                  said(status.receivedSats),
                  said(status.confirmedSats),
                  said(status.pendingSats),
                ),
              }
            : undefined
        }
        style={styles.head}
      >
        <Ring
          size={size}
          kind={ring.kind}
          share={ring.share}
          completed={completed}
          center={bitcoin ? 'chain' : 'bolt'}
          play={play}
        />
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.amount}
        >
          <Odometer
            sats={counted}
            unit={unit}
            masked={hidden}
            variant={celebrate ? 'amountDetail' : 'line'}
            color={completed ? palette.sage : palette.cream}
            sign="+"
            duration={play ? CELEBRATION.count.duration : undefined}
          />
          {partial && amountSats != null ? (
            <View style={styles.of}>
              <View style={styles.rule} />
              <Odometer
                sats={amountSats}
                unit={unit}
                masked={hidden}
                variant="line"
                color={palette.steam}
              />
            </View>
          ) : null}
        </View>
      </View>
      {bitcoin
        ? receiptTransactions(status).map(({ txid, confirmed }) => (
            <View key={txid} style={styles.tx}>
              <TxRing confirmed={confirmed} />
              <View style={styles.chip}>
                <CopyChip label={copy.receive.transaction} value={txid} />
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

const STROKE = 4;

function Ring({
  size,
  kind,
  share,
  completed,
  center,
  play,
}: {
  size: number;
  kind: 'full' | 'split' | 'orbit';
  share: number;
  completed: boolean;
  center: 'chain' | 'bolt';
  play: boolean;
}) {
  const arc = useSharedValue(play ? 0 : share);
  const check = useSharedValue(!play && completed ? 1 : 0);
  const burst = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    const delay = first.current ? CELEBRATION.ring.delay : 0;
    first.current = false;
    arc.set(
      play
        ? withDelay(
            delay,
            withTiming(share, {
              duration: CELEBRATION.ring.duration,
              easing: curves.enter,
            }),
          )
        : share,
    );
    return () => cancelAnimation(arc);
  }, [arc, share, play]);
  useEffect(() => {
    if (!completed) {
      check.set(0);
      return;
    }
    if (!play) {
      check.set(1);
      return;
    }
    const { check: drawn, burst: petals } = CELEBRATION;
    check.set(
      withDelay(
        drawn.delay,
        withTiming(1, { duration: drawn.duration, easing: curves.enter }),
      ),
    );
    burst.set(0);
    burst.set(
      withDelay(
        petals.delay,
        withTiming(1, { duration: petals.duration, easing: curves.standard }),
      ),
    );
    return () => {
      cancelAnimation(check);
      cancelAnimation(burst);
    };
  }, [completed, play, check, burst]);

  const stroke = size >= 96 ? STROKE : 2.5;
  const c = size / 2;
  const r = c - stroke;
  const around = 2 * Math.PI * r;
  const glyph = Math.round(size * 0.36);
  const box = { width: size, height: size };
  const sage = (
    <DrawnArc size={size} stroke={stroke} color={palette.sage} share={arc} />
  );
  return (
    <View style={box}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={palette.husk}
          strokeWidth={stroke}
        />
        {kind === 'split' ? (
          <Circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={palette.honey}
            strokeWidth={stroke}
            strokeDasharray={[stroke * 1.2, stroke * 2]}
            strokeDashoffset={-around * share}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
        {kind === 'orbit' ? null : sage}
      </Svg>
      {kind === 'orbit' ? (
        <Spin style={StyleSheet.absoluteFill}>
          <Svg width={size} height={size}>
            {sage}
          </Svg>
        </Spin>
      ) : null}
      <View style={styles.center}>
        {completed ? (
          <DrawnGlyph
            name="check"
            size={glyph}
            color={palette.sage}
            progress={check}
          />
        ) : (
          <Glyph
            name={kind === 'split' ? 'receive' : center}
            size={glyph}
            color={kind === 'split' ? palette.honey : palette.sage}
          />
        )}
      </View>
      {play && completed ? <Petals size={size} progress={burst} /> : null}
    </View>
  );
}

/** A burst petal: the bloom's fringed petal, small, pointing out. */
const PETAL =
  'M-1.6,-8 C-4.2,-18 -9.8,-31 -10.4,-41.5 L-6.9,-45 L-3.5,-42.6 L0,-45.8 L3.5,-42.6 L6.9,-45 L10.4,-41.5 C9.8,-31 4.2,-18 1.6,-8 Z';
const PETAL_SIZE = 18;

function Petals({
  size,
  progress,
}: {
  size: number;
  progress: SharedValue<number>;
}) {
  const { hi } = useBloom();
  return (
    <View pointerEvents="none" style={styles.center}>
      {Array.from({ length: PETALS }, (_, i) => (
        <Petal key={i} index={i} size={size} progress={progress} color={hi} />
      ))}
    </View>
  );
}

function Petal({
  index,
  size,
  progress,
  color,
}: {
  index: number;
  size: number;
  progress: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const pose = petalPose(index, progress.get(), size / 2, size * 0.28);
    return {
      opacity: pose.opacity,
      transform: [
        { translateX: pose.x },
        { translateY: pose.y },
        { rotate: `${pose.rotate}deg` },
        { scale: pose.scale },
      ],
    };
  });
  return (
    <Reanimated.View style={[styles.petal, style]}>
      <Svg width={PETAL_SIZE} height={PETAL_SIZE} viewBox="-12 -48 24 48">
        <Path d={PETAL} fill={color} />
      </Svg>
    </Reanimated.View>
  );
}

/** A transaction's own ring, 16pt: closed once confirmed, orbiting until. */
function TxRing({ confirmed }: { confirmed: boolean }) {
  const size = 16;
  const stroke = 2;
  const r = size / 2 - stroke;
  const around = 2 * Math.PI * r;
  const circle = (
    <Circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke={palette.sage}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeDasharray={confirmed ? undefined : [around / 4, around]}
    />
  );
  return (
    <View
      accessible
      accessibilityLabel={
        confirmed ? copy.receive.txConfirmed : copy.receive.txConfirming
      }
      style={styles.txRing}
    >
      {confirmed ? (
        <Svg width={size} height={size}>
          {circle}
        </Svg>
      ) : (
        <Spin>
          <Svg width={size} height={size}>
            {circle}
          </Svg>
        </Spin>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md, alignItems: 'center', alignSelf: 'stretch' },
  head: { alignItems: 'center', gap: space.md },
  amount: { alignItems: 'center', gap: space.xxs },
  of: { alignItems: 'center', gap: space.xxs },
  rule: { width: 48, height: 1, backgroundColor: palette.husk },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  petal: { position: 'absolute' },
  tx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
  },
  txRing: { width: 16, height: 16 },
  chip: { flex: 1 },
});
