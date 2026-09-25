import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import { parseSats } from '@beignet/wallet-core';
import type { ReceiveQuote, ReceiveRequest } from '@beignet/wallet-core';
import {
  Body,
  Button,
  Card,
  Field,
  LinkButton,
  Notice,
  Row,
  Title,
} from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useToast } from '../components/Toast';
import { ReceiveReceipt } from '../components/ReceiveReceipt';
import { useReceiveStatus } from '../services/useReceiveStatus';
import { useNow } from '../services/clock';
import { errorMessage as message } from '../services/useWalletSession';
import { haptic } from '../services/haptics';
import { useEnter } from '../services/motion';
import { colors, number, radius, space, type as typography } from '../theme';
import type { WalletAdapter } from '../services/wallet';

export function ReceiveScreen({
  client,
  receivableSats = 0,
  offlineReceivableSats,
  disabled = false,
  onActivity,
  onRefresh,
  onBusy,
}: {
  client: WalletAdapter;
  receivableSats?: number;
  /**
   * The most an offline receive can take right now, 0 when no channel can
   * hold one. Undefined when the engine does not say.
   */
  offlineReceivableSats?: number;
  /** Set when the wallet's balance is too old to quote against. */
  disabled?: boolean;
  onActivity: () => void;
  onRefresh?: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [capacityChanged, setCapacityChanged] = useState(false);
  // Receiving offline is an opt-in, never the default: the ordinary request
  // is paid over the home channel or provisioned by the primary just in
  // time. The box is offered only when the engine advertises offline
  // receiving; the primary still has to offer settlement, and the engine
  // says so at quote time when it does not.
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let active = true;
    // Read through a promise so a client without the method (the demo
    // client, older hosts) leaves the box off rather than breaking the form.
    Promise.resolve()
      .then(() => client.getConfig())
      .then(config => {
        if (active)
          setOfflineAvailable(config?.offlineReceiveAvailable === true);
      })
      .catch(() => {
        if (active) setOfflineAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  // Nor is it offered when no channel can hold one: an offline receive needs
  // a channel with the primary that holds none of this wallet's balance. An
  // engine that does not say how much fits leaves that to the quote.
  const offlineOffered =
    offlineAvailable &&
    (offlineReceivableSats === undefined || offlineReceivableSats > 0);
  // An amount is needed when the primary has to provide the capacity (a
  // just-in-time receive is quoted on it), when it changed under a quote, and
  // for an offline receive, whose slot holds one fixed amount.
  const amountRequired = receivableSats <= 0 || capacityChanged || offline;
  const [amount, setAmount] = useState('');
  const typedSats = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : 0;
  const overOffline =
    offline &&
    offlineReceivableSats !== undefined &&
    typedSats > offlineReceivableSats;
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
  // Back to the ordinary request when an offline one no longer fits, but only
  // on the form: creating an offline request reserves its channel, which takes
  // the figure to 0 while that request is still on screen.
  useEffect(() => {
    if (step === 'form' && !offlineOffered) setOffline(false);
  }, [step, offlineOffered]);
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
          ...(offline ? { mode: 'offline' as const } : {}),
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
          {offline ? (
            <Notice icon="info">
              Payable while this wallet is closed. Your primary node prepares it
              and settles the payment for you.
            </Notice>
          ) : null}
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
              overOffline
                ? `An offline receive can take up to ${number(
                    offlineReceivableSats ?? 0,
                  )} sats right now.`
                : amountRequired
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
          {offlineOffered ? (
            <View style={styles.optIn}>
              <View style={styles.optInRow}>
                <Text style={styles.optInLabel}>Receive offline</Text>
                <Switch
                  accessibilityLabel="Receive offline"
                  accessibilityHint="Accept this payment even while this wallet is closed."
                  value={offline}
                  disabled={busy}
                  trackColor={{ true: colors.primary, false: colors.line }}
                  thumbColor={colors.text}
                  onValueChange={next => {
                    setOffline(next);
                    setError('');
                  }}
                />
              </View>
              <Text style={styles.optInHint}>
                {offline
                  ? `Accept this payment even while this wallet is closed. Your primary node prepares it, so it has to offer offline settlement. ${
                      offlineReceivableSats === undefined
                        ? 'Enter at least 354 sats.'
                        : `Enter 354 to ${number(offlineReceivableSats)} sats.`
                    }`
                  : 'Off, the request is paid over your channel or provisioned by your primary node just in time.'}
              </Text>
            </View>
          ) : null}
          <Button
            label="Continue"
            icon="arrowDown"
            onPress={price}
            busy={busy}
            disabled={
              disabled || (amountRequired && !amount.trim()) || overOffline
            }
          />
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  optIn: { gap: space.xs },
  optInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs + 2,
    minHeight: 44,
  },
  optInLabel: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  optInHint: { ...typography.caption, color: colors.muted },
  countdown: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
  },
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
