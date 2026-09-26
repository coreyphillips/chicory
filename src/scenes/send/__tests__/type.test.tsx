import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { activate, press } from '../../../../test-support/query';
import { Amount } from '../Amount';
import { reviewFigures } from '../model';
import { ReviewLines, WIDEST_SIGNS } from '../ReviewLines';
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

test('the sum sets its operators in one column and its amounts right, so places line up', async () => {
  const tree = await draw(<ReviewLines review={review} />);
  const figures = reviewFigures(review);
  const lines = tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessible === true &&
      figures.some(figure =>
        String(node.props.accessibilityLabel).endsWith(figure.label),
      ),
  );
  expect(lines).toHaveLength(figures.length);
  // The lines stretch to the widest, so their ends meet.
  const column = lines[0].parent!;
  let at: ReactTestInstance | null = column;
  while (at && typeof at.type !== 'string') at = at.parent;
  expect(StyleSheet.flatten(at!.props.style).alignItems).toBe('stretch');
  lines.forEach((line, index) => {
    const texts = line.findAllByType(Text);
    const style = (text: ReactTestInstance) =>
      StyleSheet.flatten(text.props.style);
    // The operators' column holds the widest of them, out of sight, on
    // every line, so each line's column is as wide as the others.
    expect(texts[0].props.children).toBe(WIDEST_SIGNS);
    expect(style(texts[0]).opacity).toBe(0);
    expect(texts[1].props.children).toBe(figures[index].signs);
    expect(WIDEST_SIGNS.length).toBeGreaterThanOrEqual(
      figures[index].signs.length,
    );
    // The amount fills the rest of the line, set right in tabular figures.
    const amount = style(texts[2]);
    expect(amount.textAlign).toBe('right');
    expect(amount.flexGrow).toBe(1);
    expect(amount.fontVariant).toEqual(['tabular-nums']);
  });
  await act(async () => tree.unmount());
});

test("the rail is part of the fee's line, never a small element of its own", async () => {
  const tree = await draw(<ReviewLines review={review} />);
  expect(perceived(tree)).toEqual([
    `${copy.send.lightning}, Maximum fee`,
    copy.send.expectedFee,
    copy.send.totalAtMost,
  ]);
  // Nothing in the sum takes a touch.
  expect(
    tree.root.findAll(node => typeof node.props.onPress === 'function'),
  ).toEqual([]);
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
      initialRequest="bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.000042&label=type"
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
