import React, { useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import type { Activity } from '@beignet/wallet-core';
import { ReceiveReceipt } from '../../components/ReceiveReceipt';
import { ReceiveRequestDetails } from '../../components/ReceiveRequestDetails';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { CopyChip } from '../../glyphs/CopyChip';
import { Odometer } from '../../glyphs/Odometer';
import { StatusRing } from '../../glyphs/StatusRing';
import {
  RAIL_GLYPH,
  amountVisual,
  railOf,
  ringVisual,
} from '../../scenes/activity/visual';
import type { AmountVisual } from '../../scenes/activity/visual';
import { ringWords } from '../../scenes/detail/model';
import { lineIn, ringIn } from '../../scenes/detail/motion';
import type { WalletAdapter } from '../../services/wallet';
import {
  MASK,
  amountIn,
  dateLabel,
  space,
  type as typography,
} from '../../theme';
import type { Unit } from '../../theme';

const TONES: Record<AmountVisual['tone'], string> = {
  sage: palette.sage,
  cream: palette.cream,
  steam: palette.steam,
  dust: palette.dust,
};

/**
 * A payment's detail (REDESIGN.md 6, Detail): its ring at 96pt with the kind
 * glyph, the amount at 40pt, then a line for each thing known about it, each
 * led by a glyph (when, the rail and its fee, the note), and a chip for each
 * reference it can copy. A request's receipt and the request itself follow,
 * as Receive draws them.
 *
 * The outcome is the ring's to say: its sentence is what a screen reader
 * hears. An unknown outcome is held honey, announced at once, and never
 * shown as done.
 *
 * A hidden balance stays hidden here too; tapping a row must not be the way
 * around the mask. References keep showing, they are not amounts.
 */
export function DetailScreen({
  item,
  client,
  hidden = false,
  unit = 'sats',
  onRefresh,
  onBusy,
}: {
  item: Activity;
  client?: WalletAdapter;
  hidden?: boolean;
  unit?: Unit;
  onRefresh?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const words = ringWords(item);
  const look = amountVisual(item);
  useHeldOutcome(item);

  const date = dateLabel(item.timestamp);
  const fee = amountIn(item.feeSats, unit);
  const feeUnknown = item.feeKnown === false;
  const feeLabel = feeUnknown
    ? copy.detail.feeUnavailable
    : hidden
    ? copy.detail.feeHidden(!!item.feeEstimated)
    : item.feeEstimated
    ? copy.detail.estimatedFee(item.feeSats)
    : copy.detail.fee(item.feeSats);
  const receipt =
    item.receiveStatus && item.receiveStatus.phase !== 'waiting'
      ? item.receiveStatus
      : null;

  // Each reference once: the engine's reference is usually the txid or the
  // payment hash, which have chips of their own.
  const chips: { label: string; value: string; glyph: GlyphName }[] = [];
  if (
    item.reference &&
    item.reference !== item.txid &&
    item.reference !== item.paymentHash
  ) {
    chips.push({
      label: copy.detail.reference,
      value: item.reference,
      glyph: 'hash',
    });
  }
  if (item.txid) {
    chips.push({
      label: copy.detail.transaction,
      value: item.txid,
      glyph: 'chain',
    });
  }
  if (item.paymentHash) {
    chips.push({
      label: copy.detail.paymentHash,
      value: item.paymentHash,
      glyph: 'bolt',
    });
  }
  if (item.address) {
    chips.push({
      label: copy.detail.address,
      value: item.address,
      glyph: 'pin',
    });
  }

  let line = 0;
  return (
    <View style={styles.stack}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={item.title}
        style={styles.title}
      />
      <View style={styles.header}>
        <Reanimated.View
          entering={ringIn()}
          accessible
          accessibilityRole={words.safety ? 'alert' : undefined}
          accessibilityLabel={words.label}
          accessibilityValue={{ text: words.value }}
          accessibilityLiveRegion={words.safety ? 'assertive' : 'polite'}
        >
          <StatusRing size={96} visual={ringVisual(item)} />
        </Reanimated.View>
        {look.open ? (
          <View accessible accessibilityLabel={copy.amount.any}>
            <Glyph name="infinity" size={48} color={TONES[look.tone]} />
          </View>
        ) : (
          <Odometer
            sats={item.amountSats}
            unit={unit}
            masked={hidden}
            variant="amountDetail"
            color={TONES[look.tone]}
            // A masked amount is the mask alone, as it is in the rows.
            sign={
              hidden
                ? null
                : look.sign === '+'
                ? '+'
                : look.sign === '−'
                ? '-'
                : null
            }
            accessibilityLabel={
              hidden
                ? copy.detail.amountHidden
                : copy.detail.amount(item.amountSats)
            }
          />
        )}
      </View>
      <View style={styles.lines}>
        <Line index={line++} glyph="clock" label={copy.detail.date(date)}>
          <Text style={styles.value}>{date}</Text>
        </Line>
        <Line index={line++} glyph={RAIL_GLYPH[railOf(item)]} label={feeLabel}>
          {feeUnknown ? (
            <Glyph name="question" size={20} color={palette.steam} />
          ) : (
            <>
              {item.feeEstimated ? <Text style={styles.value}>≈</Text> : null}
              <Text style={styles.value}>
                {hidden ? MASK : `${fee.value} ${fee.suffix}`}
              </Text>
            </>
          )}
        </Line>
        {item.description ? (
          <Line
            index={line++}
            glyph="pencil"
            label={copy.detail.note(item.description)}
          >
            <Text style={[styles.value, styles.note]}>{item.description}</Text>
          </Line>
        ) : null}
      </View>
      {receipt ? (
        <Reanimated.View entering={lineIn(line++)}>
          <ReceiveReceipt
            status={receipt}
            amountSats={item.receiveRequest?.amountSats ?? item.amountSats}
            hidden={hidden}
            unit={unit}
          />
        </Reanimated.View>
      ) : null}
      {item.receiveRequest ? (
        <Reanimated.View entering={lineIn(line++)}>
          <ReceiveRequestDetails
            item={item}
            client={client}
            onRefresh={onRefresh}
            onBusy={onBusy}
          />
        </Reanimated.View>
      ) : null}
      {chips.length ? (
        <Reanimated.View entering={lineIn(line++)} style={styles.chips}>
          {chips.map(chip => (
            <CopyChip
              key={chip.label}
              label={chip.label}
              value={chip.value}
              glyph={chip.glyph}
            />
          ))}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/**
 * An unknown outcome is a safety state (REDESIGN.md rule 4): a screen reader
 * hears it at once whenever the detail shows one, and a payment that turns
 * uncertain while its detail is open is felt, too.
 */
function useHeldOutcome(item: Activity) {
  const uncertain = item.status === 'uncertain';
  const was = useRef(uncertain);
  useEffect(() => {
    if (uncertain) announce(copy.detail.uncertain, { assertive: true });
    if (uncertain && !was.current) haptics.held();
    was.current = uncertain;
  }, [uncertain]);
}

/**
 * One thing known about the payment: a glyph for what it is, then its value.
 * A screen reader hears the words the value used to sit beside.
 */
function Line({
  index,
  glyph,
  label,
  children,
}: PropsWithChildren<{ index: number; glyph: GlyphName; label: string }>) {
  const [entering] = useState(() => lineIn(index));
  return (
    <Reanimated.View
      entering={entering}
      accessible
      accessibilityLabel={label}
      style={styles.line}
    >
      <Glyph name={glyph} size={20} color={palette.dust} />
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  // A point rather than nothing: a screen reader passes over an element with
  // no size at all.
  title: { position: 'absolute', top: 0, left: 0, width: 1, height: 1 },
  header: { alignItems: 'center', gap: space.sm, paddingTop: space.xs },
  lines: { gap: space.xs },
  line: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  value: { ...typography.row, color: palette.cream },
  note: { flex: 1, color: palette.steam },
  chips: { gap: space.xs },
});
