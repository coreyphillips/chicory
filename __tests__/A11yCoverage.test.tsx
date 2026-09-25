import React from 'react';
import {
  Pressable,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Button, Chip, IconButton } from '../src/components/ui';
import { AmountField } from '../src/components/AmountField';
import { a11yProblems } from '../test-support/a11y';

/**
 * A state whose every control must be named for a screen reader. Each track
 * adds the states it redraws, so the list only grows.
 */
export interface CoveredState {
  name: string;
  /** Renders the state and lets it settle; the test unmounts it. */
  render: () => Promise<ReactTestRenderer>;
}

export const COVERED_STATES: CoveredState[] = [];

const noop = () => {};

async function problems(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  const found = a11yProblems(tree);
  await act(async () => tree.unmount());
  return found;
}

describe('negative controls', () => {
  test('a pressable with no label is reported', async () => {
    const found = await problems(
      <Pressable accessibilityRole="button" onPress={noop} />,
    );
    expect(found).toEqual([
      expect.objectContaining({
        handlers: ['onPress'],
        missing: 'accessibilityLabel',
      }),
    ]);
  });

  test('an empty or blank label counts as none', async () => {
    const found = await problems(
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel=""
          onPress={noop}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="  "
          onLongPress={noop}
        />
      </View>,
    );
    expect(found.map(item => item.missing)).toEqual([
      'accessibilityLabel',
      'accessibilityLabel',
    ]);
  });

  test('a labelled control with no role is reported', async () => {
    const found = await problems(
      <TouchableOpacity accessibilityLabel="Close" onPress={noop} />,
    );
    expect(found.map(item => item.missing)).toEqual(['accessibilityRole']);
  });

  test('a long press alone still needs a label and a role', async () => {
    const found = await problems(<Pressable onLongPress={noop} />);
    expect(found.map(item => item.missing)).toEqual([
      'accessibilityLabel',
      'accessibilityRole',
    ]);
  });

  test('a text field needs a label but not a role', async () => {
    const found = await problems(
      <View>
        <TextInput onChangeText={noop} />
        <TextInput accessibilityLabel="Note" onChangeText={noop} />
      </View>,
    );
    expect(found).toEqual([
      expect.objectContaining({
        handlers: ['onChangeText'],
        missing: 'accessibilityLabel',
      }),
    ]);
  });

  test('a switch takes its role from the platform but not its label', async () => {
    expect(
      await problems(
        <Switch accessibilityLabel="Haptics" value onValueChange={noop} />,
      ),
    ).toEqual([]);
    expect(
      (await problems(<Switch value onValueChange={noop} />)).map(
        item => item.missing,
      ),
    ).toEqual(['accessibilityLabel']);
  });

  test('a problem names the components above the control', async () => {
    function Toolbar() {
      return <Pressable accessibilityRole="button" onPress={noop} />;
    }
    const [found] = await problems(<Toolbar />);
    expect(found.path).toContain('Toolbar');
  });

  test('named controls pass, through any wrappers', async () => {
    const found = await problems(
      <View>
        <Button label="Review payment" onPress={noop} />
        <Chip label="10,000" selected={false} onPress={noop} />
        <IconButton accessibilityLabel="Close" name="close" onPress={noop} />
        <AmountField value="4200" onChangeText={noop} presets={[1000]} />
        <Text
          accessibilityRole="link"
          accessibilityLabel="Terms"
          onPress={noop}
        >
          Terms
        </Text>
      </View>,
    );
    expect(found).toEqual([]);
  });

  test('a control whose pane is inactive has no handler to check', async () => {
    const found = await problems(<Pressable accessibilityRole="button" />);
    expect(found).toEqual([]);
  });
});

describe('covered states', () => {
  test('each is listed once', () => {
    const names = COVERED_STATES.map(state => state.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const state of COVERED_STATES) {
    test(`${state.name} names every control`, async () => {
      const tree = await state.render();
      const found = a11yProblems(tree);
      await act(async () => tree.unmount());
      expect(found).toEqual([]);
    });
  }
});
