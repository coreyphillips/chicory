import React from 'react';
import {
  Pressable,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { act } from 'react-test-renderer';
import { Button, Chip, IconButton } from '../src/components/ui';
import { AmountField } from '../src/components/AmountField';
import { a11yProblems } from '../test-support/a11y';
import { mount } from '../test-support/guard';

/**
 * The accessibility check's harness: negative controls proving it catches a
 * control a screen reader cannot name and passes one it can. Each track holds
 * the states it redraws to it in its own file under __tests__/guards.
 */
const noop = () => {};

async function problems(element: React.ReactElement) {
  const tree = await mount(element);
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
