import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { act } from 'react-test-renderer';
import { SETTINGS_MARKER, copyViolations } from '../test-support/copyGuard';
import { mount } from '../test-support/guard';

/**
 * The copy guard's harness: negative controls proving it catches prose and
 * lets data through. Each track holds the states it redraws to it in its own
 * file under __tests__/guards.
 */
function FakeScene({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

async function violations(element: React.ReactElement, data: string[] = []) {
  const tree = await mount(element);
  const found = copyViolations(tree, { data });
  await act(async () => tree.unmount());
  return found;
}

describe('negative controls', () => {
  test('prose on a scene fails, and names where it was drawn', async () => {
    const found = await violations(
      <FakeScene>
        <Text>Hello world</Text>
      </FakeScene>,
    );
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('Hello world');
    expect(found[0].path).toContain('FakeScene');
  });

  test('the same prose under the settings marker passes', async () => {
    const found = await violations(
      <FakeScene>
        <View testID={SETTINGS_MARKER}>
          <Text>Hello world</Text>
        </View>
      </FakeScene>,
    );
    expect(found).toEqual([]);
  });

  test('only the marked subtree is skipped', async () => {
    const found = await violations(
      <FakeScene>
        <View testID={SETTINGS_MARKER}>
          <Text>Network</Text>
        </View>
        <Text>Loading...</Text>
      </FakeScene>,
    );
    expect(found.map(item => item.text)).toEqual(['Loading...']);
  });

  test('an amount with its unit passes', async () => {
    const found = await violations(
      <FakeScene>
        <Text>12,345 sats</Text>
        <Text>
          {'4,200'} {'sats'}
        </Text>
      </FakeScene>,
    );
    expect(found).toEqual([]);
  });

  test('a placeholder with words fails', async () => {
    const found = await violations(
      <FakeScene>
        <TextInput placeholder="Paste a payment request" />
      </FakeScene>,
    );
    expect(found.map(item => item.text)).toEqual(['Paste a payment request']);
  });

  test('a second settings marker throws rather than hiding a scene', async () => {
    const tree = await mount(
      <FakeScene>
        <View testID={SETTINGS_MARKER} />
        <View testID={SETTINGS_MARKER} />
      </FakeScene>,
    );
    expect(() => copyViolations(tree, { data: [] })).toThrow(
      /2 "scene-settings" markers/,
    );
    await act(async () => tree.unmount());
  });

  test('data passes only as a whole string', async () => {
    const found = await violations(
      <FakeScene>
        <Text>Everyday</Text>
        <Text>Everyday wallet</Text>
      </FakeScene>,
      ['Everyday'],
    );
    expect(found.map(item => item.text)).toEqual(['Everyday wallet']);
  });
});

describe('shapes that are data', () => {
  test.each([
    '12,345 sats',
    '1 sat',
    '+4,200',
    '−1,000 sats',
    '- 500',
    '0.00012345 BTC',
    '0.5₿',
    'sats',
    'BTC',
    '₿',
    '••••••',
    '4:59',
    '12:00',
    '·',
    ' + ',
    '≈',
    '≤',
    '∞',
  ])('%p passes', async text => {
    expect(await violations(<Text>{text}</Text>)).toEqual([]);
  });

  test.each([
    'Sent',
    'Loading...',
    '4,200 sats pending',
    '0.123456789 BTC',
    '100:00',
    '1.',
    'OK',
  ])('%p fails', async text => {
    const found = await violations(<Text>{text}</Text>);
    expect(found.map(item => item.text)).toEqual([text]);
  });
});
