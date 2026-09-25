import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { mixHex, palette } from '../../../design/palette';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { HoldButton } from '../../../glyphs/HoldButton';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { activate, field, press } from '../../../../test-support/query';
import { bloomFor } from '../tone';

/**
 * A payment on a test network (REDESIGN.md 3.1 and rule 4): slate stands in
 * for bloom in everything Send draws, the hold and its ring included, so a
 * payment of play money never looks like one of real money.
 */
const BLOOMS: string[] = [
  palette.bloom,
  palette.bloomSoft,
  palette.bloomHi,
  palette.glass,
];

/** Every colour anything in the tree is drawn with, as it was given. */
function colours(tree: ReactTestRenderer): Set<string> {
  const found = new Set<string>();
  for (const node of tree.root.findAll(() => true)) {
    const { props } = node;
    for (const key of ['color', 'stroke', 'fill', 'selectionColor']) {
      if (typeof props[key] === 'string') found.add(props[key]);
    }
    const style = StyleSheet.flatten(props.style) ?? {};
    for (const key of ['backgroundColor', 'borderColor', 'color'] as const) {
      const value = (style as Record<string, unknown>)[key];
      if (typeof value === 'string') found.add(value);
    }
  }
  return found;
}

const bloomIn = (tree: ReactTestRenderer) =>
  [...colours(tree)].filter(colour => BLOOMS.includes(colour));

async function draw(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<GestureHandlerRootView>{element}</GestureHandlerRootView>);
  });
  return tree;
}

describe.each([
  ['a test network', true],
  ['mainnet', false],
])('on %s', (_, onTest) => {
  const expectTone = (tree: ReactTestRenderer) => {
    if (onTest) {
      expect(bloomIn(tree)).toEqual([]);
      expect(colours(tree)).toContain(palette.slate);
    } else {
      expect(bloomIn(tree)).not.toEqual([]);
      expect(colours(tree)).not.toContain(palette.slate);
    }
  };

  test('the hold is drawn in its tone, busy or not', async () => {
    const hold = (busy: boolean) => (
      <HoldButton
        accessibilityLabel="Send 4,200 sats"
        onCommit={jest.fn()}
        busy={busy}
        test={onTest}
      />
    );
    const tree = await draw(hold(false));
    expectTone(tree);
    await act(async () => tree.update(hold(true)));
    expectTone(tree);
    await act(async () => tree.unmount());
  });

  test('the quote ring is drawn in its tone while calm', async () => {
    const tree = await draw(
      <ExpiryRing size={104} expiresAt={Date.now() + 60_000} test={onTest} />,
    );
    expectTone(tree);
    await act(async () => tree.unmount());
  });

  test('every step of a payment is drawn in its tone', async () => {
    const review: SendReview = {
      id: 'review-slate',
      destination: 'recipient',
      description: '',
      amountSats: 4_200,
      feeSats: 20,
      feeLabel: 'Maximum fee',
      totalSats: 4_220,
      route: 'lightning',
      expiresAt: Date.now() + 600_000,
      warnings: [],
    };
    const pending: SendResult = {
      id: 'p-slate',
      status: 'pending',
      amountSats: 4_200,
      feeSats: 20,
      message: 'On its way.',
    };
    const client = {
      prepareSend: jest.fn().mockResolvedValue(review),
      send: jest.fn().mockResolvedValue(pending),
    } as unknown as WalletAdapter;
    const tree = await draw(
      <SendScreen
        client={client}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={jest.fn()}
        test={onTest}
      />,
    );
    // Typing, the well's caret. Each run pays a request of its own, since a
    // pending payment holds the one it paid.
    await act(async () => {
      field(tree, copy.send.request).props.onChangeText(
        `lnbc1slate${onTest ? 'test' : 'main'}`,
      );
    });
    expectTone(tree);
    await press(tree, copy.send.review);
    expectTone(tree);
    await activate(tree, copy.send.sendSats(4_200));
    expectTone(tree);
    await act(async () => tree.unmount());
  });
});

test('the soft fill behind a test network control is the palette’s slateSoft', () => {
  // The same step from roast toward slate as bloomSoft is toward bloom.
  const channels = (color: string) =>
    color.startsWith('#')
      ? [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16))
      : color.match(/\d+/g)!.map(Number);
  expect(bloomFor(true).soft).toBe(palette.slateSoft);
  expect(channels(palette.slateSoft)).toEqual(
    channels(mixHex(palette.roast, palette.slate, 0.18)),
  );
  expect(channels(palette.bloomSoft)).toEqual(
    channels(mixHex(palette.roast, palette.bloom, 0.18)),
  );
});
