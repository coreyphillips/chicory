import React, { useEffect, useRef, useState } from 'react';
import {
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import type { Activity, ReceiveRequest } from '@beignet/wallet-core';
import { Body, Button, Card, Eyebrow, Field, LinkButton, Notice } from './ui';
import { useNow } from '../services/clock';
import { useToast } from './Toast';
import { colors, fonts, radius, space, type } from '../theme';
import type { WalletAdapter } from '../services/wallet';

export function ReceiveRequestDetails({
  item,
  client,
  onRefresh,
  onBusy,
}: {
  item: Activity;
  client?: WalletAdapter;
  onRefresh?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [original, setOriginal] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<ReceiveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const working = useRef(false);
  const generation = useRef({ active: true });
  const { width } = useWindowDimensions();
  useEffect(() => {
    const lifetime = { active: true };
    generation.current = lifetime;
    return () => {
      lifetime.active = false;
    };
  }, [client, item.id]);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const request =
    item.receiveRequest && !item.receiveRequest.legacy
      ? item.receiveRequest
      : linked || item.receiveRequest;
  // The countdown only runs while there is a request to count down.
  const now = useNow(1000, !!request);
  if (!request) return null;
  const legacy = 'legacy' in request && request.legacy;
  const receipt = item.receiveStatus && item.receiveStatus.phase !== 'waiting';
  const shareable =
    item.kind === 'request' &&
    item.status === 'pending' &&
    request.expiresAt > now &&
    !receipt &&
    !item.receiveStatusUnavailable &&
    request.bitcoinTracking !== 'ambiguous';

  async function link() {
    if (!client || !item.paymentHash || working.current || !original.trim())
      return;
    working.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    try {
      const result = await client.importReceiveRequest(
        original.trim(),
        item.paymentHash,
      );
      if (!current.active) return;
      setLinked(result);
      setOriginal('');
      setLinking(false);
      onRefresh?.();
    } catch (e) {
      if (current.active)
        setError(
          e instanceof Error
            ? e.message
            : 'Could not link the original request.',
        );
    } finally {
      working.current = false;
      if (current.active) setBusy(false);
    }
  }
  return (
    <Card>
      <Eyebrow>
        {legacy ? 'Lightning invoice' : 'Original payment request'}
      </Eyebrow>
      {legacy ? (
        <Body>
          This older request saved only its Lightning invoice. Bitcoin receipts
          appear separately until the original request is linked.
        </Body>
      ) : null}
      {request.bitcoinTracking === 'lightning-only' ? (
        <Body>This request accepts Lightning only.</Body>
      ) : null}
      {request.bitcoinTracking === 'ambiguous' ? (
        <Notice>
          This address was reused. Bitcoin payments cannot be matched to this
          request.
        </Notice>
      ) : null}
      {shareable ? (
        <View
          style={styles.qr}
          accessibilityLabel={
            legacy
              ? 'Lightning invoice QR code'
              : 'Original payment request QR code'
          }
        >
          <QRCode
            value={request.uri}
            size={Math.min(220, Math.max(150, width - 160))}
            quietZone={12}
            backgroundColor={colors.cream}
            color={colors.ink}
          />
        </View>
      ) : null}
      <Text selectable style={styles.request}>
        {request.uri}
      </Text>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button
        label="Share original request"
        icon="share"
        secondary
        disabled={!shareable || busy}
        onPress={() => {
          if (shareable && !working.current)
            Share.share({ message: request.uri }).catch(() =>
              setError('Could not share this request.'),
            );
        }}
      />
      <Button
        label="Copy original request"
        icon="copy"
        secondary
        disabled={!shareable || busy}
        onPress={() => {
          if (shareable && !working.current) {
            Clipboard.setString(request.uri);
            toast('Original request copied', 'success', 'copy');
          }
        }}
      />
      {linked ? (
        <Notice kind="success">
          Original request linked. Its payment status is being refreshed.
        </Notice>
      ) : null}
      {legacy && client && item.paymentHash ? (
        <>
          {!linking ? (
            <LinkButton
              label="Link original request"
              onPress={() => setLinking(true)}
            />
          ) : (
            <>
              <Body>
                Paste the full original bitcoin: request, including its
                Lightning invoice. Chicory checks the invoice and wallet
                address. Without that original request, this link cannot be
                recovered.
              </Body>
              <Field
                label="Original payment request"
                placeholder="bitcoin:…?lightning=…"
                value={original}
                onChangeText={setOriginal}
                multiline
                autoCapitalize="none"
                editable={!busy}
              />
              <Button
                label="Link request"
                onPress={link}
                busy={busy}
                disabled={!original.trim()}
              />
              <LinkButton
                label="Cancel linking"
                disabled={busy}
                onPress={() => {
                  setLinking(false);
                  setOriginal('');
                  setError('');
                }}
              />
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
const styles = StyleSheet.create({
  qr: {
    alignItems: 'center',
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
  },
  request: {
    ...type.micro,
    fontSize: 11,
    lineHeight: 18,
    // 'monospace' is an Android-only alias; iOS silently fell back to the
    // proportional system font for every request string.
    fontFamily: fonts.mono,
    color: colors.text,
    fontWeight: '400',
  },
});
