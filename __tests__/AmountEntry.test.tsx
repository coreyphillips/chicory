import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AmountField } from '../src/components/AmountField';

const field = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onChangeText === 'function')!;

test('separators are shown to the reader but never reported to the caller', async () => {
  // parseSats accepts /^\d+$/ only. The old placeholder invited "10,000" and
  // then refused it, so grouping has to be display-only.
  const onChangeText = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AmountField value="10000" onChangeText={onChangeText} />,
    );
  });
  expect(field(tree, 'Amount in sats').props.value).toBe('10,000');

  await act(async () => {
    field(tree, 'Amount in sats').props.onChangeText('10,0000');
  });
  expect(onChangeText).toHaveBeenLastCalledWith('100000');

  // Anything a keyboard or a paste can produce is reduced to digits.
  for (const [typed, expected] of [
    ['1 000', '1000'],
    ['0.5', '05'],
    ['abc', ''],
    ['12,345 sats', '12345'],
  ] as const) {
    await act(async () => {
      field(tree, 'Amount in sats').props.onChangeText(typed);
    });
    expect(onChangeText).toHaveBeenLastCalledWith(expected);
  }
  await act(async () => tree.unmount());
});

test('a preset reports a bare integer and shows as selected', async () => {
  const onChangeText = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AmountField
        value="10000"
        onChangeText={onChangeText}
        presets={[1000, 10000, 50000]}
      />,
    );
  });
  const preset = tree.root
    .findAllByProps({ accessibilityLabel: '50,000' })
    .find(node => typeof node.props.onPress === 'function')!;
  await act(async () => preset.props.onPress());
  expect(onChangeText).toHaveBeenLastCalledWith('50000');

  const selected = tree.root
    .findAllByProps({ accessibilityLabel: '10,000' })
    .find(node => node.props.accessibilityState)!;
  expect(selected.props.accessibilityState.selected).toBe(true);
  await act(async () => tree.unmount());
});
