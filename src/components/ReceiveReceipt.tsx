import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ReceiveStatus } from '@beignet/wallet-core';
import { Body, Card, Notice, Row } from './ui';
import { MASK, amountIn, colors, space, type } from '../theme';
import type { Unit } from '../theme';

export function ReceiveReceipt({
  status,
  amountSats,
  hidden = false,
  unit = 'sats',
}: {
  status: ReceiveStatus;
  amountSats: number | null;
  hidden?: boolean;
  unit?: Unit;
}) {
  const completed = status.phase === 'completed';
  const sats = (value: number) => {
    const amount = amountIn(value, unit);
    return hidden ? MASK : `${amount.value} ${amount.suffix}`;
  };
  return (
    <View accessibilityLiveRegion="polite" style={styles.stack}>
      <Text style={styles.title}>
        {completed
          ? 'Payment received.'
          : status.phase === 'partial'
          ? 'Part of it is here.'
          : 'Payment detected.'}
      </Text>
      <Notice
        kind={completed ? 'success' : 'info'}
        icon={completed ? 'check' : 'clock'}
      >
        {completed
          ? `${sats(status.receivedSats)} received.`
          : status.phase === 'partial'
          ? `${sats(status.receivedSats)} received so far${
              amountSats != null ? ` of ${sats(amountSats)} requested` : ''
            }.`
          : 'Waiting for confirmation. The sender does not need to pay again.'}
      </Notice>
      <Card>
        <Row label="Received" value={sats(status.receivedSats)} />
        {status.method === 'bitcoin' ? (
          <>
            <Row label="Confirmed" value={sats(status.confirmedSats)} />
            <Row label="Confirming" value={sats(status.pendingSats)} />
          </>
        ) : null}
        {status.txids.map(txid => (
          <Row key={txid} label="Transaction" value={txid} mono />
        ))}
      </Card>
      {status.phase === 'partial' ? (
        <Body>Less than requested. Check with the sender.</Body>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  title: { ...type.title, fontSize: 28, lineHeight: 34, color: colors.text },
});
