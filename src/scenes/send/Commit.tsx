import React from 'react';
import type { ComponentRef, Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { copy } from '../../design/copy';
import { ExpiryRing } from '../../glyphs/ExpiryRing';
import { HoldButton } from '../../glyphs/HoldButton';
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
  onCommit: () => void;
  onRefreshQuote?: () => void;
  onRefresh?: () => void;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const test = useTestNetwork();
  // Only the words need the second: the ring runs down on its own timing.
  const now = useNow(1000, !expired && !stale);
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return (
    <View style={styles.commit}>
      <ExpiryRing
        size={RING}
        expiresAt={expiresAt}
        createdAt={createdAt}
        test={test}
      />
      <View style={styles.control}>
        {expired ? (
          <QuoteRefresh ref={ref} onPress={onRefreshQuote} busy={busy} />
        ) : stale ? (
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
              text: `${summary} ${copy.send.quoteExpires(left)}`,
            }}
            onCommit={onCommit}
            warning={warning}
            busy={busy}
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
  control: { position: 'absolute' },
});
