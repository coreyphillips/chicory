import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SendReview } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { number, space, type as typography } from '../../theme';
import { reviewRail } from './model';

const UNIT = 'sats';

/** One line of the sum: its signs and its amount, with its words spoken. */
function Figure({
  signs,
  sats,
  label,
  value,
  total = false,
}: {
  signs: string;
  sats: number;
  label: string;
  value: string;
  total?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      style={styles.figure}
    >
      <Text style={styles.signs}>{signs}</Text>
      <Text style={[styles.amount, total && styles.total]}>
        {`${number(sats)} ${UNIT}`}
      </Text>
    </View>
  );
}

/** An engine warning, as a honey pip that says it when asked. */
function Pip({ warning }: { warning: string }) {
  return (
    <Whisper label={warning}>
      <View accessible accessibilityLabel={warning} style={styles.pipArea}>
        <View style={styles.pip} />
      </View>
    </Whisper>
  );
}

/**
 * What a payment will cost, as a sum with no words on it (REDESIGN.md 6,
 * Send): the rail and `+ ≤` the most the fee can be, `≈` what the route
 * priced should cost when there is an estimate, and `=` the most it all
 * comes to. Each line's words, as the engine and the old screen named them,
 * are what a screen reader hears. Engine warnings are honey pips.
 */
export function ReviewLines({ review }: { review: SendReview }) {
  const rail = reviewRail(review);
  const estimate = review.estimatedFeeSats;
  return (
    <View style={styles.lines}>
      <View style={styles.line}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={rail.label}
          style={styles.rail}
        >
          <Glyph name={rail.glyph} size={20} color={palette.bloom} />
        </View>
        <Figure
          signs="+ ≤"
          sats={review.feeSats}
          label={review.feeLabel || copy.send.fee}
          value={copy.amount.spoken(review.feeSats)}
        />
      </View>
      {estimate != null ? (
        <View style={styles.line}>
          <View style={styles.rail} />
          <Figure
            signs="≈"
            sats={estimate}
            label={copy.send.expectedFee}
            value={copy.send.about(estimate)}
          />
        </View>
      ) : null}
      <View style={styles.line}>
        <View style={styles.rail} />
        <Figure
          signs="="
          sats={review.totalSats}
          label={
            estimate != null ? copy.send.totalAtMost : copy.send.totalWithFee
          }
          value={copy.amount.spoken(review.totalSats)}
          total
        />
      </View>
      {review.warnings.length ? (
        <View style={styles.pips}>
          {review.warnings.map(warning => (
            <Pip key={warning} warning={warning} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lines: { alignSelf: 'center', gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rail: { width: 24, alignItems: 'center' },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  signs: { ...typography.line, color: palette.steam, minWidth: 32 },
  amount: { ...typography.line, color: palette.steam },
  total: { color: palette.cream },
  pips: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xxs,
    paddingTop: space.xs,
  },
  pipArea: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.honey,
  },
});
