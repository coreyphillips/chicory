import React from 'react';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import { AppState, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type {
  Activity,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { ReceiveScreen } from '../src/screens/Payments';
import { DetailScreen, activityStatus } from '../src/screens/Wallet';
import { useReceiveStatus } from '../src/services/useReceiveStatus';
import type { WalletAdapter } from '../src/services/wallet';

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
  expect(field(tree, 'Amount in sats').props.placeholder).toBe(
    'Enter an amount',
  );
  expect(press(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(quoteReceive).not.toHaveBeenCalled();
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('1000');
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(quoteReceive).toHaveBeenCalledWith({
    amountSats: 1000,
    description: '',
  });
  expect(receive).not.toHaveBeenCalled();
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
  expect(field(tree, 'Amount in sats').props.placeholder).toBe('Any amount');
  expect(press(tree, 'Continue').props.disabled).toBeFalsy();
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
  expect(press(tree, 'Continue').props.disabled).toBe(true);
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
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('1000');
  });
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
  expect(text(tree)).toContain('Payment request QR code');
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(text(tree)).toContain('Payment detected.');
  expect(text(tree)).toContain('sender does not need to pay again');
  expect(text(tree)).not.toContain('Payment request QR code');
  expect(press(tree, 'Share request')).toBeUndefined();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(text(tree)).toContain('Payment received.');
  expect(onRefresh).toHaveBeenCalledTimes(3); // created, detected, confirmed
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(getReceiveStatus).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
});

test('partial receipt hides QR and only prefills the exact unpaid remainder for a new quote', async () => {
  const { tree } = await showRequest([partial]);
  expect(text(tree)).toContain('Part of it is here.');
  expect(text(tree)).not.toContain('Payment request QR code');
  await act(async () =>
    press(tree, 'Request the remaining amount').props.onPress(),
  );
  expect(field(tree, 'Amount in sats').props.value).toBe('600');
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
  expect(press(tree, 'Share original request').props.disabled).toBeFalsy();
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
  expect(text(tree)).toContain(request.uri);
  expect(press(tree, 'Share original request').props.disabled).toBe(true);
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
  expect(text(tree)).toContain('address was reused');
  expect(press(tree, 'Share original request').props.disabled).toBe(true);
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
  expect(text(tree)).toContain('Invoice expired');
  await act(async () => press(tree, 'Link original request').props.onPress());
  await act(async () =>
    field(tree, 'Original payment request').props.onChangeText(request.uri),
  );
  await act(async () => {
    await press(tree, 'Link request').props.onPress();
  });
  expect(text(tree)).toContain('belongs to another invoice');
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => {
    await press(tree, 'Link request').props.onPress();
  });
  expect(importReceiveRequest).toHaveBeenLastCalledWith(
    request.uri,
    request.paymentHash,
  );
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(text(tree)).toContain('Original request linked.');
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
  expect(text(tree)).toContain('address was reused');
  expect(text(tree)).toContain('Check Activity.');
  expect(text(tree)).not.toContain('Share this request.');
  expect(text(tree)).not.toContain('Payment request QR code');
  expect(text(tree)).not.toContain('Part of it is here.');
  expect(press(tree, 'Share request').props.disabled).toBe(true);
  expect(press(tree, 'Copy request').props.disabled).toBe(true);
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
  await act(async () =>
    field(tree, 'Note · optional').props.onChangeText('Keep this note'),
  );
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(press(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => tree.update(screen(0)));
  await act(async () => tree.update(screen(2000)));
  expect(press(tree, 'Continue').props.disabled).toBeFalsy();
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
  expect(press(tree, 'Continue').props.disabled).toBe(true);
  await act(async () =>
    field(tree, 'Amount in sats').props.onChangeText('1000'),
  );
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  await act(async () => press(tree, 'Create another request').props.onPress());
  expect(field(tree, 'Amount in sats').props.value).toBe('');
  expect(press(tree, 'Continue').props.disabled).toBeFalsy();
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
  expect(text(tree)).toContain('This request accepts Lightning only.');
  expect(text(tree)).toContain('unused address limit');
  expect(
    tree.root.findAllByProps({ value: request.bolt11 }).length,
  ).toBeGreaterThan(0);
  expect(press(tree, 'Share request').props.disabled).toBeFalsy();
  expect(getReceiveStatus).toHaveBeenCalledWith(lightningOnly);
  await act(async () => tree.unmount());
  let detail!: ReactTestRenderer;
  await act(async () => {
    detail = create(
      <DetailScreen item={{ ...activity, receiveRequest: lightningOnly }} />,
    );
  });
  expect(text(detail)).toContain('This request accepts Lightning only.');
  expect(press(detail, 'Share original request').props.disabled).toBeFalsy();
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
  expect(press(tree, 'Continue').props.disabled).toBe(false);
  const box = tree.root.findByProps({ accessibilityLabel: 'Receive offline' });
  expect(box.props.value).toBe(false);
  await act(async () => {
    box.props.onValueChange(true);
  });
  expect(press(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('1000');
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(client.quoteReceive).toHaveBeenCalledWith(
    expect.objectContaining({ amountSats: 1000, mode: 'offline' }),
  );
  expect(text(tree)).toContain('Payable while this wallet is closed');
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  expect(text(tree)).toContain('You can close your wallet');
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
    await act(async () => {
      field(tree, 'Amount in sats').props.onChangeText('1000');
    });
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
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: 'Receive offline' })
      .props.onValueChange(true);
  });
  expect(text(tree)).toContain('Enter 354 to 30,000 sats.');
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('30001');
  });
  expect(press(tree, 'Continue').props.disabled).toBe(true);
  expect(text(tree)).toContain(
    'An offline receive can take up to 30,000 sats right now.',
  );
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('30000');
  });
  expect(press(tree, 'Continue').props.disabled).toBe(false);
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
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: 'Receive offline' })
      .props.onValueChange(true);
  });
  // On the form, a refresh that finds no room hides the box and drops the
  // choice, so Continue asks for the ordinary request.
  await act(async () => tree.update(screen(0)));
  expect(hasOfflineBox(tree)).toBe(false);
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('1000');
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  expect(
    'mode' in (client.quoteReceive as jest.Mock).mock.calls[0][0],
  ).toBe(false);
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
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: 'Receive offline' })
      .props.onValueChange(true);
  });
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('1000');
  });
  await act(async () => {
    await press(tree, 'Continue').props.onPress();
  });
  await act(async () => {
    await press(tree, 'Create request').props.onPress();
  });
  await act(async () => tree.update(reservedScreen(0)));
  expect(text(tree)).toContain('You can close your wallet');
  await act(async () => tree.unmount());
});
