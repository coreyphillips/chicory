import React, { useRef } from 'react';
import type { ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { copy } from '../../design/copy';
import { ExpiryRing } from '../../glyphs/ExpiryRing';
import { HoldButton } from '../../glyphs/HoldButton';
import type { HoldButtonProps } from '../../glyphs/HoldButton';
import { CONTROL, CircleControl, QuoteRefresh } from './Controls';
import { useFocusOnMount } from './useFocusOnMount';

/** The ring round the hold, at r+8 from the control (REDESIGN.md 5). */
const RING = CONTROL + 16;

/** The hold, which a screen reader moves to as the review arrives. */
function FocusedHold(props: Omit<HoldButtonProps, 'ref'>) {
  const circle = useRef<ComponentRef<typeof View>>(null);
  useFocusOnMount(circle);
  return <HoldButton ref={circle} {...props} />;
}

/**
 * Where a review is committed (REDESIGN.md 5 and 6, Send): the hold inside
 * the quote's ring. The ring stays through the quote running out, so it
 * retracts round the refresh that takes the hold's place. While the balance
 * is too old to spend against, the hold gives way to a dust control whose
 * tap shakes and refreshes the balance instead.
 *
 * Handlers are given only while a tap does something, as the controls on
 * the canvas take them.
 */
export function Commit({
  accessibilityLabel,
  expiresAt,
  createdAt,
  warning,
  expired,
  stale,
  busy,
  onCommit,
  onRefreshQuote,
  onRefresh,
}: {
  accessibilityLabel: string;
  expiresAt: number;
  createdAt: number;
  warning: boolean;
  expired: boolean;
  stale: boolean;
  busy: boolean;
  onCommit: () => void;
  onRefreshQuote?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <View style={styles.commit}>
      <ExpiryRing size={RING} expiresAt={expiresAt} createdAt={createdAt} />
      <View style={styles.control}>
        {expired ? (
          <QuoteRefresh onPress={onRefreshQuote} busy={busy} />
        ) : stale ? (
          <CircleControl
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={copy.send.stale}
            onPress={onRefresh}
            stale
          />
        ) : (
          <FocusedHold
            accessibilityLabel={accessibilityLabel}
            onCommit={onCommit}
            warning={warning}
            busy={busy}
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
