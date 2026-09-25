import React from 'react';
import { AccessibilityInfo, TextInput } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { ReactTestInstance } from 'react-test-renderer';
import type { SendReview, ReceiveQuote } from '@beignet/wallet-core';
import { SendScreen, ReceiveScreen } from '../src/screens/Payments';
import { Scanner } from '../src/components/Scanner';
import { copy } from '../src/design/copy';
import type { WalletAdapter } from '../src/services/wallet';
import { amountValue, enterAmount } from '../test-support/keypad';
import {
  alerts,
  find,
  meaning,
  press,
  pressableLabels,
} from '../test-support/query';

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

/**
 * Send draws inside the gesture root, as the app does, so a long press can
 * show what a glyph means.
 */
async function renderSend(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<GestureHandlerRootView>{element}</GestureHandlerRootView>);
  });
  return tree;
}

/**
 * The hold labelled `value`, as a screen reader reaches it: a control with
 * an activate action, or a long press, and never a tap.
 */
function holds(tree: ReactTestRenderer, value: string) {
  return tree.root.findAll(
    node =>
      node.props.accessibilityLabel === value &&
      (typeof node.props.onAccessibilityAction === 'function' ||
        typeof node.props.onLongPress === 'function'),
  );
}

/** Commits a hold the way a screen reader does, with its one action. */
const activate = (node: ReactTestInstance) =>
  node.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });

/** The element a screen reader reaches by `value`, where its state is. */
const element = (tree: ReactTestRenderer, value: string) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === value,
  );

const amountShown = (tree: ReactTestRenderer) =>
  element(tree, copy.amount.field);

const keypads = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityLabel === copy.keypad.label,
  );

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
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend, send })}
      onActivity={jest.fn()}
      onRefresh={onRefresh}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'lnbc-unknown',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  expect(prepareSend).toHaveBeenCalledWith({
    request: 'lnbc-unknown',
    amountSats: undefined,
  });
  expect(send).not.toHaveBeenCalled();
  // A tap is not a hold: nothing that sends can be pressed.
  expect(find(tree, 'Send 4,200 sats')).toBeUndefined();
  const [confirm] = holds(tree, 'Send 4,200 sats');
  await act(async () => {
    activate(confirm);
    activate(confirm);
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
  expect(meaning(tree)).toContain('Payment status unknown.');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Sent, just like that.');
  // The outcome is said in words, not the wire enum.
  expect(meaning(tree)).toContain('Needs checking');
  expect(JSON.stringify(tree.toJSON())).not.toContain('"uncertain"');
  // Never presented as done, and nothing offers to pay it again.
  expect(meaning(tree)).not.toContain(copy.send.sent);
  expect(holds(tree, 'Send 4,200 sats')).toEqual([]);
  expect(pressableLabels(tree)).not.toContain('Review payment');
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
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend, send })}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'lnbc-request',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  // The hold went with the quote: nothing labelled to send can commit.
  expect(holds(tree, 'Send 4,200 sats')).toEqual([]);
  expect(find(tree, 'Send 4,200 sats')).toBeUndefined();
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
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    tree.unmount();
  });
});

test('scanning from Send keeps what was typed, whether the scan lands or is cancelled', async () => {
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend: jest.fn() })}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('lnbc-typed');
  });
  await enterAmount(tree, '500');
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
  expect(amountValue(tree)).toBe('500');
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
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend, send })}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'bitcoin:x?bgnq=y',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  const shown = meaning(tree);
  expect(shown).toContain('Direct funding');
  expect(shown).toContain('Maximum network fee');
  expect(shown).toContain('1,000 sats');
  expect(shown).toContain(review.warnings[0]);
  // Warned about, the hold takes longer.
  const [confirm] = holds(tree, 'Send 4,200 sats');
  expect(confirm.props.delayLongPress).toBe(1000);
  await act(async () => {
    activate(confirm);
  });
  const after = meaning(tree);
  expect(after).toContain('Payment failed.');
  expect(after).toContain('Nothing was sent');
  expect(after).not.toContain(copy.send.sent);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

// A structurally valid 24,425 sat invoice: the amount is all the form reads.
const INVOICE_24425 =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';

test('a request that names its amount fills the amount field and locks it', async () => {
  const prepareSend = jest.fn().mockRejectedValue(new Error('stop here'));
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend })}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await enterAmount(tree, '500');
  await act(async () => {
    label(tree, 'Scan a payment request').props.onPress();
  });
  await act(async () => {
    tree.root.findByType(Scanner).props.onDetected(INVOICE_24425);
  });
  expect(amountValue(tree)).toBe('24425');
  // Grouped for the reader, as the field showed it.
  expect(amountShown(tree).props.accessibilityValue.text).toBe('24,425 sats');
  // Locked: the keypad goes, and the amount says why.
  expect(keypads(tree)).toHaveLength(0);
  expect(amountShown(tree).props.accessibilityState.disabled).toBe(true);
  expect(meaning(tree)).toContain('Set by the payment request.');
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  // The request carries the amount; sending one alongside could only conflict.
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: INVOICE_24425,
    amountSats: undefined,
  });
  expect(alerts(tree)).toEqual(['stop here']);
  // A Bitcoin link carrying that invoice fixes the same amount.
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?lightning=${INVOICE_24425}`,
    );
  });
  expect(amountValue(tree)).toBe('24425');
  // A request that names no amount gives back what was typed.
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText('lnbc-typed');
  });
  expect(amountValue(tree)).toBe('500');
  expect(amountShown(tree).props.accessibilityState.disabled).toBe(false);
  expect(keypads(tree)).toHaveLength(1);
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
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend: jest.fn().mockResolvedValue(lightning) })}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    field(tree, 'Payment request or address').props.onChangeText(
      'lnbc-request',
    );
  });
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  const shown = meaning(tree);
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

/** Reviews `request` on a fresh Send and commits it with the hold. */
async function payOnce(client: WalletAdapter, request: string) {
  const tree = await renderSend(
    <SendScreen
      client={client}
      initialRequest={request}
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  await act(async () => {
    activate(holds(tree, 'Send 4,200 sats')[0]);
  });
  return tree;
}

test('a request whose payment is unknown cannot be paid again: it lands on the held ring', async () => {
  const said = jest.spyOn(
    AccessibilityInfo,
    'announceForAccessibilityWithOptions',
  );
  const prepareSend = jest.fn().mockResolvedValue(quote);
  const send = jest.fn().mockResolvedValue({
    id: 'p-held',
    status: 'uncertain',
    amountSats: 4200,
    feeSats: 20,
    message: 'Payment status unknown.',
  });
  const client = adapter({ prepareSend, send });
  const paid = await payOnce(client, 'lnbc-held');
  // Unknown is said at once, and loudly.
  expect(said).toHaveBeenCalledWith(copy.send.heldAnnouncement, {
    queue: false,
  });
  await act(async () => paid.unmount());
  for (const again of ['lnbc-held', '  LIGHTNING:LNBC-HELD ']) {
    const tree = await renderSend(
      <SendScreen
        client={client}
        initialRequest={again}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
      />,
    );
    const shown = meaning(tree);
    expect(shown).toContain(copy.send.held);
    expect(shown).toContain('Needs checking');
    expect(pressableLabels(tree)).not.toContain('Review payment');
    expect(holds(tree, 'Send 4,200 sats')).toEqual([]);
    expect(pressableLabels(tree)).toContain(copy.send.viewActivity);
    await act(async () => tree.unmount());
  }
  expect(prepareSend).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  said.mockRestore();
});

test('a send that ends without a result is held as unknown, never an error to retry', async () => {
  const message =
    'The connection ended before the wallet confirmed the result. Check Activity before attempting this action again.';
  const onRefresh = jest.fn();
  const send = jest
    .fn()
    .mockRejectedValue(
      Object.assign(new Error(message), { code: 'RESULT_UNCERTAIN' }),
    );
  const tree = await renderSend(
    <SendScreen
      client={adapter({
        prepareSend: jest.fn().mockResolvedValue(quote),
        send,
      })}
      initialRequest="lnbc-dropped"
      onActivity={jest.fn()}
      onRefresh={onRefresh}
      onBusy={onBusy}
    />,
  );
  await act(async () => {
    await label(tree, 'Review payment').props.onPress();
  });
  await act(async () => {
    activate(holds(tree, 'Send 4,200 sats')[0]);
  });
  const shown = meaning(tree);
  expect(shown).toContain(message);
  expect(shown).toContain('Needs checking');
  expect(shown).not.toContain(copy.send.failed);
  expect(shown).not.toContain(copy.send.sent);
  expect(pressableLabels(tree)).not.toContain('Review payment');
  expect(holds(tree, 'Send 4,200 sats')).toEqual([]);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test('a stale balance holds the review back, and a tap refreshes instead', async () => {
  const prepareSend = jest.fn();
  const onRefresh = jest.fn();
  const tree = await renderSend(
    <SendScreen
      client={adapter({ prepareSend })}
      initialRequest="lnbc-stale"
      disabled
      onActivity={jest.fn()}
      onRefresh={onRefresh}
      onBusy={onBusy}
    />,
  );
  expect(element(tree, 'Review payment').props.accessibilityState).toEqual({
    disabled: true,
    busy: false,
  });
  expect(meaning(tree)).toContain(copy.send.stale);
  await press(tree, 'Review payment');
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(prepareSend).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('a completed payment goes home a moment later, unless the screen is touched', async () => {
  jest.useFakeTimers();
  try {
    const send = jest.fn().mockResolvedValue({
      id: 'p-done',
      status: 'completed',
      amountSats: 4200,
      feeSats: 20,
      message: 'Payment sent.',
    });
    for (const touched of [false, true]) {
      const onDone = jest.fn();
      const tree = await renderSend(
        <SendScreen
          client={adapter({
            prepareSend: jest.fn().mockResolvedValue(quote),
            send,
          })}
          initialRequest={`lnbc-done-${touched}`}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={onBusy}
          onDone={onDone}
        />,
      );
      await act(async () => {
        await label(tree, 'Review payment').props.onPress();
      });
      await act(async () => {
        activate(holds(tree, 'Send 4,200 sats')[0]);
      });
      expect(meaning(tree)).toContain(copy.send.sent);
      if (touched) {
        await act(async () => {
          tree.root
            .findAll(node => typeof node.props.onTouchStart === 'function')[0]
            .props.onTouchStart();
        });
      }
      await act(async () => jest.advanceTimersByTime(2199));
      expect(onDone).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(1));
      expect(onDone).toHaveBeenCalledTimes(touched ? 0 : 1);
      await act(async () => tree.unmount());
    }
  } finally {
    jest.useRealTimers();
  }
});

describe('what the engine says no with', () => {
  const refusal = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  async function review(
    request: string,
    client: object,
    props: Partial<React.ComponentProps<typeof SendScreen>> = {},
  ) {
    const tree = await renderSend(
      <SendScreen
        client={adapter(client)}
        initialRequest={request}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={onBusy}
        {...props}
      />,
    );
    await act(async () => {
      await label(tree, 'Review payment').props.onPress();
    });
    return tree;
  }

  test('a request it will not pay dissolves back into the well, kept to fix', async () => {
    const message = 'This invoice is damaged. Ask for a new one.';
    const tree = await review('lnbc-damaged', {
      prepareSend: jest
        .fn()
        .mockRejectedValue(refusal('BOLT11_CHECKSUM', message)),
    });
    expect(alerts(tree)).toEqual([message]);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
    expect(field(tree, 'Payment request or address').props.value).toBe(
      'lnbc-damaged',
    );
    // Changing the request clears the refusal.
    await act(async () => {
      field(tree, 'Payment request or address').props.onChangeText('lnbc-new');
    });
    expect(alerts(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test('more than can be sent now, within what the wallet holds, is honey on the amount', async () => {
    const message = 'Not enough can be sent right now.';
    const tree = await review(
      'lnbc-short',
      {
        prepareSend: jest
          .fn()
          .mockRejectedValue(refusal('INSUFFICIENT_FUNDS', message)),
      },
      {
        balance: {
          totalSats: 10_000,
          availableSats: 1_000,
          pendingSats: 9_000,
          receivableSats: 0,
        },
      },
    );
    await enterAmount(tree, '4200');
    // A new amount lets the refusal go; the review brings it back.
    await act(async () => {
      await label(tree, 'Review payment').props.onPress();
    });
    expect(alerts(tree)).toEqual([message]);
    expect(amountShown(tree).props.accessibilityHint).toContain(message);
    expect(amountShown(tree).props.accessibilityHint).toContain(
      copy.amount.overSpendable,
    );
    await act(async () => tree.unmount());
  });

  test('a quote that runs out as it is sent turns into a refresh', async () => {
    const message = 'The fee quote expired. Review the payment again.';
    const send = jest.fn().mockRejectedValue(refusal('QUOTE_EXPIRED', message));
    const tree = await review('lnbc-late', {
      prepareSend: jest.fn().mockResolvedValue(quote),
      send,
    });
    await act(async () => {
      activate(holds(tree, 'Send 4,200 sats')[0]);
    });
    expect(alerts(tree)).toEqual([message]);
    expect(find(tree, 'Refresh quote')).toBeDefined();
    expect(holds(tree, 'Send 4,200 sats')).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('anything else is a bang by the control, with the words to read', async () => {
    const message = 'The primary node is not connected.';
    const tree = await review('lnbc-down', {
      prepareSend: jest
        .fn()
        .mockRejectedValue(refusal('PRIMARY_DOWN', message)),
    });
    expect(alerts(tree)).toEqual([message]);
    expect(find(tree, 'Review payment')).toBeDefined();
    await act(async () => tree.unmount());
  });
});
