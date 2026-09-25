import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { AmountField } from '../src/components/AmountField';
import { copy } from '../src/design/copy';
import type { Phase } from '../src/stage/phase';
import { initialStage, stageReducer } from '../src/stage/scene';
import type { Scene } from '../src/stage/scene';
import { chipText } from '../src/glyphs/CopyChip';
import { dateLabel, dayLabel } from '../src/theme';
import { copyViolations } from '../test-support/copyGuard';
import {
  activityOf,
  everyActivity,
  guardData,
  requestOf,
  snapshotOf,
} from '../test-support/fixtures';
import { amountValue, enterAmount } from '../test-support/keypad';
import {
  a11yText,
  allText,
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

  test('a pane out of use is drawn but not perceived, and allText reads it anyway', async () => {
    const tree = await render(
      <View>
        <Text>Shown</Text>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text>Behind</Text>
          <View accessibilityLabel="Hidden control" />
        </View>
        <View importantForAccessibility="no-hide-descendants">
          <View accessibilityLabel="Hidden on Android" />
        </View>
        <View accessibilityLabel="Spoken" />
      </View>,
    );
    expect(visibleText(tree)).toEqual(['Shown', 'Behind']);
    expect(a11yText(tree)).toEqual(['Spoken']);
    expect(meaning(tree)).toBe('Shown | Spoken');
    expect(allText(tree)).toBe(
      'Shown | Behind | Hidden control | Hidden on Android | Spoken',
    );
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

  test('alerts skip a pane out of use and the hidden parts of an alert', async () => {
    const tree = await render(
      <View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View accessibilityRole="alert" accessibilityLabel="Behind" />
        </View>
        <View importantForAccessibility="no-hide-descendants">
          <View accessibilityRole="alert">
            <Text>Hidden on Android</Text>
          </View>
        </View>
        <View accessibilityRole="alert">
          <Text>Payment failed.</Text>
          <View accessibilityElementsHidden>
            <Text>Decoration</Text>
          </View>
        </View>
      </View>,
    );
    expect(alerts(tree)).toEqual(['Payment failed.']);
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
        <View accessibilityLabel={copy.keypad.label}>
          {copy.keypad.digits.map(key => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key}
              onPress={() => setDigits(value => value + key)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.keypad.backspace}
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

describe('fixtures', () => {
  test('every kind of payment comes in every status, each with its own id', () => {
    const all = Object.values(everyActivity());
    for (const kind of ['sent', 'received', 'request', 'transfer']) {
      for (const status of [
        'completed',
        'pending',
        'uncertain',
        'failed',
        'expired',
      ]) {
        expect(
          all.some(item => item.kind === kind && item.status === status),
        ).toBe(true);
      }
    }
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
    for (const phase of ['partial', 'pending', 'completed']) {
      expect(all.some(item => item.receiveStatus?.phase === phase)).toBe(true);
    }
  });

  test('a rail gives the id and references the engine would', () => {
    expect(activityOf('sent', 'completed').id).toMatch(/^payment:/);
    const chain = activityOf('received', 'completed', { rail: 'chain' });
    expect(chain.id).toBe(`transaction:${chain.txid}`);
    expect(chain.address).toMatch(/^bcrt1q/);
    expect(activityOf('sent', 'completed', { rail: 'fund' }).title).toBe(
      'Direct funding sent',
    );
    expect(requestOf({ amountSats: null }).uri).not.toContain('amount=');
  });

  test('a snapshot merges what it is given over the fixture wallet', () => {
    const snapshot = snapshotOf({
      balance: { pendingSats: 0 },
      primary: { connected: false },
      lfbw: {
        lastChannelize: { action: 'wait', at: 0, reason: 'below-floor' },
      },
    });
    expect(snapshot.balance).toMatchObject({
      totalSats: 261_500,
      pendingSats: 0,
    });
    expect(snapshot.primary.connected).toBe(false);
    expect(snapshot.wallet.lfbw).toMatchObject({
      setup: 'ready',
      lastChannelize: { action: 'wait' },
    });
  });

  test('guardData passes what the app draws from the fixtures, and nothing more', async () => {
    const item = activityOf('received', 'completed', {
      rail: 'chain',
      description: 'Lunch with Sam',
    });
    const snapshot = snapshotOf({ activity: [item] });
    const tree = await render(
      <View>
        <Text>{snapshot.wallet.name}</Text>
        <Text>{item.description}</Text>
        <Text>{dateLabel(item.timestamp)}</Text>
        <Text>{dayLabel(item.timestamp)}</Text>
        <Text>{chipText(item.txid!)}</Text>
        <Text>{item.title}</Text>
      </View>,
    );
    expect(
      copyViolations(tree, { data: guardData(snapshot) }).map(
        found => found.text,
      ),
    ).toEqual([item.title]);
    await act(async () => tree.unmount());
  });
});
