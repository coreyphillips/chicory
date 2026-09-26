import React, { useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import Svg, { Path } from 'react-native-svg';
import { AmountField } from '../../../components/AmountField';
import { copy } from '../../../design/copy';
import { GLYPHS } from '../../../design/glyphs';
import { palette } from '../../../design/palette';
import * as tokens from '../../../motion/tokens';
import { Pane } from '../../../stage/panes/Pane';
import { mount } from '../../../../test-support/guard';
import { amountValue, enterAmount } from '../../../../test-support/keypad';
import { find, press, visibleText } from '../../../../test-support/query';
import { AmountReadout, STATE_GLYPH, STATE_PIP, leave } from '../AmountReadout';
import { amountSize } from '../fit';
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

test("a hold that clears the amount still lets backspace's disc spring back", async () => {
  const tree = await mount(<Field start="4200" />);
  // Backspace as drawn, live or idle.
  const backspace = () =>
    tree.root.find(
      node =>
        node.props.accessibilityLabel === copy.keypad.backspace &&
        node.props.delayLongPress !== undefined,
    );
  await act(async () => backspace().props.onPressIn());
  await act(async () => backspace().props.onLongPress());
  expect(amountValue(tree)).toBe('');
  // Idle under the finger, and the finger still lifts the disc.
  expect(backspace().props.disabled).toBe(true);
  expect(typeof backspace().props.onPressOut).toBe('function');
  await act(async () => backspace().props.onPressOut());
  // Drawn again as a digit wakes it, it stands back at rest.
  await press(tree, '5');
  expect(disc(tree, copy.keypad.backspace)).toEqual({
    opacity: 0,
    scale: 0.6,
  });
  await act(async () => tree.unmount());
});

test('a screen reader clears the amount with the long press action', async () => {
  const tree = await mount(<Field start="4200" />);
  const backspace = find(tree, copy.keypad.backspace)!;
  // VoiceOver lists it by its label, not as "longpress".
  expect(backspace.props.accessibilityActions).toEqual([
    { name: 'longpress', label: copy.keypad.clear },
  ]);
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

test('the amount moves as one: only its row eases, and nothing in it slides past another', async () => {
  const tree = await mount(
    <AmountField value="88000" onChangeText={jest.fn()} tone="honey" />,
  );
  const rows = () =>
    readout(tree).findAll(
      node =>
        typeof node.type !== 'string' &&
        node.props.layout !== undefined &&
        StyleSheet.flatten(node.props.style)?.flexDirection === 'row',
    );
  // The row eases to where its new width centres it.
  expect(rows().length).toBe(1);
  const [row] = rows();
  // What is in it is laid out afresh at once: a digit keeps its cell, the
  // unit and the mark stand where the digits end, and no cell slides on a
  // transition of its own, so an arriving digit never shows over the unit
  // and a comma never leaves a gap as it moves.
  const sliding = row
    .findAll(
      node => typeof node.type !== 'string' && node.props.layout !== undefined,
    )
    .filter(node => node !== row);
  expect(sliding.length).toBe(0);
  const cells = () =>
    rows()[0]
      .findAllByType(Text)
      .map(text => String(text.props.children));
  expect(cells()).toEqual(['8', '8,', '0', '0', '0', 'sats']);
  await act(async () =>
    tree.update(
      <AmountField value="880000" onChangeText={jest.fn()} tone="honey" />,
    ),
  );
  expect(cells()).toEqual(['8', '8', '0,', '0', '0', '0', 'sats']);
  // A digit rises in, and one deleted drops away.
  const digits = rows()[0].findAll(
    node =>
      typeof node.type !== 'string' &&
      node.props.entering !== undefined &&
      node.props.exiting !== undefined,
  );
  expect(digits.length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});

/** How a deleted digit leaves: where it starts, and each timing it runs. */
function leaving() {
  const timings = jest.spyOn(Reanimated, 'withTiming');
  const exit = leave()({} as never) as {
    initialValues: { opacity: number; transform?: object[] };
  };
  const runs = timings.mock.calls.map(([to, config]) => ({
    to,
    ms: config?.duration,
  }));
  timings.mockRestore();
  return { from: exit.initialValues, runs };
}

test('a deleted digit starts faint and drops away within half a tick, so it never sits whole over the unit', () => {
  // Whole in its first frame, it sat over "sats" for 70 to 80ms (P12, 04g).
  const { from, runs } = leaving();
  expect(from.opacity).toBeLessThanOrEqual(0.3);
  expect(runs).toEqual([
    { to: 0, ms: tokens.durations.tick / 2 },
    { to: 8, ms: tokens.durations.tick / 2 },
  ]);
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

test('a long amount steps down to fit its field with its unit and its disc, and never shrinks by the frame', async () => {
  // 999,999,999 in radish with its 32pt disc ran past a 354pt field: the
  // first 9 and half the disc were cut off (P12, 09d).
  const FIELD = 354;
  const scale = Math.min(Dimensions.get('window').fontScale, 1.2);
  const field = (value: string, tone?: 'radish') => (
    <AmountField value={value} onChangeText={jest.fn()} tone={tone} />
  );
  const tree = await mount(field('999999999', 'radish'));
  await act(async () =>
    readout(tree).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: FIELD, height: 96 } },
    }),
  );
  const sizes = () =>
    readout(tree)
      .findAllByType(Text)
      .filter(node => /\d/.test(String(node.props.children)))
      .map(node => StyleSheet.flatten(node.props.style).fontSize);
  const row = (marks: number[]) => ({ figures: 9, separators: 2, marks });
  const radish = amountSize(row([8 + STATE_PIP]), FIELD, scale);
  expect(radish).toBeLessThan(48);
  expect(sizes()).toEqual(Array(9).fill(radish));
  // Stepped, never shrunk per figure by the system.
  expect(
    readout(tree)
      .findAllByType(Text)
      .some(node => node.props.adjustsFontSizeToFit),
  ).toBe(false);
  // In cream, with no disc, the same figures fit without it.
  await act(async () => tree.update(field('999999999')));
  const cream = amountSize(row([]), FIELD, scale);
  expect(cream).toBeGreaterThanOrEqual(radish);
  expect(sizes()).toEqual(Array(9).fill(cream));
  // And a short amount keeps the full 48.
  await act(async () => tree.update(field('4200')));
  expect(sizes()).toEqual([48, 48, 48, 48]);
  await act(async () => tree.unmount());
});

test('a 17th digit is refused, with a rigid tap, and a screen reader hears why', async () => {
  const said = jest.mocked(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  );
  said.mockClear();
  const full = '2100000000000000';
  const tree = await mount(<Field start={full} />);
  await press(tree, '7');
  expect(amountValue(tree)).toBe(full);
  expect(felt()).toEqual(['rigid']);
  expect(said.mock.calls.map(([text]) => text)).toEqual([copy.keypad.refused]);
  // A key that is taken says nothing.
  said.mockClear();
  await press(tree, copy.keypad.backspace);
  await press(tree, '7');
  expect(said).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

/** The key labelled `label`, as a screen reader reaches it. */
const keyed = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

test('every key is a button a screen reader can name', async () => {
  const tree = await mount(<Field start="42" />);
  for (const label of [...copy.keypad.digits, copy.keypad.backspace]) {
    expect(keyed(tree, label).props.accessibilityRole).toBe('button');
    expect(keyed(tree, label).props.accessibilityState).toEqual({
      disabled: false,
    });
  }
  await act(async () => tree.unmount());
});

test('with nothing entered, zero and backspace are dimmed and disabled until a digit comes', async () => {
  const tree = await mount(<Field />);
  for (const label of ['0', copy.keypad.backspace]) {
    expect(keyed(tree, label).props.accessibilityRole).toBe('button');
    expect(keyed(tree, label).props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(find(tree, label)).toBeUndefined();
  }
  const zero = keyed(tree, '0').findByType(Text);
  expect(StyleSheet.flatten(zero.props.style).color).toBe(palette.dust);
  expect(keyed(tree, '5').props.accessibilityState).toEqual({
    disabled: false,
  });
  await press(tree, '5');
  await press(tree, '0');
  expect(amountValue(tree)).toBe('50');
  expect(keyed(tree, copy.keypad.backspace).props.accessibilityState).toEqual({
    disabled: false,
  });
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

test.each([
  ['honey', palette.honey, palette.honeySoft],
  ['radish', palette.radish, palette.radishSoft],
  ['dust', palette.dust, palette.mocha],
] as const)(
  "a %s limit's glyph is a state glyph on its tone's disc, level with the figures",
  async (tone, color, soft) => {
    const tree = await mount(
      <AmountField value="42" onChangeText={jest.fn()} tone={tone} />,
    );
    const [pip] = readout(tree).findAll(
      node =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.backgroundColor === soft &&
        StyleSheet.flatten(node.props.style)?.width === STATE_PIP,
    );
    expect(pip).toBeDefined();
    const { height, borderRadius } = StyleSheet.flatten(pip.props.style);
    expect(height).toBe(STATE_PIP);
    expect(borderRadius).toBe(STATE_PIP / 2);
    // A glyph of a readable size, in the tone, not a speck beside the unit.
    const [glyph] = pip.findAllByType(Svg);
    expect(glyph.props.width).toBe(STATE_GLYPH);
    expect(STATE_GLYPH).toBeGreaterThanOrEqual(20);
    expect(
      pip.findAll(
        node => node.props.stroke === color || node.props.color === color,
      ),
    ).not.toEqual([]);
    // Centred on the amount's line, where the figures stand.
    let at: ReactTestInstance | null = pip.parent;
    while (at && StyleSheet.flatten(at.props.style)?.alignSelf !== 'center') {
      at = at.parent;
    }
    expect(at).not.toBeNull();
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
  // They are amounts, so they stop growing at 1.4 as the line amounts do.
  for (const label of ['1,000', '10,000', '50,000']) {
    const caps = find(tree, label)!
      .findAllByType(Text)
      .map(node => node.props.maxFontSizeMultiplier);
    expect(caps).toEqual([1.4]);
  }
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

test('under Reduce Motion a deleted digit only fades, as faint and as fast', async () => {
  // Reduce Motion was read by the test before.
  const { from, runs } = leaving();
  expect(from).toEqual({ opacity: 0.3 });
  expect(runs).toEqual([{ to: 0, ms: tokens.durations.tick / 2 }]);
});
