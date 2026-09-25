import React from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { activate, press } from '../../../../test-support/query';
import { Amount } from '../Amount';
import { ReviewLines } from '../ReviewLines';
import { clearHeldRequests } from '../../../stage/heldRequests';

// The held set lives as long as the process, so each test starts with nothing
// held, and a request one test held never holds another test's.
beforeEach(() => clearHeldRequests());

/**
 * Send's figures against Dynamic Type (REDESIGN.md 3.3): an amount and its
 * unit stop growing at 1.2, the sum's lines and the fee paid at 1.4, and an
 * amount is one element to a screen reader, whatever draws it.
 */
const review: SendReview = {
  id: 'review-type',
  destination: 'recipient',
  description: 'Coffee beans',
  amountSats: 4_200,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  estimatedFeeSats: 5,
  totalSats: 4_220,
  route: 'lightning',
  expiresAt: Date.now() + 600_000,
  warnings: [],
};

const caps = (root: ReactTestInstance) =>
  root.findAllByType(Text).map(text => text.props.maxFontSizeMultiplier);

/** The labels of the elements a screen reader stops on, in tree order. */
function perceived(tree: ReactTestRenderer): string[] {
  const hidden = (node: ReactTestInstance | null): boolean =>
    !!node &&
    (node.props.accessibilityElementsHidden === true ||
      node.props.importantForAccessibility === 'no-hide-descendants' ||
      hidden(node.parent));
  return tree.root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessible === true &&
        !hidden(node),
    )
    .map(node => node.props.accessibilityLabel);
}

async function draw(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<GestureHandlerRootView>{element}</GestureHandlerRootView>);
  });
  return tree;
}

test("the sum's lines stop growing at 1.4", async () => {
  const tree = await draw(<ReviewLines review={review} />);
  const found = caps(tree.root);
  expect(found.length).toBeGreaterThan(0);
  expect(found.every(cap => cap === 1.4)).toBe(true);
  await act(async () => tree.unmount());
});

test('an amount and its unit stop growing at 1.2, as one element', async () => {
  const tree = await draw(<Amount sats={4_200} />);
  const found = caps(tree.root);
  expect(found.length).toBeGreaterThan(0);
  expect(found.every(cap => cap === 1.2)).toBe(true);
  expect(perceived(tree)).toEqual([copy.amount.spoken(4_200)]);
  await act(async () => tree.unmount());
});

test('a review and its result cap every figure and line they draw', async () => {
  const paid: SendResult = {
    id: 'p-type',
    status: 'completed',
    amountSats: 4_200,
    feeSats: 20,
    message: 'Payment sent.',
  };
  const client = {
    prepareSend: jest.fn().mockResolvedValue(review),
    send: jest.fn().mockResolvedValue(paid),
  } as unknown as WalletAdapter;
  const tree = await draw(
    <SendScreen
      client={client}
      initialRequest="lnbc-type"
      onActivity={jest.fn()}
      onRefresh={jest.fn()}
      onBusy={jest.fn()}
    />,
  );
  await press(tree, copy.send.review);
  const onReview = caps(tree.root.findByType(SendScreen));
  await activate(tree, copy.send.sendSats(4_200));
  const onResult = caps(tree.root.findByType(SendScreen));
  for (const cap of [...onReview, ...onResult]) {
    expect(cap === 1.2 || cap === 1.4).toBe(true);
  }
  await act(async () => tree.unmount());
});
