import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SendReview } from '@beignet/wallet-core';
import { Glyph } from '../../design/glyphs';
import { palette } from '../../design/palette';
import { Whisper } from '../../glyphs/Whisper';
import { curves, durations } from '../../motion/tokens';
import { amountIn, space, type as typography } from '../../theme';
import type { Unit } from '../../theme';
import { reviewFigures, reviewRail } from './model';
import { useBloom } from './tone';
import type { ReviewFigure } from './model';

/** The sum's lines are line text, which stops growing at 1.4 (REDESIGN.md 3.3). */
export const LINE_SCALE = 1.4;

/**
 * The widest of the sum's operators. Every line sets its own in a column
 * this wide, drawn out of sight to hold the width at any text size, so the
 * amounts after them start and end together.
 */
export const WIDEST_SIGNS = '+ ≤';

/**
 * One line of the sum, as one element: the rail on the first line, its
 * signs in the operators' column, and its amount set right in tabular
 * figures, so the places of every amount line up and the total reads as
 * their sum. A screen reader hears the line's words, and the rail's with the
 * first, since the glyph is not a control of its own.
 */
function Figure({
  figure,
  unit,
  rail,
}: {
  figure: ReviewFigure;
  unit: Unit;
  rail?: ReturnType<typeof reviewRail>;
}) {
  const bloom = useBloom();
  const total = figure.key === 'total';
  const shown = amountIn(figure.sats, unit);
  return (
    <View
      accessible
      accessibilityLabel={
        rail ? `${rail.label}, ${figure.label}` : figure.label
      }
      accessibilityValue={{ text: figure.value }}
      style={styles.line}
    >
      <View style={styles.rail}>
        {rail ? <Glyph name={rail.glyph} size={20} color={bloom.tone} /> : null}
      </View>
      <View style={styles.signs}>
        <Text
          style={[styles.sign, styles.ghost]}
          maxFontSizeMultiplier={LINE_SCALE}
        >
          {WIDEST_SIGNS}
        </Text>
        <Text
          style={[styles.sign, styles.shownSign]}
          maxFontSizeMultiplier={LINE_SCALE}
        >
          {figure.signs}
        </Text>
      </View>
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

/** How far the sum dims once the payment it priced is going out. */
export const SPENT_OPACITY = 0.4;

/**
 * What a payment will cost, as a sum with no words on it (REDESIGN.md 6,
 * Send): the rail and `+ ≤` the most the fee can be, `≈` what the route
 * priced should cost when there is an estimate, and `=` the most it all
 * comes to. Each line's words, as the engine and the old screen named them,
 * are what a screen reader hears. Engine warnings are honey pips.
 *
 * The figures are in `unit`, the one the balance is shown in. They are
 * never hidden: a review is where the payment is checked before it is sent.
 * Once the hold commits (`spent`) there is nothing left to check, so the
 * sum dims back and the screen reads as money going out.
 */
export function ReviewLines({
  review,
  unit = 'sats',
  spent = false,
}: {
  review: SendReview;
  unit?: Unit;
  spent?: boolean;
}) {
  const rail = reviewRail(review);
  // A colour change, not a movement, so it plays under Reduce Motion too.
  const dim = useSharedValue(spent ? SPENT_OPACITY : 1);
  useEffect(() => {
    dim.set(
      withTiming(spent ? SPENT_OPACITY : 1, {
        duration: durations.move,
        easing: curves.standard,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [spent, dim]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));
  return (
    <Reanimated.View style={[styles.lines, dimStyle]}>
      {reviewFigures(review).map((figure, index) => (
        <Figure
          key={figure.key}
          figure={figure}
          unit={unit}
          rail={index === 0 ? rail : undefined}
        />
      ))}
      {review.warnings.length ? (
        <View style={styles.pips}>
          {review.warnings.map(warning => (
            <Pip key={warning} warning={warning} />
          ))}
        </View>
      ) : null}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // As wide as its widest line, which every other line stretches to.
  lines: { alignSelf: 'center', alignItems: 'stretch', gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rail: { width: 24, alignItems: 'center' },
  signs: { justifyContent: 'center' },
  sign: { ...typography.line, color: palette.steam },
  ghost: { opacity: 0 },
  shownSign: { position: 'absolute', left: 0, top: 0 },
  // Set right, in the line's tabular figures, so places line up.
  amount: {
    ...typography.line,
    color: palette.steam,
    flexGrow: 1,
    textAlign: 'right',
  },
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
