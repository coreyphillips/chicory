import React, { useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { Path } from 'react-native-svg';
import { AmountField } from '../../../components/AmountField';
import { copy } from '../../../design/copy';
import { GLYPHS } from '../../../design/glyphs';
import { palette } from '../../../design/palette';
import * as tokens from '../../../motion/tokens';
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

/** How the mocha disc behind the key labelled `label` stands. */
function disc(tree: ReactTestRenderer, label: string) {
  const [shape] = find(tree, label)!.findAll(
    node =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.backgroundColor === palette.mocha,
  );
  const { opacity, transform } = StyleSheet.flatten(shape.props.style);
  return { opacity, scale: transform[0].scale };
}

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

test('the disc behind a key waits hidden and small, to spring in', async () => {
  const tree = await mount(<Field />);
  expect(disc(tree, '7')).toEqual({ opacity: 0, scale: 0.6 });
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

test('a screen reader clears the amount with the long press action', async () => {
  const tree = await mount(<Field start="4200" />);
  const backspace = find(tree, copy.keypad.backspace)!;
  expect(backspace.props.accessibilityActions).toEqual([{ name: 'longpress' }]);
  await act(async () =>
    backspace.props.onAccessibilityAction({
      nativeEvent: { actionName: 'longpress' },
    }),
  );
  expect(amountValue(tree)).toBe('');
  expect(felt()).toEqual(['rigid']);
  // A digit key has no such action.
  expect(find(tree, '4')!.props.accessibilityActions).toBeUndefined();
  await act(async () => tree.unmount());
});

test('the amount and its unit stop growing at 1.2', async () => {
  const tree = await mount(<Field start="4200" />);
  const caps = readout(tree)
    .findAllByType(Text)
    .map(node => node.props.maxFontSizeMultiplier);
  expect(caps.length).toBeGreaterThan(1);
  expect(caps.every(cap => cap === 1.2)).toBe(true);
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

test("an empty amount stands its caller's face in place of the 0, until a digit comes", async () => {
  const face = <View testID="face" />;
  const tree = await mount(
    <AmountField value="" onChangeText={jest.fn()} empty={face} />,
  );
  const faces = () =>
    readout(tree).findAll(
      node => typeof node.type === 'string' && node.props.testID === 'face',
    );
  const drawn = () =>
    readout(tree)
      .findAllByType(Text)
      .map(node => node.props.children);
  expect(faces()).toHaveLength(1);
  expect(drawn()).toEqual(['sats']);
  await act(async () =>
    tree.update(
      <AmountField value="5" onChangeText={jest.fn()} empty={face} />,
    ),
  );
  expect(faces()).toHaveLength(0);
  expect(drawn()).toEqual(['5', 'sats']);
  await act(async () => tree.unmount());
});

test.each([
  ['honey', palette.honey, GLYPHS.clock[0].d],
  ['radish', palette.radish, GLYPHS.bang[0].d],
  ['dust', palette.dust, GLYPHS.sprout[0].d],
] as const)(
  'a %s tone colours the amount, with the mark that says why',
  async (tone, color, mark) => {
    const tree = await mount(
      <AmountField value="42" onChangeText={jest.fn()} tone={tone} />,
    );
    const digits = readout(tree)
      .findAllByType(Text)
      .filter(node => node.props.children !== 'sats');
    for (const digit of digits) {
      expect(StyleSheet.flatten(digit.props.style).color).toBe(color);
    }
    const marks = readout(tree)
      .findAllByType(Path)
      .map(node => node.props.d);
    if (mark) expect(marks).toContain(mark);
    else expect(marks).toEqual([]);
    await act(async () => tree.unmount());
  },
);

test('each change of its shake key shakes the amount once more', async () => {
  const shakes = jest.spyOn(tokens, 'shake');
  const field = (shake: number) => (
    <AmountField value="42" onChangeText={jest.fn()} shake={shake} />
  );
  const tree = await mount(field(0));
  expect(shakes).not.toHaveBeenCalled();
  await act(async () => tree.update(field(1)));
  await act(async () => tree.update(field(1)));
  expect(shakes).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(field(2)));
  expect(shakes).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
  shakes.mockRestore();
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

// Last in the file: Reduce Motion, once read, holds for the rest of it.
test('under Reduce Motion the disc waits full size, to only fade in, and a key still ticks', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const tree = await mount(<Field />);
  expect(disc(tree, '7')).toEqual({ opacity: 0, scale: 1 });
  await act(async () => find(tree, '7')!.props.onPressIn());
  expect(felt()).toEqual(['selection']);
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});
