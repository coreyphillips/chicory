import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { act } from 'react-test-renderer';
import { SETTINGS_MARKER, copyViolations } from '../test-support/copyGuard';
import { SetupPanel } from '../src/scenes/phases/parts';
import { SETTINGS_SURFACE, SettingsSurface } from '../src/scenes/settings/ui';
import { mount } from '../test-support/guard';
import { ROOT } from '../test-support/node';

/**
 * The copy guard's harness: negative controls proving it catches prose and
 * lets data through, and that the lint catches prose in the source before it
 * is ever drawn. Each track holds the states it redraws to the guard in its
 * own file under __tests__/guards.
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

  test('a field prefilled with words fails, and one prefilled with data passes', async () => {
    const found = await violations(
      <FakeScene>
        <TextInput defaultValue="Paste here" />
        <TextInput defaultValue="4,200" />
        <TextInput defaultValue="Everyday" />
      </FakeScene>,
      ['Everyday'],
    );
    expect(found.map(item => item.text)).toEqual(['Paste here']);
  });

  test('each settings-class root carries the one marker the guard reads', async () => {
    expect(SETTINGS_SURFACE).toBe(SETTINGS_MARKER);
    for (const element of [
      <SettingsSurface>
        <Text>Recovery phrase</Text>
      </SettingsSurface>,
      <SetupPanel>
        <Text>Network</Text>
      </SetupPanel>,
    ]) {
      const tree = await mount(element);
      const markers = tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === SETTINGS_MARKER,
      );
      expect(markers).toHaveLength(1);
      expect(copyViolations(tree, { data: [] })).toEqual([]);
      await act(async () => tree.unmount());
    }
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

// The app's TypeScript config leaves Node's types out (test-support/node),
// so the linter comes in through a handle typed for what is asked of it.
declare const require: (id: string) => unknown;
interface LintMessage {
  ruleId: string | null;
  line: number;
  column: number;
}
const { ESLint } = require('eslint') as {
  ESLint: new (options: { cwd: string }) => {
    lintText(
      code: string,
      options: { filePath: string },
    ): Promise<{ messages: LintMessage[] }[]>;
  };
};

/**
 * The lint that stops prose before it is drawn (REDESIGN.md rule 1), run
 * with the repo's own config over probes that stand where canvas code lives.
 */
describe('the visible copy lint', () => {
  const eslint = new ESLint({ cwd: ROOT });
  const RULE = 'no-restricted-syntax';

  /** What the rule flags in `body`, drawn by a component at `file`. */
  const flagged = async (file: string, body: string) => {
    const source = [
      "import React from 'react';",
      "import { Text, TextInput, View } from 'react-native';",
      'declare const busy: boolean;',
      'declare const n: number;',
      'declare const name: string;',
      'declare const format: (text: string) => string;',
      `export const Probe = () => <View>${body}</View>;`,
      '',
    ].join('\n');
    const [result] = await eslint.lintText(source, { filePath: file });
    return result.messages.filter(message => message.ruleId === RULE);
  };

  const PROSE = [
    '<Text>Loading your wallet</Text>',
    "<>{'In a fragment'}</>",
    "<Text>{busy && 'Please wait'}</Text>",
    "<Text>{busy ? 'Sending' : null}</Text>",
    "<Text>{busy ? null : n > 1 ? 'Nested' : null}</Text>",
    "<Text>{['In an array', n]}</Text>",
    '<Text>{`${n} payments`}</Text>',
    '<Text>{busy ? `Sending ${n}` : null}</Text>',
    '<TextInput defaultValue="Paste here" />',
    '<TextInput placeholder={name} />',
    '<View title="Payments" />',
    "<View title={busy ? 'Payments' : ''} />",
  ];

  const CANVAS = [
    'src/screens/Probe.tsx',
    'src/screens/wallet/Probe.tsx',
    'src/components/Probe.tsx',
    'src/scenes/home/Probe.tsx',
    'src/stage/Probe.tsx',
  ];

  test.each(CANVAS)(
    'flags prose however it reaches the screen, in %s',
    async file => {
      const missed: string[] = [];
      for (const body of PROSE) {
        if (!(await flagged(file, body)).length) missed.push(body);
      }
      expect(missed).toEqual([]);
    },
  );

  test('lets data, spoken words and strings that are not drawn through', async () => {
    const body = [
      '<Text accessibilityLabel="Spoken words">{n}</Text>',
      "<Text testID={busy ? 'one-id' : 'another-id'}>{n}</Text>",
      "<Text>{name === 'Everyday' ? n : 0}</Text>",
      "<Text>{format('an argument')}</Text>",
      '<Text>{busy ? <Text testID="inner-id">{n}</Text> : null}</Text>',
      '<Text>{[<Text key="a-key">{n}</Text>]}</Text>',
      '<Text>{`${n} `}</Text>',
      '<Text>{name}</Text>',
      '<TextInput placeholder="" value={name} />',
    ].join('');
    expect(await flagged('src/screens/Probe.tsx', body)).toEqual([]);
  });

  test('leaves the settings-class surfaces their words', async () => {
    for (const file of [
      'src/screens/Settings.tsx',
      'src/screens/NetworkSettings.tsx',
      'src/screens/DeviceSetup.tsx',
      'src/components/RecoveryPhrase.tsx',
      'src/scenes/settings/Probe.tsx',
    ]) {
      expect({ file, found: await flagged(file, PROSE.join('')) }).toEqual({
        file,
        found: [],
      });
    }
  });
});
