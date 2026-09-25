import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { AmountField } from '../../../components/AmountField';
import { copy } from '../../../design/copy';
import { Pane } from '../../../stage/panes/Pane';
import { mount } from '../../../../test-support/guard';
import { amountValue, enterAmount } from '../../../../test-support/keypad';
import { find, press, visibleText } from '../../../../test-support/query';
import { AmountReadout } from '../AmountReadout';
import { CLEAR_AFTER_MS } from '../Keypad';
import type { AmountTone } from '../keys';

/**
 * The amount keypad (REDESIGN.md 5 and 10.3): the keys the suites press, what
 * each does to the amount, and the amount a screen reader hears.
 */
function Field({ start = '' }: { start?: string }) {
  const [value, setValue] = useState(start);
  return <AmountField value={value} onChangeText={setValue} />;
}

const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

const readout = (tree: ReactTestRenderer) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityLabel === copy.amount.field,
  );

beforeEach(() => jest.mocked(HapticFeedback.trigger).mockClear());

test('digits are keyed in and read out grouped, with no system keyboard', async () => {
  const tree = await mount(<Field />);
  expect(readout(tree).props.accessibilityValue.text).toBe('0 sats');
  await enterAmount(tree, '4200');
  expect(amountValue(tree)).toBe('4200');
  expect(readout(tree).props.accessibilityValue.text).toBe('4,200 sats');
  expect(visibleText(tree)).toEqual([
    '4,',
    '2',
    '0',
    '0',
    'sats',
    ...'1234567890',
  ]);
  expect(tree.root.findAllByType(TextInput)).toEqual([]);
  await act(async () => tree.unmount());
});

test('every key ticks, and backspace deletes the last digit', async () => {
  const tree = await mount(<Field start="42" />);
  const backspace = find(tree, copy.keypad.backspace)!;
  expect(backspace.props.accessibilityHint).toBe(copy.keypad.backspaceHint);
  await act(async () => backspace.props.onPressIn());
  expect(felt()).toEqual(['selection']);
  await press(tree, copy.keypad.backspace);
  expect(amountValue(tree)).toBe('4');
  await act(async () => tree.unmount());
});

test('holding backspace clears the amount with a rigid tap', async () => {
  const tree = await mount(<Field start="4200" />);
  const backspace = find(tree, copy.keypad.backspace)!;
  expect(backspace.props.delayLongPress).toBe(CLEAR_AFTER_MS);
  await act(async () => backspace.props.onLongPress());
  expect(amountValue(tree)).toBe('');
  expect(felt()).toEqual(['rigid']);
  await act(async () => tree.unmount());
});

test('a 17th digit is refused, with a rigid tap', async () => {
  const full = '2100000000000000';
  const tree = await mount(<Field start={full} />);
  await press(tree, '7');
  expect(amountValue(tree)).toBe(full);
  expect(felt()).toEqual(['rigid']);
  await act(async () => tree.unmount());
});

test('a zero in front of nothing leaves the amount empty', async () => {
  const tree = await mount(<Field />);
  await press(tree, '0');
  expect(amountValue(tree)).toBe('');
  await act(async () => tree.unmount());
});

test('an amount set elsewhere shows a lock, drops the keypad and says why', async () => {
  const tree = await mount(
    <AmountField
      value="24425"
      onChangeText={jest.fn()}
      editable={false}
      hint={copy.amount.fixed}
    />,
  );
  expect(
    tree.root.findAllByProps({ accessibilityLabel: copy.keypad.label }),
  ).toHaveLength(0);
  const amount = readout(tree);
  expect(amount.props.accessibilityState.disabled).toBe(true);
  expect(amount.props.accessibilityHint).toBe(copy.amount.fixed);
  expect(amountValue(tree)).toBe('24425');
  await act(async () => tree.unmount());
});

test('while busy, or in a pane out of use, no key takes a touch', async () => {
  for (const element of [
    <AmountReadout
      accessibilityLabel={copy.amount.field}
      value="42"
      onChangeText={jest.fn()}
      busy
    />,
    <Pane active={false}>
      <Field start="42" />
    </Pane>,
  ]) {
    const tree = await mount(element);
    for (const key of [...copy.keypad.digits, copy.keypad.backspace]) {
      expect(find(tree, key)).toBeUndefined();
    }
    await act(async () => tree.unmount());
  }
});

test('going over what the amount can ever be is felt once', async () => {
  const tree = await mount(
    <AmountReadout
      accessibilityLabel={copy.amount.field}
      value="42"
      onChangeText={jest.fn()}
    />,
  );
  const tone = (next: AmountTone) =>
    act(async () =>
      tree.update(
        <AmountReadout
          accessibilityLabel={copy.amount.field}
          value="42"
          onChangeText={jest.fn()}
          tone={next}
        />,
      ),
    );
  await tone('over-spendable');
  expect(felt()).toEqual([]);
  await tone('over-total');
  await tone('over-total');
  expect(felt()).toEqual(['notificationWarning']);
  await act(async () => tree.unmount());
});

test('presets are chips labelled with their amount alone', async () => {
  const onChangeText = jest.fn();
  const tree = await mount(
    <AmountField
      value=""
      onChangeText={onChangeText}
      presets={[1000, 10000, 50000]}
    />,
  );
  await press(tree, '10,000');
  expect(onChangeText).toHaveBeenLastCalledWith('10000');
  await act(async () => tree.unmount());
});
