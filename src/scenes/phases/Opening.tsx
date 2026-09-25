import React from 'react';
import { View } from 'react-native';
import { copy } from '../../design/copy';
import { Bloom } from '../../glyphs/Bloom';
import { Whisper } from '../../glyphs/Whisper';
import { PhaseRoot } from './parts';
import { QUIET_MS, SIZES } from './visual';

/**
 * The restore at launch, before it is known whether there is a wallet to
 * show: the bloom's chase, a light running round the petals, and nothing to
 * read. A screen reader hears the wait, marked busy. A quick open ends
 * before the loader shows.
 */
export function Opening() {
  return (
    <PhaseRoot delay={QUIET_MS}>
      <Whisper label={copy.phase.openingWallet}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={copy.phase.openingWallet}
          accessibilityState={{ busy: true }}
        >
          <Bloom size={SIZES.loader} mode="chase" />
        </View>
      </Whisper>
    </PhaseRoot>
  );
}
