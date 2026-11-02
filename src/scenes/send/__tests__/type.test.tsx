import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { Odometer } from '../../../glyphs/Odometer';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { activate, press } from '../../../../test-support/query';
import { Amount } from '../Amount';
import { rateText, reviewFigures } from '../model';
import {
  REFLOW_SLACK,
  ReviewLines,
  WIDEST_RATE,
  WIDEST_SIGNS,
  rateBelow,
} from '../ReviewLines';
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

/** A review the engine priced as a Bitcoin splice at 2 sat/vB. */
const rated: SendReview = {
  ...review,
  id: 'review-type-rated',
  feeSats: 500,
  feeLabel: 'Estimated network fee',
  estimatedFeeSats: undefined,
  totalSats: 4_700,
  route: 'bitcoin',
  feeRate: 2,
  feeRates: { fast: 8, normal: 2, slow: 1, minimum: 1 },
};

const caps = (root: ReactTestInstance) =>
  root.findAllByType(Text).map(text => text.props.maxFontSizeMultiplier);

const style = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style);

/** The host view `node` is drawn in. */
const hostParent = (node: ReactTestInstance) => {
  let at = node.parent;
  while (at && typeof at.type !== 'string') at = at.parent;
  return at!;
};

/** The sum's lines, as a screen reader finds them, in order. */
const linesOf = (
  tree: ReactTestRenderer,
  figures: ReturnType<typeof reviewFigures>,
) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessible === true &&
      figures.some(figure =>
        String(node.props.accessibilityLabel).endsWith(figure.label),
      ),
  );

/** Every rate text under `node`: the ghost holding the column, and the one shown. */
const rates = (node: ReactTestInstance) =>
  node
    .findAllByType(Text)
    .filter(text => /sat\/vB$/.test(String(text.props.children)));

/** The rates under `node` that are seen. */
const shownRates = (node: ReactTestInstance) =>
  rates(node)
    .filter(text => style(text).opacity !== 0)
    .map(text => text.props.children);

const layout = (node: ReactTestInstance, width: number) =>
  act(async () => {
    node.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 26 } },
    });
  });

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

test("the sum's lines stop growing at 1.4, the fee line's rate with them", async () => {
  for (const shown of [review, rated]) {
    const tree = await draw(<ReviewLines review={shown} />);
    const found = caps(tree.root);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(cap => cap === 1.4)).toBe(true);
    await act(async () => tree.unmount());
  }
});

test('the sum sets its operators in one column and its amounts right, so places line up', async () => {
  const tree = await draw(<ReviewLines review={review} />);
  const figures = reviewFigures(review);
  const lines = linesOf(tree, figures);
  expect(lines).toHaveLength(figures.length);
  // The lines stretch to the widest, so their ends meet.
  const column = lines[0].parent!;
  let at: ReactTestInstance | null = column;
  while (at && typeof at.type !== 'string') at = at.parent;
  expect(StyleSheet.flatten(at!.props.style).alignItems).toBe('stretch');
  lines.forEach((line, index) => {
    const texts = line.findAllByType(Text);
    // The operators' column holds the widest of them, out of sight, on
    // every line, so each line's column is as wide as the others.
    expect(texts[0].props.children).toBe(WIDEST_SIGNS);
    expect(style(texts[0]).opacity).toBe(0);
    expect(texts[1].props.children).toBe(figures[index].signs);
    expect(WIDEST_SIGNS.length).toBeGreaterThanOrEqual(
      figures[index].signs.length,
    );
    // The amount fills the rest of the line, set right, drawn by the
    // odometer at the line's size in tabular figures.
    const amount = line.findByType(Odometer);
    expect(amount.props.variant).toBe('line');
    const box = StyleSheet.flatten(amount.parent!.props.style);
    expect(box.flexGrow).toBe(1);
    expect(box.justifyContent).toBe('flex-end');
  });
  // A sum priced without a rate holds no column for one.
  expect(rates(tree.root)).toEqual([]);
  await act(async () => tree.unmount());
});

test("a rated review's sum holds a rate column on every line, which only the fee line fills, on the figures' baseline", async () => {
  const tree = await draw(<ReviewLines review={rated} />);
  const figures = reviewFigures(rated);
  const lines = linesOf(tree, figures);
  expect(lines).toHaveLength(2);
  lines.forEach((line, index) => {
    // The operators and the rate stand on the figures' baseline; the rail
    // and the amount sit centred, as they did.
    expect(style(line).alignItems).toBe('baseline');
    expect(style(line.findByType(Odometer).parent!).alignSelf).toBe('center');
    // The widest rate holds the column open, out of sight, on every line.
    const ghosts = rates(line).filter(
      text => text.props.children === WIDEST_RATE,
    );
    expect(ghosts).toHaveLength(1);
    expect(style(ghosts[0]).opacity).toBe(0);
    expect(style(ghosts[0]).fontSize).toBe(12);
    // Only the fee line says its rate, in the ghost's place.
    expect(shownRates(line)).toEqual(index === 0 ? [rateText(2)] : []);
    if (index === 0) {
      const [shown] = rates(line).filter(text => style(text).opacity !== 0);
      expect(style(shown).position).toBe('absolute');
      expect(hostParent(shown) === hostParent(ghosts[0])).toBe(true);
    }
  });
  // A screen reader hears the lines as before: the slider says the rate.
  expect(perceived(tree)).toEqual([
    `${copy.send.bitcoin}, Estimated network fee`,
    copy.send.totalWithFee,
  ]);
  await act(async () => tree.unmount());
});

test('the rate drops under the fee once the sum with its column would be wider than its room, and comes back up with room to spare', () => {
  // Unmeasured, the column stands.
  expect(rateBelow(false, 0, 280, 69)).toBe(false);
  expect(rateBelow(false, 342, 0, 69)).toBe(false);
  expect(rateBelow(false, 342, 280, 0)).toBe(false);
  // The sum with its column fits, or is one point too wide.
  expect(rateBelow(false, 342, 273, 69)).toBe(false);
  expect(rateBelow(false, 342, 274, 69)).toBe(true);
  // Below, it comes back up only once it would fit with slack to spare.
  expect(rateBelow(true, 342, 273, 69)).toBe(true);
  expect(rateBelow(true, 342, 273 - REFLOW_SLACK, 69)).toBe(false);
});

test('a sum measured too wide for its room sets the rate under the fee, right to the amounts, and no line holds the column', async () => {
  const tree = await draw(<ReviewLines review={rated} unit="btc" />);
  const figures = reviewFigures(rated);
  const host = (test: (node: ReactTestInstance) => boolean) =>
    tree.root.find(
      node =>
        typeof node.type === 'string' &&
        typeof node.props.onLayout === 'function' &&
        test(node),
    );
  const room = () => host(node => style(node).alignSelf === 'stretch');
  const sum = () =>
    host(
      node =>
        style(node).alignSelf === 'center' &&
        style(node).alignItems === 'stretch',
    );
  const ghost = () =>
    rates(tree.root).find(text => typeof text.props.onLayout === 'function')!;
  // The room, the ghost rate, and the sum laid out with its column: one
  // point too wide.
  await layout(room(), 342);
  await layout(ghost(), 57);
  await layout(sum(), 343);
  let lines = linesOf(tree, figures);
  for (const line of lines) expect(rates(line)).toEqual([]);
  const [shown] = rates(tree.root).filter(text => style(text).opacity !== 0);
  expect(shown.props.children).toBe(rateText(2));
  expect(style(shown).position).toBeUndefined();
  const under = hostParent(shown);
  expect(style(under).alignItems).toBe('flex-end');
  // Its ghost is still measured, out of the flow, beside it.
  expect(style(ghost()).position).toBe('absolute');
  expect(hostParent(ghost()) === under).toBe(true);
  // The fee line and its rate are one block, stretched like the lines.
  const block = hostParent(under);
  expect(style(block).alignItems).toBe('stretch');
  expect(hostParent(lines[0]) === block).toBe(true);
  expect(hostParent(lines[1]) === block).toBe(false);
  // Laid out without the column, the sum is narrower; given more room, the
  // rate goes back up beside the fee.
  await layout(sum(), 274);
  expect(rates(lines[0])).toEqual([]);
  await layout(room(), 400);
  lines = linesOf(tree, figures);
  for (const line of lines) {
    expect(rates(line).map(text => text.props.children)).toContain(WIDEST_RATE);
  }
  expect(shownRates(lines[0])).toEqual([rateText(2)]);
  expect(shownRates(lines[1])).toEqual([]);
  expect(
    rates(tree.root).filter(text => style(text).opacity !== 0),
  ).toHaveLength(1);
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
