import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SendReview } from '@beignet/wallet-core';
import { Glyph } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { amountIn, space, type as typography } from '../../theme';
import type { Unit } from '../../theme';
import { reviewFigures, reviewRail } from './model';
import { useBloom } from './tone';
import type { ReviewFigure } from './model';

/** The sum's lines are line text, which stops growing at 1.4 (REDESIGN.md 3.3). */
export const LINE_SCALE = 1.4;

/** One line of the sum: its signs and its amount, with its words spoken. */
function Figure({ figure, unit }: { figure: ReviewFigure; unit: Unit }) {
  const total = figure.key === 'total';
  const shown = amountIn(figure.sats, unit);
  return (
    <View
      accessible
      accessibilityLabel={figure.label}
      accessibilityValue={{ text: figure.value }}
      style={styles.figure}
    >
      <Text style={styles.signs} maxFontSizeMultiplier={LINE_SCALE}>
        {figure.signs}
      </Text>
      <Text
        style={[styles.amount, total && styles.total]}
        maxFontSizeMultiplier={LINE_SCALE}
      >
        {`${shown.value} ${shown.suffix}`}
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
 *
 * The figures are in `unit`, the one the balance is shown in. They are
 * never hidden: a review is where the payment is checked before it is sent.
 */
export function ReviewLines({
  review,
  unit = 'sats',
}: {
  review: SendReview;
  unit?: Unit;
}) {
  const rail = reviewRail(review);
  const bloom = useBloom();
  return (
    <View style={styles.lines}>
      {reviewFigures(review).map((figure, index) => (
        <View key={figure.key} style={styles.line}>
          {index === 0 ? (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={rail.label}
              style={styles.rail}
            >
              <Glyph name={rail.glyph} size={20} color={bloom.tone} />
            </View>
          ) : (
            <View style={styles.rail} />
          )}
          <Figure figure={figure} unit={unit} />
        </View>
      ))}
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
