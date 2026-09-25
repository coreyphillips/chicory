import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { AmountField } from '../src/components/AmountField';
import { copy } from '../src/design/copy';
import type { Phase } from '../src/stage/phase';
import { initialStage, stageReducer } from '../src/stage/scene';
import type { Scene } from '../src/stage/scene';
import { amountValue, enterAmount } from '../test-support/keypad';
import {
  a11yText,
  alerts,
  field,
  find,
  meaning,
  press,
  pressableLabels,
  visibleText,
} from '../test-support/query';
import { activePhase, activeScene } from '../test-support/scene';

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

const noop = () => {};

describe('query', () => {
  function Screen({ onSend }: { onSend: () => void }) {
    return (
      <View>
        <Text>
          {'4,200'} {'sats'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityHint="Paste or scan a payment request."
          onPress={onSend}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Receive" />
        <TextInput
          accessibilityLabel="Note"
          placeholder="Lunch"
          onChangeText={noop}
        />
        <View
          accessibilityRole="alert"
          accessibilityLabel="Balance not confirmed recently."
        />
        <View accessibilityRole="alert">
          <Text>Payment did not complete.</Text>
        </View>
        <View accessibilityValue={{ text: '3 of 12' }} />
      </View>
    );
  }

  test('press awaits the handler inside act', async () => {
    let sent = false;
    const onSend = async () => {
      await Promise.resolve();
      sent = true;
    };
    const tree = await render(<Screen onSend={onSend} />);
    await press(tree, 'Send');
    expect(sent).toBe(true);
    await act(async () => tree.unmount());
  });

  test('press names what can be pressed when the label is missing', async () => {
    const tree = await render(<Screen onSend={noop} />);
    await expect(press(tree, 'Receive')).rejects.toThrow(
      'No pressable control labelled "Receive". Pressable: "Send".',
    );
    await act(async () => tree.unmount());
  });

  test('find and pressableLabels see only controls with a handler', async () => {
    const tree = await render(<Screen onSend={noop} />);
    expect(find(tree, 'Send')).toBeDefined();
    expect(find(tree, 'Receive')).toBeUndefined();
    expect(pressableLabels(tree)).toEqual(new Set(['Send']));
    await act(async () => tree.unmount());
  });

  test('field finds a text field by label and names the others', async () => {
    const tree = await render(<Screen onSend={noop} />);
    expect(field(tree, 'Note').props.placeholder).toBe('Lunch');
    expect(() => field(tree, 'Amount in sats')).toThrow(
      'No field labelled "Amount in sats". Fields: "Note".',
    );
    await act(async () => tree.unmount());
  });

  test('visibleText, a11yText and meaning read each channel', async () => {
    const tree = await render(<Screen onSend={noop} />);
    expect(visibleText(tree)).toEqual([
      '4,200 sats',
      'Lunch',
      'Payment did not complete.',
    ]);
    expect(a11yText(tree)).toEqual([
      'Send',
      'Paste or scan a payment request.',
      'Receive',
      'Note',
      'Balance not confirmed recently.',
      '3 of 12',
    ]);
    expect(meaning(tree)).toContain('4,200 sats | Lunch');
    expect(meaning(tree)).toContain('Balance not confirmed recently.');
    await act(async () => tree.unmount());
  });

  test('alerts read the label, or the text inside when there is none', async () => {
    const tree = await render(<Screen onSend={noop} />);
    expect(alerts(tree)).toEqual([
      'Balance not confirmed recently.',
      'Payment did not complete.',
    ]);
    await act(async () => tree.unmount());
  });
});

describe('keypad', () => {
  function Keypad() {
    const [digits, setDigits] = useState('12');
    return (
      <View>
        <View
          accessibilityLabel={copy.amount.field}
          accessibilityValue={{ text: digits ? `${digits} sats` : '0 sats' }}
        />
        <View accessibilityLabel="Amount keypad">
          {'0123456789'.split('').map(key => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key}
              onPress={() => setDigits(value => value + key)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.amount.backspace}
            onPress={() => setDigits(value => value.slice(0, -1))}
          />
        </View>
      </View>
    );
  }

  function Field() {
    const [value, setValue] = useState('12');
    return <AmountField value={value} onChangeText={setValue} />;
  }

  test('on the keypad, the amount is cleared and keyed in', async () => {
    const tree = await render(<Keypad />);
    expect(amountValue(tree)).toBe('12');
    await enterAmount(tree, '4200');
    expect(amountValue(tree)).toBe('4200');
    await act(async () => tree.unmount());
  });

  test('without a keypad, the amount is typed into the field', async () => {
    const tree = await render(<Field />);
    await enterAmount(tree, '4200');
    expect(amountValue(tree)).toBe('4200');
    expect(field(tree, 'Amount in sats').props.value).toBe('4,200');
    await act(async () => tree.unmount());
  });
});

describe('scene', () => {
  // One found by its displayName, one by its own name through memo.
  function Shell(_: { phase: Phase }) {
    return null;
  }
  Shell.displayName = 'Stage';
  const Pane = React.memo(function Canvas(_: { scene: Scene }) {
    return null;
  });

  test('both readers answer null before there is a stage', async () => {
    const tree = await render(<View />);
    expect(activePhase(tree)).toBeNull();
    expect(activeScene(tree)).toBeNull();
    await act(async () => tree.unmount());
  });

  test('they read the phase and the scene from Stage and Canvas', async () => {
    const stage = stageReducer(initialStage(), {
      type: 'open',
      scene: { name: 'receive' },
    });
    const tree = await render(
      <View>
        <Shell phase={{ kind: 'wallet', error: '' }} />
        <Pane scene={stage.scene} />
      </View>,
    );
    expect(activePhase(tree)).toBe('wallet');
    expect(activeScene(tree)).toBe('receive');
    await act(async () => tree.unmount());
  });
});
