import React from 'react';
import type { ComponentRef, Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { copy } from '../../design/copy';
import { ExpiryRing } from '../../glyphs/ExpiryRing';
import { HoldButton } from '../../glyphs/HoldButton';
import { fadeOut } from '../../motion/presets';
import { useNow } from '../../services/clock';
import { CONTROL, CircleControl, QuoteRefresh } from './Controls';
import { useTestNetwork } from './tone';

/** The ring round the hold, at r+8 from the control (REDESIGN.md 5). */
const RING = CONTROL + 16;

/**
 * Where a review is committed (REDESIGN.md 5 and 6, Send): the hold inside
 * the quote's ring. The ring stays through the quote running out, so it
 * retracts round the refresh that takes the hold's place. While the balance
 * is too old to spend against, the hold gives way to a dust control whose
 * tap shakes and refreshes the balance instead.
 *
 * Once the hold commits (`spent`) the quote is used: its ring fades away and
 * nothing it could say applies to the payment any more, so the hold stays,
 * with its orbit, whatever the quote's clock or the balance's age would
 * have made of it. Money is going out.
 *
 * A screen reader commits the hold with one action, so the hold says the
 * whole review with it: `summary`, the total, the fee and every engine
 * warning, and then the time the quote has left, which the ring shows and
 * does not say. Handlers are given only while a tap does something, as the
 * controls on the canvas take them. `ref` is whichever control is shown, for
 * the screen to move a screen reader to it.
 */
export function Commit({
  accessibilityLabel,
  summary,
  expiresAt,
  createdAt,
  warning,
  expired,
  stale,
  busy,
  spent = false,
  onCommit,
  onRefreshQuote,
  onRefresh,
  ref,
}: {
  accessibilityLabel: string;
  summary: string;
  expiresAt: number;
  createdAt: number;
  warning: boolean;
  expired: boolean;
  stale: boolean;
  busy: boolean;
  /** The hold has committed: the payment is going out on this quote. */
  spent?: boolean;
  onCommit: () => void;
  onRefreshQuote?: () => void;
  onRefresh?: () => void;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const test = useTestNetwork();
  const refresh = expired && !spent;
  const gated = stale && !spent && !refresh;
  // Only the words need the second: the ring runs down on its own timing.
  const now = useNow(1000, !expired && !stale && !spent);
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return (
    <View style={styles.commit}>
      {spent ? null : (
        <Reanimated.View
          exiting={fadeOut()}
          pointerEvents="none"
          style={styles.ring}
        >
          <ExpiryRing
            size={RING}
            expiresAt={expiresAt}
            createdAt={createdAt}
            test={test}
          />
        </Reanimated.View>
      )}
      <View style={styles.control}>
        {refresh ? (
          <QuoteRefresh ref={ref} onPress={onRefreshQuote} busy={busy} />
        ) : gated ? (
          <CircleControl
            ref={ref}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={copy.send.stale}
            onPress={onRefresh}
            stale
          />
        ) : (
          <HoldButton
            ref={ref}
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{
              text: spent
                ? summary
                : `${summary} ${copy.send.quoteExpires(left)}`,
            }}
            onCommit={onCommit}
            warning={warning}
            busy={busy || spent}
            test={test}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  commit: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', top: 0, left: 0 },
  control: { position: 'absolute' },
});
