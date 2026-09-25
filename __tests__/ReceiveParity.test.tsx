import React from 'react';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import { AccessibilityInfo, AppState, Platform, Text } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type {
  Activity,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { ToastProvider, useToast } from '../src/components/Toast';
import { copy } from '../src/design/copy';
import { haptics } from '../src/design/haptics';
import { CopiedGlyph, CopyChip } from '../src/glyphs/CopyChip';
import {
  BANDS,
  FINDERS,
  layerMotion,
  leaveMs,
  qrLayers,
  qrModules,
  scatterOffset,
} from '../src/glyphs/QrBloom';
import type { QrState } from '../src/glyphs/QrBloom';
import {
  OFFLINE_MIN_SATS,
  ORBIT_SHARE,
  amountCue,
  detailFace,
  feeGlyph,
  lateAt,
  petalPose,
  receiptRing,
  receiptTransactions,
  remainderSats,
  requestFace,
} from '../src/scenes/receive/model';
import { ReceiveScreen } from '../src/screens/Payments';
import { DetailScreen, activityStatus } from '../src/screens/Wallet';
import { recentDiagnostics } from '../src/services/diagnosticLog';
import { useReceiveStatus } from '../src/services/useReceiveStatus';
import type { WalletAdapter } from '../src/services/wallet';
import { amountValue, enterAmount } from '../test-support/keypad';
import { alerts, find, meaning, visibleText } from '../test-support/query';

const request: ReceiveRequest = {
  id: 'r1',
  uri: 'bitcoin:bcrt1address?lightning=lnbcrt1invoice',
  address: 'bcrt1address',
  bolt11: 'lnbcrt1invoice',
  paymentHash: 'ab'.repeat(32),
  amountSats: 1000,
  description: 'Coffee',
  feeSats: 0,
  expiresAt: Date.now() + 60000,
  warnings: [],
  demo: false,
  bitcoinTracking: 'unique',
};
const waiting: ReceiveStatus = {
  phase: 'waiting',
  receivedSats: 0,
  confirmedSats: 0,
  pendingSats: 0,
  txids: [],
};
const pending: ReceiveStatus = {
  phase: 'pending',
  receivedSats: 1000,
  confirmedSats: 0,
  pendingSats: 1000,
  txids: ['tx-one'],
  method: 'bitcoin',
};
const partial: ReceiveStatus = {
  ...pending,
  phase: 'partial',
  receivedSats: 400,
  pendingSats: 400,
};
const quote = {
  id: 'q1',
  amountSats: 1000,
  description: 'Coffee',
  feeSats: 0,
  netSats: 1000,
  expiresAt: Date.now() + 60000,
  warnings: [],
};
const activity: Activity = {
  id: 'request-r1',
  kind: 'request',
  title: 'Coffee',
  description: 'Coffee',
  amountSats: 1000,
  feeSats: 0,
  status: 'pending',
  timestamp: Date.now(),
  reference: request.bolt11,
  paymentHash: request.paymentHash,
  receiveRequest: request,
};
const adapter = (value: object) => value as WalletAdapter;
const noop = () => {};
const press = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onPress === 'function')!;
const field = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onChangeText === 'function')!;
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
/** Whether the control labelled `label` reads as disabled. */
const disabled = (tree: ReactTestRenderer, label: string) =>
  !!press(tree, label).props.accessibilityState?.disabled;
/** The offline receive switch, read from its state rather than its paint. */
const offlineSwitch = (tree: ReactTestRenderer) =>
  tree.root.findByProps({ accessibilityLabel: 'Receive offline' });
const openNote = (tree: ReactTestRenderer) =>
  act(async () => press(tree, copy.receive.addNote).props.onPress());

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
});
afterEach(() => {
  jest.useRealTimers();
});

test('zero inbound capacity blocks blank amount locally and preserves the fee-review step', async () => {
  const quoteReceive = jest.fn().mockResolvedValue(quote);
  const receive = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={adapter({ quoteReceive, receive })}
        receivableSats={0}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  // The amount cue asks for an amount: a sprout, not the infinity.
  expect(meaning(tree)).toContain(copy.amount.required);
  expect(meaning(tree)).not.toContain(copy.amount.any);
  expect(disabled(tree, 'Continue')).toBe(true);
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(quoteReceive).not.toHaveBeenCalled();
  await enterAmount(tree, '1000');
  expect(disabled(tree, 'Continue')).toBe(false);
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(quoteReceive).toHaveBeenCalledWith({
    amountSats: 1000,
    description: '',
  });
  expect(receive).not.toHaveBeenCalled();
  // The fee is reviewed before anything is created.
  expect(find(tree, 'Create request')).toBeDefined();
  await act(async () => tree.unmount());
});

test('amountless is available with inbound capacity; stale-capacity rejection keeps the note and asks for amount', async () => {
  const quoteReceive = jest.fn().mockRejectedValue(
    Object.assign(new Error('Set an amount for a liquidity quote.'), {
      code: 'AMOUNT_REQUIRED',
    }),
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={adapter({ quoteReceive })}
        receivableSats={10000}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  expect(meaning(tree)).toContain(copy.amount.any);
  expect(disabled(tree, 'Continue')).toBe(false);
  await openNote(tree);
  await act(async () => {
    field(tree, 'Note · optional').props.onChangeText('Lunch');
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(quoteReceive).toHaveBeenCalledWith({
    amountSats: undefined,
    description: 'Lunch',
  });
  expect(field(tree, 'Note · optional').props.value).toBe('Lunch');
  expect(disabled(tree, 'Continue')).toBe(true);
  expect(meaning(tree)).toContain(copy.amount.required);
  await act(async () => tree.unmount());
});

async function showRequest(
  statuses: ReceiveStatus[],
  createdRequest: ReceiveRequest = request,
) {
  const getReceiveStatus = jest.fn();
  for (const status of statuses) getReceiveStatus.mockResolvedValueOnce(status);
  getReceiveStatus.mockResolvedValue(statuses[statuses.length - 1]);
  const onRefresh = jest.fn();
  const client = adapter({
    quoteReceive: jest.fn().mockResolvedValue(quote),
    receive: jest.fn().mockResolvedValue(createdRequest),
    getReceiveStatus,
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={client}
        receivableSats={10000}
        onActivity={noop}
        onBusy={noop}
        onRefresh={onRefresh}
      />,
    );
  });
  await enterAmount(tree, '1000');
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  return { tree, getReceiveStatus, onRefresh };
}

test('exact pending receipt dismisses QR/share and advances to confirmation without another payment', async () => {
  const { tree, onRefresh, getReceiveStatus } = await showRequest([
    waiting,
    pending,
    { ...pending, phase: 'completed', confirmedSats: 1000, pendingSats: 0 },
  ]);
  expect(meaning(tree)).toContain('Payment request QR code');
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(meaning(tree)).toContain('Payment detected.');
  expect(meaning(tree)).toContain('sender does not need to pay again');
  expect(text(tree)).not.toContain('Payment request QR code');
  expect(press(tree, 'Share request')).toBeUndefined();
  expect(press(tree, 'Copy request')).toBeUndefined();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(meaning(tree)).toContain('Payment received.');
  expect(onRefresh).toHaveBeenCalledTimes(3); // created, detected, confirmed
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(getReceiveStatus).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
});

test('partial receipt hides QR and only prefills the exact unpaid remainder for a new quote', async () => {
  const { tree } = await showRequest([partial]);
  expect(meaning(tree)).toContain('Part of it is here.');
  expect(meaning(tree)).toContain(
    '400 sats received so far of 1,000 sats requested.',
  );
  expect(text(tree)).not.toContain('Payment request QR code');
  expect(press(tree, 'Share request')).toBeUndefined();
  await act(async () =>
    press(tree, 'Request the remaining amount').props.onPress(),
  );
  expect(amountValue(tree)).toBe('600');
  expect(text(tree)).not.toContain('Part of it is here.');
  await act(async () => tree.unmount());
});

function Watch({
  client,
  active,
}: {
  client: WalletAdapter;
  active: ReceiveRequest | null;
}) {
  const result = useReceiveStatus(client, active, noop);
  return <Text>{JSON.stringify(result?.status || result?.error || null)}</Text>;
}
test('tracking ignores a replaced request response, never overlaps, and pauses in background', async () => {
  let resolve!: (value: ReceiveStatus) => void;
  const getReceiveStatus = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    )
    .mockResolvedValue(waiting);
  const client = adapter({ getReceiveStatus });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Watch client={client} active={request} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  expect(getReceiveStatus).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.update(<Watch client={client} active={{ ...request, id: 'r2' }} />);
  });
  await act(async () => {
    resolve(pending);
  });
  expect(text(tree)).toContain('waiting');
  expect(text(tree)).not.toContain('tx-one');
  AppState.currentState = 'background';
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  expect(getReceiveStatus).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});

test('ambiguous-address error clears an earlier Bitcoin receipt rather than reporting success', async () => {
  const getReceiveStatus = jest
    .fn()
    .mockResolvedValueOnce(partial)
    .mockRejectedValue(
      Object.assign(new Error('Reused address'), {
        code: 'AMBIGUOUS_RECEIVE_ADDRESS',
      }),
    );
  const client = adapter({ getReceiveStatus });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Watch client={client} active={request} />);
  });
  expect(text(tree)).toContain('partial');
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(text(tree)).toContain('address was reused');
  expect(text(tree)).not.toContain('tx-one');
  await act(async () => tree.unmount());
});

test('activity detail restores the exact saved QR and archives it when paid or ambiguous', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<DetailScreen item={activity} />);
  });
  expect(
    tree.root.findAllByProps({ value: request.uri }).length,
  ).toBeGreaterThan(0);
  expect(meaning(tree)).toContain('Original payment request QR code');
  expect(disabled(tree, 'Share original request')).toBe(false);
  await act(async () => {
    tree.update(
      <DetailScreen
        item={{
          ...activity,
          status: 'completed',
          kind: 'received',
          receiveStatus: { ...pending, phase: 'completed' },
        }}
      />,
    );
  });
  expect(text(tree)).not.toContain('Original payment request QR code');
  expect(meaning(tree)).toContain(request.uri);
  // A paid request can no longer be shared or copied at all.
  expect(press(tree, 'Share original request')).toBeUndefined();
  expect(press(tree, 'Copy original request')).toBeUndefined();
  await act(async () => {
    tree.update(
      <DetailScreen
        item={{
          ...activity,
          receiveRequest: { ...request, bitcoinTracking: 'ambiguous' },
        }}
      />,
    );
  });
  expect(meaning(tree)).toContain('address was reused');
  expect(text(tree)).not.toContain('Original payment request QR code');
  expect(press(tree, 'Share original request')).toBeUndefined();
  expect(press(tree, 'Copy original request')).toBeUndefined();
  await act(async () => tree.unmount());
});

test('legacy import binds the original URI to the selected invoice and leaves mismatch errors recoverable', async () => {
  const importReceiveRequest = jest
    .fn()
    .mockRejectedValueOnce(
      new Error('The original request belongs to another invoice.'),
    )
    .mockResolvedValue(request);
  const onRefresh = jest.fn();
  const legacy: Activity = {
    ...activity,
    status: 'expired',
    receiveRequest: {
      ...request,
      uri: request.bolt11,
      address: undefined,
      legacy: true,
    },
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <DetailScreen
        item={legacy}
        client={adapter({ importReceiveRequest })}
        onRefresh={onRefresh}
      />,
    );
  });
  expect(meaning(tree)).toContain('Invoice expired');
  await act(async () => press(tree, 'Link original request').props.onPress());
  await act(async () =>
    field(tree, 'Original payment request').props.onChangeText(request.uri),
  );
  await act(async () => {
    await press(tree, 'Link request').props.onPress();
  });
  expect(meaning(tree)).toContain('belongs to another invoice');
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => {
    await press(tree, 'Link request').props.onPress();
  });
  expect(importReceiveRequest).toHaveBeenLastCalledWith(
    request.uri,
    request.paymentHash,
  );
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(meaning(tree)).toContain('Original request linked.');
  await act(async () => tree.unmount());
});

test('a payment detail with no request to count down runs no clock', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <DetailScreen item={{ ...activity, receiveRequest: undefined }} />,
    );
  });
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  // Whatever the renderer keeps scheduled on its own is the baseline.
  const idle = jest.getTimerCount();
  await act(async () => {
    tree.update(<DetailScreen item={activity} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(jest.getTimerCount()).toBe(idle + 1);
  await act(async () => tree.unmount());
});

test('pending labels distinguish unpaid requests, confirmation, and partial receipts', () => {
  expect(activityStatus(activity)).toBe('Awaiting payment');
  expect(activityStatus({ ...activity, kind: 'received' })).toBe('Confirming');
  expect(activityStatus({ ...activity, receiveStatus: partial })).toBe(
    'Partially received',
  );
});

test('foreground ambiguity cannot restore a payable QR after detecting a partial Bitcoin receipt', async () => {
  const { tree, getReceiveStatus } = await showRequest([partial]);
  getReceiveStatus.mockRejectedValue(
    Object.assign(new Error('Reused address'), {
      code: 'AMBIGUOUS_RECEIVE_ADDRESS',
    }),
  );
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(meaning(tree)).toContain('address was reused');
  expect(meaning(tree)).toContain('Check Activity.');
  expect(text(tree)).not.toContain('Share this request.');
  expect(text(tree)).not.toContain('Payment request QR code');
  expect(text(tree)).not.toContain('Part of it is here.');
  // Share and copy are gone, not just disabled; a new request is the way on.
  expect(press(tree, 'Share request')).toBeUndefined();
  expect(press(tree, 'Copy request')).toBeUndefined();
  expect(press(tree, 'Create another request')).toBeDefined();
  await act(async () => tree.unmount());
});

test('fresh positive inbound capacity releases a stale amount-required override without losing the draft', async () => {
  const client = adapter({
    quoteReceive: jest.fn().mockRejectedValue(
      Object.assign(new Error('Amount required'), {
        code: 'AMOUNT_REQUIRED',
      }),
    ),
  });
  let tree!: ReactTestRenderer;
  const screen = (receivableSats: number) => (
    <ReceiveScreen
      client={client}
      receivableSats={receivableSats}
      onActivity={noop}
      onBusy={noop}
    />
  );
  await act(async () => {
    tree = create(screen(1000));
  });
  await openNote(tree);
  await act(async () =>
    field(tree, 'Note · optional').props.onChangeText('Keep this note'),
  );
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(disabled(tree, 'Continue')).toBe(true);
  await act(async () => tree.update(screen(0)));
  await act(async () => tree.update(screen(2000)));
  expect(disabled(tree, 'Continue')).toBe(false);
  expect(field(tree, 'Note · optional').props.value).toBe('Keep this note');
  expect(text(tree)).not.toContain('Amount required');
  await act(async () => tree.unmount());
});

test('finishing a legacy import after leaving the detail does not refresh another view', async () => {
  let resolve!: (value: ReceiveRequest) => void;
  const importReceiveRequest = jest.fn().mockImplementation(
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const onRefresh = jest.fn();
  const legacy: Activity = {
    ...activity,
    receiveRequest: {
      ...request,
      uri: request.bolt11,
      address: undefined,
      legacy: true,
    },
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <DetailScreen
        item={legacy}
        client={adapter({ importReceiveRequest })}
        onRefresh={onRefresh}
      />,
    );
  });
  await act(async () => press(tree, 'Link original request').props.onPress());
  await act(async () =>
    field(tree, 'Original payment request').props.onChangeText(request.uri),
  );
  let importing!: Promise<void>;
  await act(async () => {
    importing = press(tree, 'Link request').props.onPress();
  });
  await act(async () => tree.unmount());
  await act(async () => {
    resolve(request);
    await importing;
  });
  expect(onRefresh).not.toHaveBeenCalled();
});

test('starting a new request clears the previous stale-capacity requirement', async () => {
  const quoteReceive = jest
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error('Amount required'), { code: 'AMOUNT_REQUIRED' }),
    )
    .mockResolvedValue(quote);
  const client = adapter({
    quoteReceive,
    receive: jest.fn().mockResolvedValue({ ...request, demo: true }),
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={client}
        receivableSats={1000}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(disabled(tree, 'Continue')).toBe(true);
  await enterAmount(tree, '1000');
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  await act(async () => press(tree, 'Create another request').props.onPress());
  // An empty amount, which a keypad may draw as 0.
  expect(amountValue(tree)).toMatch(/^0*$/);
  expect(disabled(tree, 'Continue')).toBe(false);
  await act(async () => tree.unmount());
});

test('Lightning-only fallback shares the exact invoice and clearly labels its payment method', async () => {
  const lightningOnly: ReceiveRequest = {
    ...request,
    address: undefined,
    uri: request.bolt11,
    bitcoinTracking: 'lightning-only',
    warnings: [
      'Bitcoin fallback is unavailable because the unused address limit was reached.',
    ],
  };
  const { tree, getReceiveStatus } = await showRequest(
    [waiting],
    lightningOnly,
  );
  expect(meaning(tree)).toContain('This request accepts Lightning only.');
  expect(meaning(tree)).toContain('unused address limit');
  expect(
    tree.root.findAllByProps({ value: request.bolt11 }).length,
  ).toBeGreaterThan(0);
  expect(disabled(tree, 'Share request')).toBe(false);
  expect(getReceiveStatus).toHaveBeenCalledWith(lightningOnly);
  await act(async () => tree.unmount());
  let detail!: ReactTestRenderer;
  await act(async () => {
    detail = create(
      <DetailScreen item={{ ...activity, receiveRequest: lightningOnly }} />,
    );
  });
  expect(meaning(detail)).toContain('This request accepts Lightning only.');
  expect(disabled(detail, 'Share original request')).toBe(false);
  await act(async () => detail.unmount());
});

test('embedded offline receiving is an opt-in that requires an amount and confirms the wallet can close', async () => {
  const client = new EmbeddedWalletClient({
    runtime: { request: jest.fn() },
    walletId: 'test',
  });
  client.getConfig = jest
    .fn()
    .mockResolvedValue({ offlineReceiveAvailable: true });
  client.quoteReceive = jest.fn().mockResolvedValue(quote);
  client.receive = jest
    .fn()
    .mockResolvedValue({ ...request, offlineReceive: true });
  client.getReceiveStatus = jest.fn().mockResolvedValue(waiting);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={client}
        receivableSats={100000}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  // Off by default: with inbound capacity the ordinary request needs no
  // amount, and nothing is asked of the offline lane.
  expect(disabled(tree, 'Continue')).toBe(false);
  expect(offlineSwitch(tree).props.accessibilityRole).toBe('switch');
  expect(offlineSwitch(tree).props.accessibilityState.checked).toBe(false);
  await act(async () => press(tree, 'Receive offline').props.onPress());
  expect(offlineSwitch(tree).props.accessibilityState.checked).toBe(true);
  expect(disabled(tree, 'Continue')).toBe(true);
  await enterAmount(tree, '1000');
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(client.quoteReceive).toHaveBeenCalledWith(
    expect.objectContaining({ amountSats: 1000, mode: 'offline' }),
  );
  expect(meaning(tree)).toContain('Payable while this wallet is closed');
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  expect(meaning(tree)).toContain('You can close your wallet');
  await act(async () => tree.unmount());
});

test('the ordinary embedded request never names a receive mode, and the box is absent without engine support', async () => {
  for (const offlineReceiveAvailable of [true, false]) {
    const client = new EmbeddedWalletClient({
      runtime: { request: jest.fn() },
      walletId: 'test',
    });
    client.getConfig = jest.fn().mockResolvedValue({ offlineReceiveAvailable });
    client.quoteReceive = jest.fn().mockResolvedValue(quote);
    client.receive = jest.fn().mockResolvedValue(request);
    client.getReceiveStatus = jest.fn().mockResolvedValue(waiting);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ReceiveScreen
          client={client}
          receivableSats={100000}
          onActivity={noop}
          onBusy={noop}
        />,
      );
    });
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Receive offline' })
        .length > 0,
    ).toBe(offlineReceiveAvailable);
    await enterAmount(tree, '1000');
    await act(async () => {
      await press(tree, 'Continue').props.onPress();
    });
    const input = (client.quoteReceive as jest.Mock).mock.calls[0][0];
    expect(input.amountSats).toBe(1000);
    expect('mode' in input).toBe(false);
    expect(text(tree)).not.toContain('Payable while this wallet is closed');
    await act(async () => tree.unmount());
  }
});

function offlineClient() {
  const client = new EmbeddedWalletClient({
    runtime: { request: jest.fn() },
    walletId: 'test',
  });
  client.getConfig = jest
    .fn()
    .mockResolvedValue({ offlineReceiveAvailable: true });
  client.quoteReceive = jest.fn().mockResolvedValue(quote);
  client.receive = jest
    .fn()
    .mockResolvedValue({ ...request, offlineReceive: true });
  client.getReceiveStatus = jest.fn().mockResolvedValue(waiting);
  return client;
}
const hasOfflineBox = (tree: ReactTestRenderer) =>
  tree.root.findAllByProps({ accessibilityLabel: 'Receive offline' }).length >
  0;

test('the offline box is absent when no channel can hold an offline receive', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={offlineClient()}
        receivableSats={24000}
        offlineReceivableSats={0}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  expect(hasOfflineBox(tree)).toBe(false);
  await act(async () => tree.unmount());
});

test('an offline amount above what a channel can hold is stopped on the form', async () => {
  const client = offlineClient();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={client}
        receivableSats={100000}
        offlineReceivableSats={30000}
        onActivity={noop}
        onBusy={noop}
      />,
    );
  });
  await act(async () => press(tree, 'Receive offline').props.onPress());
  expect(meaning(tree)).toContain('Enter 354 to 30,000 sats.');
  await enterAmount(tree, '30001');
  expect(disabled(tree, 'Continue')).toBe(true);
  expect(meaning(tree)).toContain(
    'An offline receive can take up to 30,000 sats right now.',
  );
  // Below the floor an offline receive cannot be made either.
  await enterAmount(tree, '353');
  expect(disabled(tree, 'Continue')).toBe(true);
  await enterAmount(tree, '30000');
  expect(disabled(tree, 'Continue')).toBe(false);
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(client.quoteReceive).toHaveBeenCalledWith(
    expect.objectContaining({ amountSats: 30000, mode: 'offline' }),
  );
  await act(async () => tree.unmount());
});

test('the offline box turns itself off when the room goes, but not under a request it reserved', async () => {
  const client = offlineClient();
  const screen = (offlineReceivableSats: number) => (
    <ReceiveScreen
      client={client}
      receivableSats={100000}
      offlineReceivableSats={offlineReceivableSats}
      onActivity={noop}
      onBusy={noop}
    />
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screen(30000));
  });
  await act(async () => press(tree, 'Receive offline').props.onPress());
  // On the form, a refresh that finds no room hides the box and drops the
  // choice, so Continue asks for the ordinary request.
  await act(async () => tree.update(screen(0)));
  expect(hasOfflineBox(tree)).toBe(false);
  await enterAmount(tree, '1000');
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect('mode' in (client.quoteReceive as jest.Mock).mock.calls[0][0]).toBe(
    false,
  );
  await act(async () => tree.unmount());

  // Creating the offline request reserves its channel and the figure drops
  // to 0; the request on screen keeps saying it is payable while closed.
  const reserved = offlineClient();
  const reservedScreen = (offlineReceivableSats: number) => (
    <ReceiveScreen
      client={reserved}
      receivableSats={100000}
      offlineReceivableSats={offlineReceivableSats}
      onActivity={noop}
      onBusy={noop}
    />
  );
  await act(async () => {
    tree = create(reservedScreen(30000));
  });
  await act(async () => press(tree, 'Receive offline').props.onPress());
  await enterAmount(tree, '1000');
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  await act(async () => tree.update(reservedScreen(0)));
  expect(meaning(tree)).toContain('You can close your wallet');
  await act(async () => tree.unmount());
});

describe('the safety states on a request', () => {
  const HOUR = 3_600_000;
  // A phrase is spoken again only 2s after it was last spoken, and earlier
  // cases leave their clocks ahead; each case here starts an hour further
  // on, so what it announces is heard.
  let hours = 0;
  beforeEach(() => {
    hours += 1;
    jest.setSystemTime(Date.now() + hours * HOUR);
  });
  afterEach(() => jest.restoreAllMocks());

  const spoken = () =>
    jest.spyOn(
      AccessibilityInfo,
      Platform.OS === 'ios'
        ? 'announceForAccessibilityWithOptions'
        : 'announceForAccessibility',
    );
  const fresh = (over: Partial<ReceiveRequest> = {}): ReceiveRequest => ({
    ...request,
    expiresAt: Date.now() + 60000,
    ...over,
  });
  const qr = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === copy.receive.qr &&
        typeof node.props.onLongPress === 'function',
    )[0];

  async function made(
    created: ReceiveRequest,
    getReceiveStatus = jest.fn().mockResolvedValue(waiting),
    props: Partial<React.ComponentProps<typeof ReceiveScreen>> = {},
  ) {
    const client = adapter({
      quoteReceive: jest
        .fn()
        .mockResolvedValue({ ...quote, expiresAt: Date.now() + 60000 }),
      receive: jest.fn().mockResolvedValue(created),
      getReceiveStatus,
    });
    const onRefresh = jest.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ReceiveScreen
          client={client}
          receivableSats={10000}
          onActivity={noop}
          onBusy={noop}
          onRefresh={onRefresh}
          {...props}
        />,
      );
    });
    await enterAmount(tree, '1000');
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => press(tree, 'Create request').props.onPress());
    return { tree, client, onRefresh };
  }

  test('a reused address scatters the code, takes share and copy away, and says why at once', async () => {
    const said = spoken();
    const warned = jest.spyOn(haptics, 'warning');
    const { tree } = await made(
      fresh(),
      jest.fn().mockRejectedValue(
        Object.assign(new Error(copy.receive.reusedAddress), {
          code: 'AMBIGUOUS_RECEIVE_ADDRESS',
        }),
      ),
    );
    expect(find(tree, 'Share request')).toBeUndefined();
    expect(find(tree, 'Copy request')).toBeUndefined();
    expect(qr(tree)).toBeUndefined();
    expect(meaning(tree)).not.toContain(copy.receive.qr);
    expect(meaning(tree)).toContain(copy.receive.reusedShare);
    // Plus is the one way on, ringed in bloom.
    const again = press(tree, 'Create another request');
    expect(again.props.accessibilityState.disabled).toBe(false);
    const heard = said.mock.calls.map(call => call[0]);
    expect(heard).toContain(
      `${copy.receive.reusedAddress} ${copy.receive.reusedShare}`,
    );
    if (Platform.OS === 'ios') {
      const call = said.mock.calls.find(([spokenText]) =>
        spokenText.includes(copy.receive.reusedShare),
      )!;
      expect(call[1]).toEqual({ queue: false });
    }
    expect(warned).toHaveBeenCalledTimes(1);
    expect(recentDiagnostics().map(entry => entry.code)).toContain(
      'AMBIGUOUS_RECEIVE_ADDRESS',
    );
    await act(async () => tree.unmount());
  });

  test('an expired request dissolves, leaves nothing to share, copy or lift, and says so at once', async () => {
    const said = spoken();
    const warned = jest.spyOn(haptics, 'warning');
    const { tree } = await made(fresh());
    expect(find(tree, 'Share request')).toBeDefined();
    // Lifted while it could be paid, it goes down when it cannot.
    await act(async () => press(tree, copy.receive.qr).props.onPress());
    expect(find(tree, copy.receive.closeQr)).toBeDefined();
    await act(async () => {
      jest.advanceTimersByTime(61000);
    });
    expect(find(tree, 'Share request')).toBeUndefined();
    expect(find(tree, 'Copy request')).toBeUndefined();
    expect(find(tree, copy.receive.closeQr)).toBeUndefined();
    expect(qr(tree)).toBeUndefined();
    expect(meaning(tree)).toContain(copy.receive.expired);
    expect(find(tree, 'Create another request')).toBeDefined();
    expect(said.mock.calls.map(call => call[0])).toContain(
      copy.receive.expired,
    );
    expect(warned).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a lifted code sets down with a tap, and a long press copies it only while it can be paid', async () => {
    const created = fresh();
    const { tree } = await made(created);
    await act(async () => press(tree, copy.receive.qr).props.onPress());
    await act(async () => press(tree, copy.receive.closeQr).props.onPress());
    expect(find(tree, copy.receive.closeQr)).toBeUndefined();
    await act(async () => qr(tree).props.onLongPress());
    expect(Clipboard.setString).toHaveBeenLastCalledWith(created.uri);
    await act(async () => tree.unmount());
  });

  test('a copied request turns its copy control to a check and says so, with nothing written on screen', async () => {
    const said = spoken();
    const created = fresh();
    const { tree } = await made(created);
    const confirmed = () => tree.root.findByType(CopiedGlyph).props.copies;
    expect(confirmed()).toBe(0);
    await act(async () => press(tree, 'Copy request').props.onPress());
    expect(Clipboard.setString).toHaveBeenLastCalledWith(created.uri);
    expect(confirmed()).toBe(1);
    // A long press on the code confirms at the same control.
    await act(async () => qr(tree).props.onLongPress());
    expect(confirmed()).toBe(2);
    expect(said.mock.calls.map(call => call[0])).toContain(copy.receive.copied);
    expect(visibleText(tree)).not.toContain(copy.receive.copied);
    await act(async () => tree.unmount());
  });

  test('a stale balance holds a quote back: a tap refreshes the wallet and creates nothing', async () => {
    const receive = jest.fn();
    const onRefresh = jest.fn();
    const client = adapter({
      quoteReceive: jest
        .fn()
        .mockResolvedValue({ ...quote, expiresAt: Date.now() + 60000 }),
      receive,
    });
    const screen = (stale: boolean) => (
      <ReceiveScreen
        client={client}
        receivableSats={10000}
        disabled={stale}
        onActivity={noop}
        onBusy={noop}
        onRefresh={onRefresh}
      />
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(screen(false));
    });
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => tree.update(screen(true)));
    expect(disabled(tree, 'Create request')).toBe(true);
    expect(meaning(tree)).toContain(copy.receive.stale);
    await act(async () => press(tree, 'Create request').props.onPress());
    expect(receive).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('an expired quote turns the control to refresh, which asks for a new quote', async () => {
    const quoteReceive = jest
      .fn()
      .mockResolvedValue({ ...quote, expiresAt: Date.now() + 1000 });
    const receive = jest.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ReceiveScreen
          client={adapter({ quoteReceive, receive })}
          receivableSats={10000}
          onActivity={noop}
          onBusy={noop}
        />,
      );
    });
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(find(tree, 'Create request')).toBeUndefined();
    await act(async () => press(tree, 'Refresh quote').props.onPress());
    expect(quoteReceive).toHaveBeenCalledTimes(2);
    expect(receive).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a quote the engine calls expired turns to refresh in place, is said at once and logged', async () => {
    const said = spoken();
    const warned = jest.spyOn(haptics, 'warning');
    const why = 'The receive quote expired. Review the request again.';
    const quoteReceive = jest
      .fn()
      .mockResolvedValue({ ...quote, expiresAt: Date.now() + 60000 });
    const receive = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error(why), { code: 'QUOTE_EXPIRED' }),
      );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ReceiveScreen
          client={adapter({ quoteReceive, receive })}
          receivableSats={10000}
          onActivity={noop}
          onBusy={noop}
        />,
      );
    });
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => press(tree, 'Create request').props.onPress());
    // Still the quote, not the form: its control is now refresh.
    expect(find(tree, 'Create request')).toBeUndefined();
    expect(find(tree, 'Refresh quote')).toBeDefined();
    expect(find(tree, 'Continue')).toBeUndefined();
    expect(warned).toHaveBeenCalledTimes(1);
    const call = said.mock.calls.find(
      ([spokenText]) => spokenText === copy.receive.quoteExpired,
    );
    expect(call).toBeDefined();
    if (Platform.OS === 'ios') expect(call![1]).toEqual({ queue: false });
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({ message: why, code: 'QUOTE_EXPIRED' }),
    );
    await act(async () => press(tree, 'Refresh quote').props.onPress());
    expect(quoteReceive).toHaveBeenCalledTimes(2);
    expect(find(tree, 'Create request')).toBeDefined();
    await act(async () => tree.unmount());
  });

  test('on a stale balance an expired quote refreshes the wallet, not the quote', async () => {
    const quoteReceive = jest
      .fn()
      .mockResolvedValue({ ...quote, expiresAt: Date.now() + 1000 });
    const onRefresh = jest.fn();
    const screen = (stale: boolean) => (
      <ReceiveScreen
        client={adapter({ quoteReceive, receive: jest.fn() })}
        receivableSats={10000}
        disabled={stale}
        onActivity={noop}
        onBusy={noop}
        onRefresh={onRefresh}
      />
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(screen(false));
    });
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await act(async () => tree.update(screen(true)));
    expect(disabled(tree, 'Refresh quote')).toBe(true);
    await act(async () => press(tree, 'Refresh quote').props.onPress());
    expect(quoteReceive).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(find(tree, 'Refresh quote')).toBeDefined();
    await act(async () => tree.unmount());
  });

  test('a balance going stale is said at once while there is a request to make, and not over one made', async () => {
    const said = spoken();
    // The platform's announcer is a mock of its own, which keeps what the
    // cases before this one said.
    said.mockClear();
    const stale = () =>
      said.mock.calls.filter(
        ([spokenText]) => spokenText === copy.receive.stale,
      );
    const client = adapter({
      quoteReceive: jest
        .fn()
        .mockResolvedValue({ ...quote, expiresAt: Date.now() + 60000 }),
      receive: jest.fn().mockResolvedValue(fresh()),
      getReceiveStatus: jest.fn().mockResolvedValue(waiting),
    });
    const screen = (isStale: boolean) => (
      <ReceiveScreen
        client={client}
        receivableSats={10000}
        disabled={isStale}
        onActivity={noop}
        onBusy={noop}
      />
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(screen(false));
    });
    expect(stale()).toHaveLength(0);
    await act(async () => tree.update(screen(true)));
    expect(stale()).toHaveLength(1);
    if (Platform.OS === 'ios') expect(stale()[0][1]).toEqual({ queue: false });
    await act(async () => tree.update(screen(false)));
    await act(async () => press(tree, 'Continue').props.onPress());
    await act(async () => press(tree, 'Create request').props.onPress());
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await act(async () => tree.update(screen(true)));
    // The request is made and can still be paid; nothing to hold back.
    expect(stale()).toHaveLength(1);
    expect(find(tree, 'Share request')).toBeDefined();
    await act(async () => tree.unmount());
  });

  test('an offline receive the engine refuses shakes the moon off and makes nothing by itself', async () => {
    const said = spoken();
    const why =
      'Your node cannot prepare this payment request right now. Try again shortly.';
    const quoteReceive = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(why), { code: 'RECEIVE_UNAVAILABLE' }),
      );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ReceiveScreen
          client={adapter({
            getConfig: jest
              .fn()
              .mockResolvedValue({ offlineReceiveAvailable: true }),
            quoteReceive,
            receive: jest.fn(),
          })}
          receivableSats={10000}
          offlineReceivableSats={30000}
          onActivity={noop}
          onBusy={noop}
        />,
      );
    });
    await act(async () => press(tree, 'Receive offline').props.onPress());
    await enterAmount(tree, '1000');
    await act(async () => press(tree, 'Continue').props.onPress());
    expect(quoteReceive).toHaveBeenCalledTimes(1);
    expect(quoteReceive).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline' }),
    );
    expect(offlineSwitch(tree).props.accessibilityState.checked).toBe(false);
    expect(find(tree, 'Create request')).toBeUndefined();
    expect(alerts(tree)).toContain(why);
    expect(said.mock.calls.map(call => call[0])).toContain(why);
    await act(async () => tree.unmount());
  });

  test('money that arrived stays on screen, and a reused address still says so beside it', async () => {
    const warned = jest.spyOn(haptics, 'warning');
    const arrived: ReceiveStatus = { ...partial, method: undefined, txids: [] };
    const { tree } = await made(
      fresh(),
      jest
        .fn()
        .mockResolvedValueOnce(arrived)
        .mockRejectedValue(
          Object.assign(new Error(copy.receive.reusedAddress), {
            code: 'AMBIGUOUS_RECEIVE_ADDRESS',
          }),
        ),
    );
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(meaning(tree)).toContain('Part of it is here.');
    expect(meaning(tree)).toContain(copy.receive.reusedAddress);
    expect(find(tree, 'Share request')).toBeUndefined();
    expect(find(tree, 'Copy request')).toBeUndefined();
    expect(warned).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('money arriving is felt and heard once, and a hidden balance keeps it hidden', async () => {
    const said = spoken();
    const incoming = jest.spyOn(haptics, 'incoming');
    const { tree } = await made(
      fresh(),
      jest.fn().mockResolvedValue({
        ...pending,
        phase: 'completed',
        confirmedSats: 1000,
        pendingSats: 0,
      }),
      { hidden: true },
    );
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(incoming).toHaveBeenCalledTimes(1);
    expect(said.mock.calls.map(call => call[0])).toContain(
      copy.receive.received,
    );
    expect(meaning(tree)).toContain(
      copy.receive.receivedSats(copy.amount.hidden),
    );
    expect(meaning(tree)).not.toContain('1,000 sats');
    await act(async () => tree.unmount());
  });
});

describe('copying, and what a copy says', () => {
  afterEach(() => jest.restoreAllMocks());
  const HASH = 'cd'.repeat(32);
  const spoken = () => {
    const said = jest.spyOn(
      AccessibilityInfo,
      Platform.OS === 'ios'
        ? 'announceForAccessibilityWithOptions'
        : 'announceForAccessibility',
    );
    said.mockClear();
    return said;
  };

  test('a chip names what it copied the way a sentence starts, whatever its label', async () => {
    // Each case speaks at an hour of its own, past the announcer's repeat window.
    jest.setSystemTime(Date.now() + 3_600_000);
    const said = spoken();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<CopyChip label="payment hash" value={HASH} />);
    });
    await act(async () => press(tree, 'Copy payment hash').props.onPress());
    expect(Clipboard.setString).toHaveBeenLastCalledWith(HASH);
    expect(said.mock.calls.map(call => call[0])).toContain(
      'Payment hash copied',
    );
    await act(async () => tree.unmount());
  });

  test('a toast is a glyph on screen and its message for a screen reader, at once when it failed', async () => {
    jest.setSystemTime(Date.now() + 2 * 3_600_000);
    const said = spoken();
    let show!: ReturnType<typeof useToast>;
    function Probe() {
      show = useToast();
      return null;
    }
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ToastProvider>
          <Probe />
        </ToastProvider>,
      );
    });
    await act(async () => show(copy.receive.copied, 'success', 'copy'));
    expect(visibleText(tree)).toEqual([]);
    expect(said.mock.calls.map(call => call[0])).toContain(copy.receive.copied);
    await act(async () => show('Could not share this request.', 'error'));
    expect(visibleText(tree)).toEqual([]);
    const failed = said.mock.calls.find(
      ([spokenText]) => spokenText === 'Could not share this request.',
    );
    expect(failed).toBeDefined();
    if (Platform.OS === 'ios') expect(failed![1]).toEqual({ queue: false });
    // It goes by itself.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
  });

  test('a link the engine refuses is a bang with its words, an error haptic and a line in the log', async () => {
    jest.setSystemTime(Date.now() + 3 * 3_600_000);
    const said = spoken();
    const failed = jest.spyOn(haptics, 'error');
    const why = 'The original request belongs to another invoice.';
    const legacy: Activity = {
      ...activity,
      status: 'expired',
      receiveRequest: {
        ...request,
        uri: request.bolt11,
        address: undefined,
        legacy: true,
      },
    };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <DetailScreen
          item={legacy}
          client={adapter({
            importReceiveRequest: jest
              .fn()
              .mockRejectedValue(
                Object.assign(new Error(why), { code: 'REQUEST_MISMATCH' }),
              ),
          })}
        />,
      );
    });
    await act(async () => press(tree, 'Link original request').props.onPress());
    await act(async () =>
      field(tree, 'Original payment request').props.onChangeText(request.uri),
    );
    await act(async () => press(tree, 'Link request').props.onPress());
    expect(alerts(tree)).toContain(why);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(said.mock.calls.map(call => call[0])).toContain(why);
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({ message: why, code: 'REQUEST_MISMATCH' }),
    );
    // Still linking, so the paste can be fixed and tried again.
    expect(find(tree, 'Link request')).toBeDefined();
    await act(async () => tree.unmount());
  });
});

describe('the receive model', () => {
  const at = Date.parse('2026-06-06T12:00:00Z');
  const made = { createdAt: at, expiresAt: at + 60 * 60000 };

  test('a request shows its code only while it can be paid on an address of its own', () => {
    const face = (now: number, paid: boolean, ambiguous: boolean) =>
      requestFace({ request: made, now, paid, ambiguous });
    expect(face(at, false, false)).toMatchObject({
      qr: 'shown',
      shareable: true,
    });
    expect(face(at + 61 * 60000, false, false)).toMatchObject({
      qr: 'expired',
      shareable: false,
    });
    expect(face(at, false, true)).toMatchObject({
      qr: 'scattered',
      shareable: false,
    });
    // Paid wins over everything, reused over expired.
    expect(face(at + 61 * 60000, true, true).qr).toBe('paid');
    expect(face(at + 61 * 60000, false, true).qr).toBe('scattered');
  });

  test('a frame runs late in its last tenth or its last minute, whichever is longer', () => {
    expect(lateAt(at, at + 60 * 60000)).toBe(at + 54 * 60000);
    expect(lateAt(at, at + 5 * 60000)).toBe(at + 4 * 60000);
    const face = (now: number) =>
      requestFace({ request: made, now, paid: false, ambiguous: false });
    expect(face(at + 53 * 60000).late).toBe(false);
    expect(face(at + 55 * 60000).late).toBe(true);
  });

  test('a detail shares only a pending request in time with a status and address it can trust', () => {
    const item = {
      kind: 'request' as const,
      status: 'pending' as const,
      receiveStatus: undefined,
      receiveStatusUnavailable: false,
    };
    const kept = { expiresAt: at + 60000, bitcoinTracking: 'unique' as const };
    expect(detailFace(item, kept, at)).toEqual({
      qr: 'shown',
      shareable: true,
    });
    expect(detailFace(item, kept, at + 60000)).toEqual({
      qr: 'expired',
      shareable: false,
    });
    expect(
      detailFace(item, { ...kept, bitcoinTracking: 'ambiguous' }, at),
    ).toEqual({ qr: 'scattered', shareable: false });
    expect(
      detailFace({ ...item, receiveStatusUnavailable: true }, kept, at),
    ).toEqual({ qr: null, shareable: false });
    expect(detailFace({ ...item, receiveStatus: partial }, kept, at)).toEqual({
      qr: null,
      shareable: false,
    });
  });

  test('the amount cue: any, required, and the offline cap and floor', () => {
    const cue = (amount: string, over = {}) =>
      amountCue({ amount, required: false, offline: false, ...over });
    expect(cue('')).toEqual({
      kind: 'any',
      empty: true,
      over: false,
      under: false,
    });
    expect(cue('0', { required: true })).toMatchObject({
      kind: 'required',
      empty: true,
    });
    expect(cue('30001', { offline: true, cap: 30000 })).toMatchObject({
      kind: 'offline',
      over: true,
    });
    expect(cue('353', { offline: true, cap: 30000 }).under).toBe(true);
    expect(cue(String(OFFLINE_MIN_SATS), { offline: true }).under).toBe(false);
  });

  test('the fee glyph says how the money arrives', () => {
    const glyph = (over = {}) =>
      feeGlyph({
        offline: false,
        feeSats: 0,
        amountSats: 1000,
        receivableSats: 10000,
        ...over,
      });
    expect(glyph()).toBe('bolt');
    expect(glyph({ feeSats: 100 })).toBe('sprout');
    expect(glyph({ amountSats: 20000 })).toBe('sprout');
    expect(glyph({ offline: true, feeSats: 100 })).toBe('moon');
  });

  test('what is still owed, and the ring of what arrived', () => {
    expect(remainderSats(1000, partial)).toBe(600);
    expect(remainderSats(null, partial)).toBeNull();
    expect(remainderSats(1000, pending)).toBeNull();
    expect(receiptRing(partial, 1000)).toEqual({ kind: 'split', share: 0.4 });
    expect(receiptRing(pending, 1000)).toEqual({
      kind: 'orbit',
      share: ORBIT_SHARE,
    });
    expect(receiptRing({ ...pending, phase: 'completed' }, 1000)).toEqual({
      kind: 'full',
      share: 1,
    });
    expect(receiptTransactions(pending)).toEqual([
      { txid: 'tx-one', confirmed: false },
    ]);
  });

  test('the burst petals fly out from the ring, and are gone at both ends', () => {
    const start = petalPose(3, 0, 100, 40);
    const end = petalPose(3, 1, 100, 40);
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(100);
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(140);
    expect(start.opacity).toBe(0);
    expect(end.opacity).toBe(0);
    expect(petalPose(3, 0.35, 100, 40).opacity).toBe(1);
    // Petal 0 flies straight up.
    expect(petalPose(0, 1, 100, 40).x).toBeCloseTo(0);
    expect(petalPose(0, 1, 100, 40).y).toBeCloseTo(-140);
  });
});

describe('the QR bloom', () => {
  const VALUE = request.uri;
  /** The modules a set of run paths covers, as "x,y". */
  const cells = (d: string, offset = { x: 0, y: 0 }) =>
    [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].flatMap(([, x, y, run]) =>
      Array.from(
        { length: Number(run) },
        (_, i) => `${Number(x) + i + offset.x},${Number(y) + offset.y}`,
      ),
    );

  test('the bands and finders draw every dark module exactly once', () => {
    const modules = qrModules(VALUE);
    const { bands, finders } = qrLayers(modules);
    const drawn = [
      ...bands.flatMap(d => cells(d)),
      ...finders.flatMap(finder => cells(finder.d, finder)),
    ];
    const dark: string[] = [];
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.data[y * modules.size + x] === 1) dark.push(`${x},${y}`);
      }
    }
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.sort()).toEqual(dark.sort());
    expect(bands).toHaveLength(BANDS);
  });

  test('each band lies farther from the centre than the one inside it', () => {
    const modules = qrModules(VALUE);
    const middle = (modules.size - 1) / 2;
    const reach = qrLayers(modules).bands.map(d =>
      cells(d).map(cell => {
        const [x, y] = cell.split(',').map(Number);
        return Math.hypot(x - middle, y - middle);
      }),
    );
    for (let k = 1; k < reach.length; k++) {
      expect(Math.max(...reach[k - 1])).toBeLessThanOrEqual(
        Math.min(...reach[k]),
      );
    }
  });

  test('it blooms from the centre, dissolves from the outside, implodes from the inside, and the finders move last', () => {
    const delays = (state: QrState) =>
      Array.from(
        { length: FINDERS + 1 },
        (_, layer) => layerMotion(layer, state).delay,
      );
    const rising = (list: number[]) =>
      list.every((value, i) => i === 0 || value > list[i - 1]);
    expect(rising(delays('shown'))).toBe(true);
    expect(delays('shown')[0]).toBe(80);
    const expired = delays('expired');
    expect(rising(expired.slice(0, BANDS).reverse())).toBe(true);
    expect(expired[FINDERS]).toBe(Math.max(...expired));
    expect(rising(delays('paid'))).toBe(true);
    expect(layerMotion(0, 'paid')).toMatchObject({ opacity: 0, scale: 0.2 });
    expect(layerMotion(0, 'paid').duration).toBe(420);
    expect(leaveMs('paid')).toBe(40 * FINDERS + 420);
  });

  test('a scattered code leaves in as many directions as it has layers', () => {
    const headings = Array.from({ length: FINDERS + 1 }, (_, layer) => {
      const { x, y } = scatterOffset(layer);
      return Math.round((Math.atan2(y, x) * 180) / Math.PI);
    });
    expect(new Set(headings).size).toBe(headings.length);
  });
});
