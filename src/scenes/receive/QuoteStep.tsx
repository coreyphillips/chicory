import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import type { ReceiveQuote } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { ExpiryRing } from '../../glyphs/ExpiryRing';
import { stagger } from '../../motion/presets';
import { usePaneActive } from '../../stage/panes/Pane';
import { amountIn, space, type as typography } from '../../theme';
import { ErrorPip, GlyphButton, WarningPips, turnIn } from './controls';
import type { Focus } from './focus';
import { feeGlyph, shownSats } from './model';

/** The create control, and the ring that runs down around it. */
const CONTROL = 88;
const RING = CONTROL + 16;

/**
 * A quote for a request (REDESIGN.md 6, Receive): the amount, what the
 * receive costs beside the glyph for how it arrives, and what is left. The
 * words for each line are its label, in the phrases the old rows used.
 *
 * Creating the request is a tap on the control inside the quote's expiry
 * ring. When the quote runs out the control turns into refresh, which asks
 * for a new one; a stale balance holds either back, and a tap on it then
 * refreshes the wallet instead. Tapping the amount goes back to change it.
 */
export function QuoteStep({
  quote,
  quotedAt,
  offline,
  receivableSats,
  expired,
  busy,
  stale,
  error,
  shake,
  onCreate,
  onRequote,
  onEdit,
  onBlocked,
  focus,
}: {
  quote: ReceiveQuote;
  quotedAt: number;
  offline: boolean;
  receivableSats: number;
  expired: boolean;
  busy: boolean;
  stale: boolean;
  error: string;
  shake: number;
  onCreate: () => void;
  onRequote: () => void;
  onEdit: () => void;
  onBlocked: () => void;
  focus: Focus;
}) {
  const live = usePaneActive();
  const glyph = feeGlyph({
    offline,
    feeSats: quote.feeSats,
    amountSats: quote.amountSats,
    receivableSats,
  });
  const how =
    glyph === 'moon'
      ? copy.receive.offlineOn
      : glyph === 'sprout'
      ? copy.receive.justInTime
      : '';
  const net = quote.amountSats && quote.netSats !== null ? quote.netSats : null;
  return (
    <View style={styles.quote}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.receive.editAmount}
        accessibilityValue={{
          text: quote.amountSats
            ? copy.receive.requested(quote.amountSats)
            : copy.receive.senderChooses,
        }}
        disabled={busy}
        onPress={live ? onEdit : undefined}
        style={styles.amount}
      >
        {quote.amountSats ? (
          <>
            <Text style={styles.figure} maxFontSizeMultiplier={1.2}>
              {amountIn(quote.amountSats, 'sats').value}
            </Text>
            <Text style={styles.unit} maxFontSizeMultiplier={1.2}>
              {amountIn(quote.amountSats, 'sats').suffix}
            </Text>
          </>
        ) : (
          <Glyph name="infinity" size={56} color={palette.cream} />
        )}
      </Pressable>
      <Reanimated.View
        entering={stagger(1)}
        accessible
        accessibilityLabel={[copy.receive.fee(quote.feeSats), how]
          .filter(Boolean)
          .join(' ')}
        style={styles.line}
      >
        <Glyph name={glyph} size={20} color={palette.bloom} />
        <Text style={styles.sign}>−</Text>
        <Text style={styles.value} maxFontSizeMultiplier={1.4}>
          {shownSats(quote.feeSats)}
        </Text>
      </Reanimated.View>
      {net !== null ? (
        <Reanimated.View
          entering={stagger(2)}
          accessible
          accessibilityLabel={copy.receive.net(net)}
          style={styles.line}
        >
          <Text style={styles.sign}>=</Text>
          <Text style={[styles.value, styles.net]} maxFontSizeMultiplier={1.4}>
            {shownSats(net)}
          </Text>
        </Reanimated.View>
      ) : null}
      <WarningPips warnings={quote.warnings} />
      <Reanimated.View entering={stagger(3)} style={styles.create}>
        <View pointerEvents="none" style={styles.ring}>
          <ExpiryRing
            size={RING}
            expiresAt={quote.expiresAt}
            createdAt={quotedAt}
          />
        </View>
        {expired ? (
          <Reanimated.View entering={turnIn()}>
            <GlyphButton
              glyph="refresh"
              label={copy.receive.refreshQuote}
              hint={stale ? copy.receive.stale : copy.receive.quoteExpired}
              size={CONTROL}
              tone="primary"
              busy={busy}
              blocked={stale}
              shake={shake}
              onPress={onRequote}
              onBlocked={onBlocked}
              focusRef={focus}
            />
          </Reanimated.View>
        ) : (
          <GlyphButton
            glyph="qr"
            label={copy.receive.create}
            hint={stale ? copy.receive.stale : undefined}
            size={CONTROL}
            tone="primary"
            busy={busy}
            blocked={stale}
            shake={shake}
            onPress={onCreate}
            onBlocked={onBlocked}
            focusRef={focus}
          />
        )}
      </Reanimated.View>
      {error ? <ErrorPip message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { alignItems: 'center', gap: space.md },
  amount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
    minHeight: 56,
  },
  figure: { ...typography.amount, color: palette.cream },
  unit: { ...typography.heroUnit, color: palette.steam },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sign: { ...typography.line, color: palette.steam },
  value: { ...typography.line, color: palette.steam },
  net: { color: palette.cream },
  create: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  ring: { position: 'absolute' },
});
