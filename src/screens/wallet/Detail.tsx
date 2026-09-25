import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Activity } from '@beignet/wallet-core';
import { Card, Icon, Notice, Row, Title } from '../../components/ui';
import {
  MASK,
  amountIn,
  colors,
  dateLabel,
  radius,
  space,
  type as typography,
} from '../../theme';
import type { Unit } from '../../theme';
import { ReceiveReceipt } from '../../components/ReceiveReceipt';
import { ReceiveRequestDetails } from '../../components/ReceiveRequestDetails';
import { CopyValue } from '../../components/CopyValue';
import type { WalletAdapter } from '../../services/wallet';
import { activityStatus } from '../../scenes/activity/model';

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
  // A hidden balance stays hidden here too; tapping a row must not be the
  // way around the mask. References keep showing, they are not amounts.
  const amount = amountIn(item.amountSats, unit);
  const fee = amountIn(item.feeSats, unit);
  const receipt =
    item.receiveStatus && item.receiveStatus.phase !== 'waiting'
      ? item.receiveStatus
      : null;
  return (
    <View style={styles.stack}>
      <View style={styles.detailIcon}>
        <Icon
          name={
            item.kind === 'received'
              ? 'arrowDown'
              : item.kind === 'sent'
              ? 'arrowUp'
              : 'activity'
          }
          color={colors.primary}
          size={28}
        />
      </View>
      <Title>{item.title}</Title>
      <Text style={styles.detailAmount}>
        {hidden ? MASK : amount.value}{' '}
        <Text style={styles.detailUnit}>{amount.suffix}</Text>
      </Text>
      {item.receiveStatusUnavailable &&
      item.receiveRequest?.bitcoinTracking !== 'ambiguous' ? (
        <Notice icon="info">
          Payment status unavailable. Last known result shown.
        </Notice>
      ) : null}
      {receipt ? (
        <ReceiveReceipt
          status={receipt}
          amountSats={item.receiveRequest?.amountSats ?? item.amountSats}
          hidden={hidden}
          unit={unit}
        />
      ) : (
        <Notice
          icon={
            item.status === 'completed'
              ? 'check'
              : item.status === 'failed'
              ? 'alert'
              : 'clock'
          }
          kind={
            item.status === 'completed'
              ? 'success'
              : item.status === 'failed'
              ? 'error'
              : 'info'
          }
        >
          {item.status === 'completed'
            ? 'Completed'
            : item.status === 'uncertain'
            ? 'Status unknown. Do not pay again until this is resolved.'
            : item.status === 'pending'
            ? item.kind === 'request'
              ? 'Awaiting payment.'
              : item.kind === 'received'
              ? 'Payment detected. Waiting for confirmation.'
              : 'In progress.'
            : item.status === 'expired'
            ? item.receiveRequest?.legacy
              ? 'Invoice expired. Bitcoin payments appear separately until the original request is linked.'
              : 'Request expired.'
            : 'Payment did not complete.'}
        </Notice>
      )}
      <Card>
        <Row label="Date" value={dateLabel(item.timestamp)} />
        <Row
          label="Amount"
          value={hidden ? MASK : `${amount.value} ${amount.suffix}`}
        />
        <Row
          label={item.feeEstimated ? 'Estimated fee' : 'Fee'}
          value={
            item.feeKnown === false
              ? 'Unavailable'
              : hidden
              ? MASK
              : `${fee.value} ${fee.suffix}`
          }
        />
        <Row label="Status" value={activityStatus(item)} />
        {item.description ? (
          <Row label="Note" value={item.description} />
        ) : null}
      </Card>
      <ReceiveRequestDetails
        item={item}
        client={client}
        onRefresh={onRefresh}
        onBusy={onBusy}
      />
      {item.reference || item.txid || item.paymentHash || item.address ? (
        <Card>
          {item.reference ? (
            <CopyValue label="Reference" value={item.reference} />
          ) : null}
          {item.txid ? (
            <CopyValue label="Transaction" value={item.txid} />
          ) : null}
          {item.paymentHash ? (
            <CopyValue label="Payment hash" value={item.paymentHash} />
          ) : null}
          {item.address ? (
            <CopyValue label="Address" value={item.address} />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  detailIcon: {
    height: 64,
    width: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAmount: {
    ...typography.amount,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailUnit: { ...typography.caption, fontSize: 15, color: colors.muted },
});
