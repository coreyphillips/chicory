import React from 'react';
import type { ComponentRef, Ref } from 'react';
import { View } from 'react-native';
import { copy } from '../../design/copy';
import { palette } from '../../design/palette';
import { Odometer } from '../../glyphs/Odometer';
import type { Unit } from '../../theme';

/**
 * An amount of a payment at 48pt, with its unit, in `color`, drawn by the
 * odometer: in the unit the balance is shown in, and as its six dots while
 * amounts are hidden (`masked`). It is one element to a screen reader, read
 * as the amount in sats, or as hidden. `ref` is that element, where a screen
 * reader lands on a review.
 */
export function Amount({
  sats,
  unit = 'sats',
  masked = false,
  color = palette.cream,
  ref,
}: {
  sats: number;
  unit?: Unit;
  masked?: boolean;
  color?: string;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  return (
    <View
      ref={ref}
      accessible
      accessibilityLabel={
        masked ? copy.amount.hidden : copy.amount.spoken(sats)
      }
    >
      {/* The odometer is its own element too; here the wrapper speaks. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Odometer
          sats={sats}
          unit={unit}
          masked={masked}
          variant="amount"
          color={color}
        />
      </View>
    </View>
  );
}
