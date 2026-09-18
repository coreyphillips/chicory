import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import { EmbeddedWalletClient, parseSats } from '@beignet/wallet-core';
import type {
  ReceiveQuote,
  ReceiveRequest,
  SendResult,
  SendReview,
} from '@beignet/wallet-core';
import {
  Body,
  Button,
  Card,
  Field,
  Icon,
  LinkButton,
  Notice,
  Row,
  Title,
} from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useToast } from '../components/Toast';
import { ReceiveReceipt } from '../components/ReceiveReceipt';
import { Scanner } from '../components/Scanner';
import { useReceiveStatus } from '../services/useReceiveStatus';
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
          amountSats: amount.trim() ? parseSats(amount) : undefined,
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
            <Row
              label={review.feeLabel || 'Fee'}
              value={`${number(review.feeSats)} sats`}
            />
            <Row
              label="Total including fee"
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
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            editable={!busy}
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

export function ReceiveScreen({
  client,
  receivableSats = 0,
  disabled = false,
  onActivity,
  onRefresh,
  onBusy,
}: {
  client: WalletAdapter;
  receivableSats?: number;
  /** Set when the wallet's balance is too old to quote against. */
  disabled?: boolean;
  onActivity: () => void;
  onRefresh?: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [capacityChanged, setCapacityChanged] = useState(false);
  const amountRequired =
    client instanceof EmbeddedWalletClient ||
    receivableSats <= 0 ||
    capacityChanged;
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [quote, setQuote] = useState<ReceiveQuote | null>(null);
  const [request, setRequest] = useState<ReceiveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enlarged, setEnlarged] = useState(false);
  const amountError = useRef('');
  const toast = useToast();
  useEffect(() => {
    if (receivableSats > 0) {
      setCapacityChanged(false);
      const previousAmountError = amountError.current;
      if (previousAmountError)
        setError(previous =>
          previous === previousAmountError ? '' : previous,
        );
      amountError.current = '';
    }
  }, [receivableSats]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const { width } = useWindowDimensions();
  const working = useRef(false);
  const tracking = useReceiveStatus(client, request, onRefresh || (() => {}));
  const receipt =
    tracking?.status && tracking.status.phase !== 'waiting'
      ? tracking.status
      : null;
  // Same as the send sheet: the clock is only read by the two expiry checks
  // below, so it runs only while there is something that can expire.
  const now = useNow(1000, !!request || !!quote);
  const expired = request
    ? now >= request.expiresAt
    : quote
    ? now >= quote.expiresAt
    : false;
  const step = receipt
    ? 'receipt'
    : request
    ? 'request'
    : quote
    ? 'quote'
    : 'form';
  const enter = useEnter(step);
  const celebrated = useRef(false);
  useEffect(() => {
    if (receipt && !celebrated.current) {
      celebrated.current = true;
      haptic(receipt.phase === 'completed' ? 'success' : 'light');
    }
  }, [receipt]);

  async function price() {
    if (working.current || (amountRequired && !amount.trim())) {
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      setQuote(
        await client.quoteReceive({
          amountSats: amount.trim() ? parseSats(amount) : undefined,
          description: description.trim(),
        }),
      );
    } catch (e) {
      const needsAmount = (e as { code?: string })?.code === 'AMOUNT_REQUIRED';
      amountError.current = needsAmount ? message(e) : '';
      if (needsAmount) setCapacityChanged(true);
      haptic('error');
      setError(message(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (!quote || working.current || expired) {
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      setRequest(await client.receive(quote));
      setQuote(null);
      onRefresh?.();
    } catch (e) {
      haptic('error');
      setError(message(e));
      setQuote(null);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const qrSize = Math.min(240, Math.max(150, width - 120));
  return (
    <Animated.View style={[styles.stack, enter]}>
      {!receipt ? (
        <Title>
          {tracking?.ambiguous
            ? 'Check Activity.'
            : request
            ? 'Your request'
            : 'Receive'}
        </Title>
      ) : null}
      {!receipt && tracking?.ambiguous ? (
        <Body>The original request is saved in Activity.</Body>
      ) : null}
      {!receipt && request?.bitcoinTracking === 'lightning-only' ? (
        <Body>This request accepts Lightning only.</Body>
      ) : null}
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      {tracking?.error ? <Notice icon="info">{tracking.error}</Notice> : null}
      {request ? (
        <>
          {receipt ? (
            <>
              <View style={styles.receiptStage}>
                <ReceiveReceipt
                  status={receipt}
                  amountSats={request.amountSats}
                />
              </View>
              <Button label="View activity" onPress={onActivity} />
            </>
          ) : (
            <>
              {tracking?.ambiguous ? (
                <Notice icon="alert">
                  This address belongs to more than one request. Create a new
                  request before sharing again.
                </Notice>
              ) : expired ? (
                <Notice kind="error" icon="clock">
                  This request has expired. Create a fresh request before asking
                  someone to pay.
                </Notice>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessible
                  accessibilityLabel="Payment request QR code"
                  accessibilityHint="Shows the code larger, so it is easier to scan."
                  onPress={() => setEnlarged(true)}
                  style={styles.qrCard}
                >
                  <QRCode
                    value={request.uri}
                    size={qrSize}
                    quietZone={14}
                    ecl="M"
                    backgroundColor={colors.cream}
                    color={colors.ink}
                  />
                  <Text style={styles.qrAmount}>
                    {request.amountSats
                      ? `${number(request.amountSats)} sats`
                      : 'Any amount'}
                  </Text>
                  {request.description ? (
                    <Text style={styles.qrNote}>{request.description}</Text>
                  ) : null}
                </Pressable>
              )}
              <Text style={styles.countdown}>
                {expired
                  ? 'Expired'
                  : `Request expires in ${Math.ceil(
                      Math.max(0, request.expiresAt - now) / 60000,
                    )} minutes`}
              </Text>
              {request.offlineReceive && !expired ? (
                <Body>
                  You can close your wallet. Payments will appear when you
                  reopen it.
                </Body>
              ) : null}
              {request.warnings.map((warning, i) => (
                <Notice key={i} icon="info">
                  {warning}
                </Notice>
              ))}
              <Button
                label="Share request"
                icon="share"
                disabled={expired || tracking?.ambiguous}
                onPress={() => {
                  Share.share({ message: request.uri }).catch(e =>
                    setError(message(e)),
                  );
                }}
              />
              <Button
                label="Copy request"
                icon="copy"
                secondary
                disabled={expired || tracking?.ambiguous}
                onPress={() => {
                  Clipboard.setString(request.uri);
                  toast('Request copied', 'success', 'copy');
                }}
              />
            </>
          )}
          <LinkButton
            label={
              receipt?.phase === 'partial'
                ? 'Request the remaining amount'
                : 'Create another request'
            }
            onPress={() => {
              setRequest(null);
              setCapacityChanged(false);
              setError('');
              celebrated.current = false;
              setAmount(
                receipt?.phase === 'partial' && request.amountSats != null
                  ? String(
                      Math.max(0, request.amountSats - receipt.receivedSats),
                    )
                  : '',
              );
              if (receipt?.phase !== 'partial') setDescription('');
            }}
          />
          <Modal
            visible={enlarged}
            transparent
            animationType="fade"
            onRequestClose={() => setEnlarged(false)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close enlarged QR code"
              style={styles.enlargeBackdrop}
              onPress={() => setEnlarged(false)}
            >
              <View style={styles.enlargeCard}>
                <QRCode
                  value={request.uri}
                  size={Math.min(320, width - 72)}
                  quietZone={16}
                  ecl="M"
                  backgroundColor={colors.cream}
                  color={colors.ink}
                />
              </View>
            </Pressable>
          </Modal>
        </>
      ) : quote ? (
        <>
          <Card>
            <Row
              label="Requested"
              value={
                quote.amountSats
                  ? `${number(quote.amountSats)} sats`
                  : 'Sender chooses'
              }
            />
            <Row label="Receive fee" value={`${number(quote.feeSats)} sats`} />
            {quote.amountSats && quote.netSats !== null ? (
              <Row
                label="You receive"
                value={`${number(quote.netSats ?? 0)} sats`}
              />
            ) : null}
          </Card>
          {quote.warnings.map((warning, i) => (
            <Notice key={i} icon="info">
              {warning}
            </Notice>
          ))}
          {expired ? (
            <Notice icon="clock">Quote expired. Review again.</Notice>
          ) : null}
          <Button
            label="Create request"
            icon="arrowDown"
            onPress={create}
            busy={busy}
            disabled={expired}
          />
          <Button
            label={expired ? 'Refresh quote' : 'Edit amount'}
            secondary
            onPress={() => {
              setQuote(null);
              if (expired) price();
            }}
            disabled={busy}
          />
        </>
      ) : (
        <>
          {disabled ? (
            <Notice kind="warning" icon="clock">
              Balance not confirmed recently. Refresh before creating a request.
            </Notice>
          ) : null}
          <AmountField
            value={amount}
            onChangeText={setAmount}
            placeholder={amountRequired ? 'Enter an amount' : 'Any amount'}
            presets={[1000, 10000, 50000]}
            editable={!busy}
            hint={
              amountRequired
                ? 'Enter an amount for your payment request.'
                : undefined
            }
          />
          <Field
            label="Note · optional"
            placeholder="Dinner, a coffee, just because…"
            value={description}
            onChangeText={setDescription}
            maxLength={180}
            editable={!busy}
          />
          <Button
            label="Continue"
            icon="arrowDown"
            onPress={price}
            busy={busy}
            disabled={disabled || (amountRequired && !amount.trim())}
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
  receiptStage: { position: 'relative' },
  qrCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.xxl,
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
  },
  qrAmount: {
    ...typography.heading,
    fontSize: 26,
    color: colors.ink,
  },
  qrNote: {
    ...typography.caption,
    color: colors.creamInk,
    textAlign: 'center',
  },
  enlargeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  enlargeCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.xxl,
    padding: space.xl,
  },
});
