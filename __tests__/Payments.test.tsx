import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { SendReview, ReceiveQuote } from '@beignet/wallet-core';
import { SendScreen, ReceiveScreen } from '../src/screens/Payments';
import { Scanner } from '../src/components/Scanner';
import type { WalletAdapter } from '../src/services/wallet';

const onBusy = jest.fn();
const quote: SendReview = {
  id: 'review-1',
  destination: 'recipient',
  description: 'Coffee',
  amountSats: 4200,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  totalSats: 4220,
  route: 'lightning',
  expiresAt: Date.now() + 60000,
  warnings: [],
};
function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function')!;
}
function field(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onChangeText === 'function')!;
}
function adapter(overrides: object) {
  return overrides as WalletAdapter;
}

test('review does not send; confirmation sends once and preserves uncertain status', async () => {
  const prepareSend = jest.fn().mockResolvedValue(quote);
  let resolveSend!: (value: unknown) => void;
  const send = jest.fn().mockImplementation(
    () =>
      new Promise(resolve => {
        resolveSend = resolve;
      }),
  );
  const onRefresh = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend, send })}
        onActivity={jest.fn()}
        onRefresh={onRefresh}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'lnbc-request',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  expect(prepareSend).toHaveBeenCalledWith({
    request: 'lnbc-request',
    amountSats: undefined,
  });
  expect(send).not.toHaveBeenCalled();
  const confirm = label(tree, 'Send 4,200 sats').props.onPress;
  await act(async () => {
    confirm();
    confirm();
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveSend({
      id: 'p1',
      status: 'uncertain',
      amountSats: 4200,
      feeSats: 20,
      message: 'Payment status unknown.',
    });
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Payment status unknown.');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Sent, just like that.');
  // The outcome is said in words, not the wire enum.
  expect(JSON.stringify(tree.toJSON())).toContain('Needs checking');
  expect(JSON.stringify(tree.toJSON())).not.toContain('"uncertain"');
  expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('expired send quote cannot be submitted', async () => {
  const send = jest.fn();
  const prepareSend = jest
    .fn()
    .mockResolvedValue({ ...quote, expiresAt: Date.now() - 1 });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend, send })}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'lnbc-request',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  expect(label(tree, 'Send 4,200 sats').props.disabled).toBe(true);
  await act(async () => {
    await label(tree, 'Send 4,200 sats').props.onPress();
  });
  expect(send).not.toHaveBeenCalled();
  // Refreshing the quote asks for a new one for the same request.
  await act(async () => {
    await label(tree, 'Refresh quote').props.onPress();
  });
  expect(prepareSend).toHaveBeenCalledTimes(2);
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: 'lnbc-request',
    amountSats: undefined,
  });
  await act(async () => {
    tree.unmount();
  });
});

test('scanning from Send keeps what was typed, whether the scan lands or is cancelled', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend: jest.fn() })}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('lnbc-typed');
    field(tree, 'Amount in sats').props.onChangeText(
      '500',
    );
  });
  await act(async () => {
    label(tree, 'Scan a payment request').props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Point at the code.');
  await act(async () => {
    tree.root.findByType(Scanner).props.onCancel();
  });
  expect(field(tree, 'Payment request or address').props.value).toBe(
    'lnbc-typed',
  );
  await act(async () => {
    label(tree, 'Scan a payment request').props.onPress();
  });
  await act(async () => {
    tree.root.findByType(Scanner).props.onDetected('lnbc-scanned');
  });
  expect(field(tree, 'Payment request or address').props.value).toBe(
    'lnbc-scanned',
  );
  expect(
    field(tree, 'Amount in sats').props.value,
  ).toBe('500');
  await act(async () => {
    tree.unmount();
  });
});

test('a stale balance blocks a new receive request and says why', async () => {
  const quoteReceive = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={adapter({ quoteReceive })}
        receivableSats={5000}
        disabled
        onActivity={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('not confirmed recently');
  expect(label(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => {
    tree.unmount();
  });
});

test('receive fee is displayed before invoice creation and before showing a QR', async () => {
  const receiveQuote: ReceiveQuote = {
    id: 'q1',
    amountSats: 10000,
    description: 'Dinner',
    feeSats: 100,
    netSats: 9900,
    expiresAt: Date.now() + 60000,
    warnings: [],
  };
  const quoteReceive = jest.fn().mockResolvedValue(receiveQuote);
  const receive = jest.fn().mockResolvedValue({
    id: 'r1',
    uri: 'beignet-demo:request',
    address: '',
    bolt11: '',
    paymentHash: '',
    amountSats: 10000,
    description: 'Dinner',
    feeSats: 100,
    expiresAt: Date.now() + 60000,
    warnings: [],
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReceiveScreen
        client={adapter({ quoteReceive, receive })}
        onActivity={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('10000');
  });
  await act(async () => {
    await label(tree, 'Continue').props.onPress();
  });
  expect(receive).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('9,900 sats');
  expect(JSON.stringify(tree.toJSON())).not.toContain('QRCode');
  await act(async () => {
    await label(tree, 'Create request').props.onPress();
  });
  expect(receive).toHaveBeenCalledWith(receiveQuote);
  expect(JSON.stringify(tree.toJSON())).toContain('QRCode');
  await act(async () => {
    tree.unmount();
  });
});

test('a direct-funding review names its method and fee ceiling, and a refusal says nothing was sent', async () => {
  const review: SendReview = {
    ...quote,
    id: 'review-df',
    route: 'bitcoin',
    method: 'direct-funding',
    feeSats: 1000,
    feeLabel: 'Maximum network fee',
    totalSats: 5200,
    warnings: [
      "Paid as direct funding. Your coin becomes the recipient's channel funding in one transaction.",
    ],
  };
  const prepareSend = jest.fn().mockResolvedValue(review);
  const send = jest.fn().mockResolvedValue({
    id: 'review-df',
    status: 'failed',
    amountSats: 4200,
    feeSats: 1000,
    message:
      'The recipient did not take the direct funding. Nothing was sent. Review again to pay the address.',
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend, send })}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('bitcoin:x?bgnq=y');
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  const shown = JSON.stringify(tree.toJSON());
  expect(shown).toContain('Direct funding');
  expect(shown).toContain('Maximum network fee');
  expect(shown).toContain('1,000 sats');
  await act(async () => {
    await label(tree, 'Send 4,200 sats').props.onPress();
  });
  const after = JSON.stringify(tree.toJSON());
  expect(after).toContain('Payment failed.');
  expect(after).toContain('Nothing was sent');
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

// A structurally valid 24,425 sat invoice: the amount is all the form reads.
const INVOICE_24425 =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';

test('a request that names its amount fills the amount field and locks it', async () => {
  const prepareSend = jest.fn().mockRejectedValue(new Error('stop here'));
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend })}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('500');
  });
  await act(async () => {
    label(tree, 'Scan a payment request').props.onPress();
  });
  await act(async () => {
    tree.root.findByType(Scanner).props.onDetected(INVOICE_24425);
  });
  const amount = field(tree, 'Amount in sats');
  expect(amount.props.value).toBe('24,425');
  expect(amount.props.editable).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toContain('Set by the payment request.');
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  // The request carries the amount; sending one alongside could only conflict.
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: INVOICE_24425,
    amountSats: undefined,
  });
  // A Bitcoin link carrying that invoice fixes the same amount.
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?lightning=${INVOICE_24425}`,
    );
  });
  expect(field(tree, 'Amount in sats').props.value).toBe('24,425');
  // A request that names no amount gives back what was typed.
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('lnbc-typed');
  });
  expect(field(tree, 'Amount in sats').props.value).toBe('500');
  expect(field(tree, 'Amount in sats').props.editable).toBe(true);
  await act(async () => {
    tree.unmount();
  });
});

test('a Lightning review shows the expected fee beside the maximum it can cost', async () => {
  const lightning: SendReview = {
    ...quote,
    feeSats: 11,
    estimatedFeeSats: 1,
    feeLabel: 'Maximum routing fee',
    totalSats: 4211,
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SendScreen
        client={adapter({ prepareSend: jest.fn().mockResolvedValue(lightning) })}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('lnbc-request');
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  const shown = JSON.stringify(tree.toJSON());
  expect(shown).toContain('Expected routing fee');
  expect(shown).toContain('about 1 sats');
  expect(shown).toContain('Maximum routing fee');
  expect(shown).toContain('11 sats');
  expect(shown).toContain('Total, at most');
  expect(shown).toContain('4,211 sats');
  await act(async () => {
    tree.unmount();
  });
});
