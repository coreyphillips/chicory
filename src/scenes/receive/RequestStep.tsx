import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { ReceiveRequest, ReceiveStatus } from '@beignet/wallet-core';
import { ReceiveReceipt } from '../../components/ReceiveReceipt';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { ExpiryRing } from '../../glyphs/ExpiryRing';
import { QrBloom, qrSide } from '../../glyphs/QrBloom';
import { Whisper } from '../../glyphs/Whisper';
import { riseIn, stagger } from '../../motion/presets';
import { curves } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { MASK, radius, space, type as typography } from '../../theme';
import type { Unit } from '../../theme';
import { ErrorPip, GlyphButton, WarningPips } from './controls';
import type { Focus } from './focus';
import { Rock } from './loops';
import type { RequestFace } from './model';
import { lateAt, remainderSats, requestRails, shownSats } from './model';

/** The expiry ring runs this far outside the card. */
export const RING_GAP = 8;

/** A request's frame for a code `qr` points across. */
export const frameSide = (qr: number) => qrSide(qr) + RING_GAP * 2;

/**
 * A request and what becomes of it (REDESIGN.md 6, Receive). The code
 * blooms in a frame whose ring runs down to the request's expiry, turning
 * honey near the end; under it the amount or an infinity, the note, and how
 * it can be paid, with a rocking moon when it is payable offline.
 *
 * An expired request dissolves and a reused address scatters, and either
 * way share and copy go, leaving plus as the way on. Money arriving implodes
 * the code into the receipt's ring where it stood.
 */
export function RequestStep({
  request,
  createdAt,
  face,
  minutesLeft,
  receipt,
  trackingError,
  hidden,
  unit,
  qr,
  error,
  onLift,
  onCopy,
  copies,
  onShare,
  onAgain,
  onActivity,
  focus,
}: {
  request: ReceiveRequest;
  createdAt: number;
  face: RequestFace;
  minutesLeft: number;
  receipt: ReceiveStatus | null;
  /** Why the request's status cannot be read, when it cannot. */
  trackingError?: string;
  hidden: boolean;
  unit: Unit;
  /** How wide the code is drawn. */
  qr: number;
  error: string;
  onLift: () => void;
  onCopy: () => void;
  /** How many times the request has been copied, for the copy control's check. */
  copies: number;
  onShare: () => void;
  onAgain: () => void;
  onActivity: () => void;
  /** Takes what the request now says: the receipt, a safety state, or itself. */
  focus: Focus;
}) {
  const side = frameSide(qr);
  const remainder = remainderSats(request.amountSats, receipt);
  const scattered = face.qr === 'scattered';
  const status =
    face.qr === 'expired'
      ? copy.receive.expired
      : scattered
      ? `${copy.receive.reused} ${copy.receive.reusedShare}`
      : null;
  return (
    <View style={styles.request}>
      <View style={styles.stage}>
        <View style={receipt ? styles.behind : undefined}>
          <View style={[styles.frame, { width: side, height: side }]}>
            {/* Kept through expiry, so the ring can collapse as it ends. */}
            {face.qr === 'shown' || face.qr === 'expired' ? (
              <View pointerEvents="none" style={styles.fill}>
                <ExpiryRing
                  size={side}
                  shape="rect"
                  width={side}
                  height={side}
                  radius={radius.qr + RING_GAP}
                  expiresAt={request.expiresAt}
                  createdAt={createdAt}
                  lateAt={lateAt(createdAt, request.expiresAt)}
                />
              </View>
            ) : null}
            <QrBloom
              value={request.uri}
              size={qr}
              state={face.qr}
              onPress={face.shareable ? onLift : undefined}
              onLongPress={face.shareable ? onCopy : undefined}
              accessibilityLabel={copy.receive.qr}
            />
            {status ? (
              <View
                ref={focus}
                accessible
                accessibilityLabel={status}
                accessibilityValue={
                  scattered && trackingError
                    ? { text: trackingError }
                    : undefined
                }
                pointerEvents="none"
                style={styles.fill}
              />
            ) : null}
            {receipt && face.reused ? (
              <Badge
                key="twin"
                glyph="twin"
                label={trackingError ?? copy.receive.reusedAddress}
              />
            ) : trackingError && !scattered ? (
              <Badge key="question" glyph="question" label={trackingError} />
            ) : null}
          </View>
        </View>
        {receipt ? (
          <ReceiveReceipt
            status={receipt}
            amountSats={request.amountSats}
            hidden={hidden}
            unit={unit}
            celebrate
            size={side}
            focusRef={focus}
          />
        ) : (
          <About
            request={request}
            face={face}
            minutesLeft={minutesLeft}
            focus={status ? undefined : focus}
          />
        )}
      </View>
      {receipt ? null : <WarningPips warnings={request.warnings} />}
      <Reanimated.View entering={stagger(2)} style={styles.controls}>
        {receipt ? (
          <GlyphButton
            glyph="orbit"
            label={copy.receive.viewActivity}
            onPress={onActivity}
          />
        ) : face.shareable ? (
          <>
            <GlyphButton
              glyph="share"
              label={copy.receive.share}
              onPress={onShare}
            />
            <GlyphButton
              glyph="copy"
              label={copy.receive.copy}
              confirm={copies}
              onPress={onCopy}
            />
          </>
        ) : null}
        <GlyphButton
          glyph="plus"
          label={
            remainder !== null
              ? copy.receive.requestRemaining
              : copy.receive.createAnother
          }
          tone={face.shareable && !receipt ? 'raised' : 'primary'}
          halo={scattered}
          pulse={face.qr === 'expired' ? 1 : undefined}
          onPress={onAgain}
        >
          {/* What is owed gives away what arrived, so it hides with it. */}
          {remainder === null ? null : hidden ? MASK : shownSats(remainder)}
        </GlyphButton>
      </Reanimated.View>
      {error ? <ErrorPip message={error} /> : null}
    </View>
  );
}

/**
 * A honey mark at the frame's corner: a question, nodding once, while the
 * request's status cannot be read, and the twin when money arrived on a
 * reused address, once the scattered code that said so has given way to the
 * receipt.
 */
function Badge({
  glyph,
  label,
}: {
  glyph: 'question' | 'twin';
  label: string;
}) {
  const { reduced } = useMotionPrefs();
  const nod = useSharedValue(0);
  const nodded = useRef(false);
  useEffect(() => {
    if (glyph !== 'question' || nodded.current || reduced) return;
    nodded.current = true;
    const step = { duration: 150, easing: curves.sine };
    nod.set(
      withSequence(
        withTiming(-12, step),
        withTiming(12, step),
        withTiming(-6, step),
        withTiming(0, step),
      ),
    );
    return () => cancelAnimation(nod);
  }, [glyph, nod, reduced]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${nod.get()}deg` }],
  }));
  return (
    <Reanimated.View
      entering={riseIn(8)}
      accessible
      accessibilityLabel={label}
      style={[styles.badge, style]}
    >
      <Whisper label={label} style={styles.whole}>
        <Glyph name={glyph} size={18} color={palette.honey} />
      </Whisper>
    </Reanimated.View>
  );
}

/** What the request is for, and how it can be paid. */
function About({
  request,
  face,
  minutesLeft,
  focus,
}: {
  request: ReceiveRequest;
  face: RequestFace;
  minutesLeft: number;
  focus?: Focus;
}) {
  const rails = requestRails(request);
  const how = [
    rails.length > 1 ? copy.receive.unified : copy.receive.lightningOnly,
    request.offlineReceive && !face.expired ? copy.receive.offlineRequest : '',
  ]
    .filter(Boolean)
    .join(' ');
  const left = face.expired
    ? undefined
    : [
        copy.receive.expiresIn(minutesLeft),
        face.late ? copy.receive.nearExpiry : '',
      ]
        .filter(Boolean)
        .join('. ');
  return (
    <Reanimated.View entering={stagger(1)} style={styles.about}>
      <View
        ref={focus}
        accessible
        accessibilityLabel={copy.receive.yours(
          request.amountSats
            ? copy.amount.spoken(request.amountSats)
            : copy.receive.anyAmount,
        )}
      >
        {request.amountSats ? (
          <Text style={styles.amount} maxFontSizeMultiplier={1.4}>
            {shownSats(request.amountSats)}
          </Text>
        ) : (
          <Glyph name="infinity" size={28} color={palette.cream} />
        )}
      </View>
      {request.description ? (
        <Text style={styles.note} maxFontSizeMultiplier={1.4}>
          {request.description}
        </Text>
      ) : null}
      <Whisper label={[how, left].filter(Boolean).join('. ')}>
        <View
          accessible
          accessibilityLabel={how}
          accessibilityValue={left ? { text: left } : undefined}
          style={styles.rails}
        >
          {rails.map(rail => (
            <Glyph key={rail} name={rail} size={18} color={palette.steam} />
          ))}
          {request.offlineReceive && !face.expired ? (
            <Rock>
              <Glyph name="moon" size={18} color={palette.bloom} />
            </Rock>
          ) : null}
        </View>
      </Whisper>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  request: { alignItems: 'center', gap: space.lg },
  stage: { alignItems: 'center', alignSelf: 'stretch', gap: space.md },
  behind: { position: 'absolute', top: 0, alignSelf: 'center' },
  frame: { alignItems: 'center', justifyContent: 'center' },
  fill: { ...StyleSheet.absoluteFill },
  badge: {
    position: 'absolute',
    top: -space.xxs,
    right: -space.xxs,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cocoa,
  },
  about: { alignItems: 'center', gap: space.xs },
  amount: { ...typography.line, color: palette.cream },
  note: { ...typography.meta, color: palette.steam, textAlign: 'center' },
  rails: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The whole badge answers a long press, not only its glyph.
  whole: {
    alignSelf: 'stretch',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
});
