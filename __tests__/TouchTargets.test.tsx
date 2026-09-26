import React from 'react';
import { StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import { AmountField } from '../src/components/AmountField';
import { Chip, IconButton } from '../src/components/ui';
import { copy } from '../src/design/copy';
import { MIN_TARGET } from '../src/theme';
import { mount } from '../test-support/guard';

/**
 * The shared controls meet the least touch target (REDESIGN.md 3.4): their
 * frame and their hitSlop together reach MIN_TARGET each way. A frame is
 * read from its style, as Jest lays nothing out.
 */
const noop = () => {};

type Slop = { top?: number; bottom?: number; left?: number; right?: number };

/** How far `node`, a host button, can be touched across and down. */
function reach(node: ReactTestInstance) {
  const style = StyleSheet.flatten(node.props.style) ?? {};
  const raw = node.props.hitSlop as Slop | number | undefined;
  const slop: Slop =
    typeof raw === 'number'
      ? { top: raw, bottom: raw, left: raw, right: raw }
      : raw ?? {};
  const across = (style.width ?? style.minWidth ?? 0) as number;
  const down = (style.height ?? style.minHeight ?? 0) as number;
  return {
    across: across + (slop.left ?? 0) + (slop.right ?? 0),
    down: down + (slop.top ?? 0) + (slop.bottom ?? 0),
  };
}

/** Every host node labelled `label` that is a button. */
const buttons = (root: ReactTestInstance, label: string) =>
  root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === label,
  );

test('an icon button is a 48pt frame, before its hitSlop', async () => {
  const tree = await mount(
    <IconButton name="close" accessibilityLabel="Close" onPress={noop} />,
  );
  const [button] = buttons(tree.root, 'Close');
  const style = StyleSheet.flatten(button.props.style);
  expect(style.width).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(style.height).toBeGreaterThanOrEqual(MIN_TARGET);
  await act(async () => tree.unmount());
});

test('a chip is touched over at least 48pt each way', async () => {
  const tree = await mount(
    <Chip label="1,000 sats" selected={false} onPress={noop} />,
  );
  const [chip] = buttons(tree.root, '1,000 sats');
  const { across, down } = reach(chip);
  expect(across).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(down).toBeGreaterThanOrEqual(MIN_TARGET);
  await act(async () => tree.unmount());
});

test("Receive's preset chips reach 48pt, and their reach stays off their neighbours", async () => {
  const presets = [1_000, 10_000, 50_000];
  const tree = await mount(
    <AmountField value="" onChangeText={noop} presets={presets} />,
  );
  for (const preset of presets) {
    const [chip] = buttons(tree.root, copy.amount.preset(preset));
    expect(chip).toBeDefined();
    const { down } = reach(chip);
    expect(down).toBeGreaterThanOrEqual(MIN_TARGET);
    // The chips sit side by side, so none reaches sideways into the next.
    const slop = chip.props.hitSlop as Slop;
    expect(slop.left ?? 0).toBe(0);
    expect(slop.right ?? 0).toBe(0);
  }
  await act(async () => tree.unmount());
});
