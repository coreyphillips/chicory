import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { parsePayment, parseSats } from '@beignet/wallet-core';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import {
  Body,
  Button,
  Card,
  Field,
  Icon,
  Notice,
  Row,
  Title,
} from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useToast } from '../components/Toast';
import { Scanner } from '../components/Scanner';
import { useNow } from '../services/clock';
import { errorMessage as message } from '../services/useWalletSession';
import { haptic } from '../services/haptics';
import { useEnter } from '../services/motion';
import {
  colors,
  compact,
  number,
  radius,
  space,
  statusLabel,
  type as typography,
} from '../theme';
import type { WalletAdapter } from '../services/wallet';

/**
 * The amount a payment request fixes, or null when it leaves it to the payer.
 * The same precedence prepareSend applies: the request's own amount, else the
 * amount of the Lightning invoice a Bitcoin link carries.
 */
function fixedAmount(request: string): number | null {
  let parsed;
  try {
    parsed = parsePayment(request.trim());
  } catch {
    return null;
  }
  const sats =
    parsed.kind === 'bolt11' || parsed.kind === 'bolt12'
      ? parsed.amountSats
      : parsed.kind === 'onchain'
      ? parsed.amountSats ??
        (parsed.lightning && 'amountSats' in parsed.lightning
          ? parsed.lightning.amountSats
          : null)
      : null;
  return typeof sats === 'number' && sats > 0 ? sats : null;
}

export function SendScreen({
  client,
  initialRequest = '',
  disabled = false,
  onActivity,
  onRefresh,
  onBusy,
  initialScanning = false,
}: {
  client: WalletAdapter;
  /** Prefilled by a scanned code or a bitcoin:/lightning: link. Never auto-sent. */
  initialRequest?: string;
  /** Set when the wallet's balance is too old to spend against. */
  disabled?: boolean;
  onActivity: () => void;
  onRefresh: () => void;
  onBusy: (busy: boolean) => void;
  /** Open straight onto the camera, as the home screen's scan button does. */
  initialScanning?: boolean;
}) {
  const [request, setRequest] = useState(initialRequest);
  // The camera is a view inside this screen, not a separate sheet, so a typed
  // request or amount survives a scan that is cancelled or replaces it.
  const [scanning, setScanning] = useState(initialScanning);
  const [amount, setAmount] = useState('');
  // A request that names its amount sets the field and locks it, so the
  // amount cannot be changed by accident. What was typed stays for a request
  // that names none.
  const fixedSats = useMemo(() => fixedAmount(request), [request]);
  const [review, setReview] = useState<SendReview | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (initialRequest) setRequest(initialRequest);
  }, [initialRequest]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const sending = useRef(false);
  // Only a review has a deadline to count down. Without one there is nothing
  // on this screen that changes with the clock, and ticking anyway re-rendered
  // the whole compose form once a second while someone was typing into it.
  const now = useNow(1000, review !== null);
  const expired = review !== null && now >= review.expiresAt;
  const step = result ? 'result' : review ? 'review' : 'compose';
  const enter = useEnter(step);

  async function prepare() {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      setReview(
        await client.prepareSend({
          request: request.trim(),
          amountSats:
            fixedSats === null && amount.trim() ? parseSats(amount) : undefined,
        }),
      );
    } catch (e) {
      haptic('error');
      setError(message(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function pay() {
    if (!review || sending.current || expired) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const outcome = await client.send(review);
      haptic(outcome.status === 'completed' ? 'success' : 'warning');
      setResult(outcome);
      setReview(null);
      onRefresh();
    } catch (e) {
      haptic('error');
      setError(message(e));
      setReview(null);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (scanning) {
    return (
      <Scanner
        onDetected={value => {
          setRequest(value);
          setError('');
          setScanning(false);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  if (result) {
    const completed = result.status === 'completed';
    return (
      <Animated.View style={[styles.stack, enter]}>
        <View style={styles.resultStage}>
          <View style={[styles.resultIcon, completed && styles.resultSuccess]}>
            <Icon
              name={completed ? 'check' : 'clock'}
              color={completed ? colors.ink : colors.primary}
              size={32}
            />
          </View>
        </View>
        <Title>
          {completed
            ? 'Sent.'
            : result.status === 'uncertain'
            ? 'Result unknown.'
            : result.status === 'failed'
            ? 'Payment failed.'
            : 'Payment on its way.'}
        </Title>
        <Text style={styles.amount}>
          {number(result.amountSats)} <Text style={styles.unit}>sats</Text>
        </Text>
        <Notice
          kind={completed ? 'success' : 'info'}
          icon={completed ? 'check' : 'info'}
        >
          {result.message}
        </Notice>
        {result.status === 'uncertain' ? (
          <Body>Check Activity before paying this request again.</Body>
        ) : null}
        <Card>
          <Row label="Status" value={statusLabel(result.status)} />
          <Row
            label={result.feeEstimated ? 'Reviewed fee' : 'Fee paid'}
            value={
              result.feeKnown === false
                ? 'Unavailable'
                : `${number(result.feeSats)} sats`
            }
          />
          {result.txid || result.paymentHash ? (
            <Row
              label="Reference"
              value={compact(result.txid || result.paymentHash || '')}
              mono
            />
          ) : null}
        </Card>
        <Button label="View activity" onPress={onActivity} />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.stack, enter]}>
      <Title>{review ? 'Review' : 'Send'}</Title>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      {disabled && !review ? (
        <Notice kind="warning" icon="clock">
          Balance not confirmed recently. Refresh before sending.
        </Notice>
      ) : null}
      {review ? (
        <>
          <Text style={styles.amount}>
            {number(review.amountSats)} <Text style={styles.unit}>sats</Text>
          </Text>
          <Card>
            <Row label="To" value={compact(review.destination)} mono />
            {review.method === 'direct-funding' ? (
              <Row label="Method" value="Direct funding" />
            ) : null}
            {review.description ? (
              <Row label="For" value={review.description} />
            ) : null}
            {review.estimatedFeeSats != null ? (
              <Row
                label="Expected routing fee"
                value={`about ${number(review.estimatedFeeSats)} sats`}
              />
            ) : null}
            <Row
              label={review.feeLabel || 'Fee'}
              value={`${number(review.feeSats)} sats`}
            />
            <Row
              label={
                review.estimatedFeeSats != null
                  ? 'Total, at most'
                  : 'Total including fee'
              }
              value={`${number(review.totalSats)} sats`}
            />
          </Card>
          {review.warnings.map((warning, i) => (
            <Notice key={i} icon="info">
              {warning}
            </Notice>
          ))}
          <Text style={styles.countdown}>
            {expired
              ? 'Quote expired. Review again.'
              : `Fee quote expires in ${Math.max(
                  0,
                  Math.ceil((review.expiresAt - now) / 1000),
                )}s`}
          </Text>
          <Button
            label={`Send ${number(review.amountSats)} sats`}
            icon="arrowUp"
            onPress={pay}
            busy={busy}
            disabled={expired}
          />
          <Button
            label={expired ? 'Refresh quote' : 'Edit payment'}
            secondary
            onPress={() => {
              setReview(null);
              setError('');
              // A fresh quote for the same request, without retyping it.
              if (expired) prepare();
            }}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Field
            label="Payment request or address"
            placeholder="Paste a request here"
            value={request}
            onChangeText={setRequest}
            autoCapitalize="none"
            multiline
            editable={!busy}
          />
          <View style={styles.entryActions}>
            <View style={styles.entryAction}>
              <Button
                secondary
                icon="copy"
                label="Paste"
                disabled={busy}
                accessibilityLabel="Paste from clipboard"
                onPress={() => {
                  Clipboard.getString()
                    .then(value => {
                      const pasted = value?.trim();
                      if (!pasted) {
                        toast('The clipboard is empty.', 'error');
                        return;
                      }
                      setRequest(pasted);
                      toast('Request pasted', 'success', 'copy');
                    })
                    .catch(e => setError(message(e)));
                }}
              />
            </View>
            <View style={styles.entryAction}>
              <Button
                secondary
                icon="scan"
                label="Scan"
                disabled={busy}
                accessibilityLabel="Scan a payment request"
                onPress={() => setScanning(true)}
              />
            </View>
          </View>
          <AmountField
            label="Amount in sats"
            value={fixedSats === null ? amount : String(fixedSats)}
            onChangeText={setAmount}
            placeholder="0"
            editable={!busy && fixedSats === null}
            hint={
              fixedSats === null ? undefined : 'Set by the payment request.'
            }
          />
          <Button
            label="Review payment"
            icon="arrowUp"
            onPress={prepare}
            busy={busy}
            disabled={!request.trim() || disabled}
          />
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  amount: {
    ...typography.amount,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...typography.caption, fontSize: 16, color: colors.muted },
  countdown: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  entryActions: { flexDirection: 'row', gap: space.xs },
  entryAction: { flex: 1 },
  resultStage: { alignItems: 'flex-start', justifyContent: 'center' },
  resultIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultSuccess: { backgroundColor: colors.mint },
});
