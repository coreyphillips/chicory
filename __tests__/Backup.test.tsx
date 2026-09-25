import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import { CreateWalletScreen } from '../src/screens/Settings';
import {
  countWords,
  holdSteps,
  petalAngle,
  petalPose,
  phraseBloom,
  wordDelay,
} from '../src/scenes/settings/motion';
import { PhraseBloom } from '../src/scenes/settings/PhraseBloom';
import type { NetworkProfile } from '../src/services/networks';
import type { WalletAdapter } from '../src/services/wallet';
import { activate } from '../test-support/query';
function field(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onChangeText === 'function')!;
}
function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function')!;
}
/**
 * Confirms the phrase is saved the way a screen reader does, with the hold
 * control's one activate action; a finger would hold it for 900ms.
 */
const confirmSaved = (tree: ReactTestRenderer) =>
  activate(tree, 'I saved my recovery phrase');
test('new wallet requires deliberate recovery reveal and backup acknowledgement before entry', async () => {
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const onBusy = jest.fn();
  const phrase =
    'sample fixture words only never use this phrase for a real wallet';
  const createWallet = jest.fn().mockResolvedValue({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'running',
    mnemonic: phrase,
  });
  const client = {
    connection: { url: 'https://wallet.example.com', token: 'test' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  expect(onCreated).not.toHaveBeenCalled();
  expect(onBusy).toHaveBeenLastCalledWith(true);
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  expect(onCreated).not.toHaveBeenCalled();
  await confirmSaved(tree);
  expect(onCreated).toHaveBeenCalledWith({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'running',
  });
  await act(async () => {
    tree.unmount();
  });
});

test('failed wallet startup keeps the created wallet backup available for retry', async () => {
  const onCreated = jest
    .fn()
    .mockRejectedValueOnce(new Error('Electrum is offline'))
    .mockResolvedValue(undefined);
  const createWallet = jest.fn().mockResolvedValue({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'stopped',
    mnemonic: 'sample words for test only',
  });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await act(async () => {
    await label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Electrum is offline');
  expect(JSON.stringify(tree.toJSON())).toContain('Save your recovery phrase.');
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await confirmSaved(tree);
  expect(onCreated).toHaveBeenCalledTimes(2);
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('a committed wallet with a metadata warning still offers its deliberate backup flow', async () => {
  const warning =
    'Your wallet is saved, but its reference for other networks could not be saved.';
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const createWallet = jest.fn().mockResolvedValue({
    id: 'committed',
    name: 'Existing creation',
    network: 'mainnet',
    status: 'stopped',
    mnemonic: 'fixture words for testing only',
    warnings: [warning],
  });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain(warning);
  expect(label(tree, 'Reveal recovery phrase')).toBeDefined();
  expect(onCreated).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await confirmSaved(tree);
  expect(onCreated).toHaveBeenCalledWith({
    id: 'committed',
    name: 'Existing creation',
    network: 'mainnet',
    status: 'stopped',
  });
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('restoring from a phrase sends it once and opens the wallet without a reveal step', async () => {
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const phrase =
    'sample fixture words only never use this phrase for a real wallet';
  const createWallet = jest.fn().mockResolvedValue({
    id: 'restored',
    name: 'Everyday wallet',
    network: 'regtest',
    status: 'running',
    mnemonic: phrase,
  });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        profile={{
          network: 'regtest',
          primaryUri: 'node@host:9735',
          electrum: { host: 'localhost', port: 60001, tls: false },
          transport: 'native',
          relayUrl: '',
          relayToken: '',
        }}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    label(tree, 'I already have a recovery phrase').props.onPress();
  });
  // Eleven words is not a phrase; the button waits.
  await act(async () => {
    field(tree, 'Recovery phrase').props.onChangeText(
      phrase.split(' ').slice(0, 11).join(' '),
    );
  });
  expect(label(tree, 'Restore regtest wallet').props.disabled).toBe(true);
  await act(async () => {
    field(tree, 'Recovery phrase').props.onChangeText(`  ${phrase}  `);
  });
  await act(async () => {
    await label(tree, 'Restore regtest wallet').props.onPress();
  });
  expect(createWallet).toHaveBeenCalledWith(
    expect.objectContaining({ network: 'regtest', mnemonic: `  ${phrase}  ` }),
  );
  // The owner already holds the phrase: straight in, and it is not shown back.
  expect(onCreated).toHaveBeenCalledWith({
    id: 'restored',
    name: 'Everyday wallet',
    network: 'regtest',
    status: 'running',
  });
  expect(JSON.stringify(tree.toJSON())).not.toContain('Reveal recovery phrase');
  await act(async () => {
    tree.unmount();
  });
});

const REGTEST: NetworkProfile = {
  network: 'regtest',
  primaryUri: 'node@host:9735',
  electrum: { host: 'localhost', port: 60001, tls: false },
  transport: 'native',
  relayUrl: '',
  relayToken: '',
};

/** A phrase of `count` words, each different. */
const phraseOf = (count: number) =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(' ');

describe('the restore bloom', () => {
  test.each([
    [0, { inner: 0, outer: 0, ready: false, over: false }],
    [1, { inner: 1, outer: 0, ready: false, over: false }],
    [11, { inner: 11, outer: 0, ready: false, over: false }],
    [12, { inner: 12, outer: 0, ready: true, over: false }],
    [13, { inner: 12, outer: 1, ready: false, over: false }],
    [23, { inner: 12, outer: 11, ready: false, over: false }],
    [24, { inner: 12, outer: 12, ready: true, over: false }],
    [25, { inner: 12, outer: 12, ready: false, over: true }],
  ])('%i words light %p', (count, expected) => {
    expect(phraseBloom(count)).toEqual(expected);
  });

  test('counts words however they are spaced', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('  a\n b\t\tc  ')).toBe(3);
  });

  test('opens each petal from a narrow, turned bud, and wilts it to .92', () => {
    expect(petalPose(0, 0)).toEqual({
      opacity: 0,
      turn: -14,
      scaleX: 0.18,
      scaleY: 0.25,
    });
    expect(petalPose(1, 0)).toEqual({
      opacity: 1,
      turn: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const wilted = petalPose(1, 1);
    expect(wilted.turn).toBe(10);
    expect(wilted.scaleY).toBeCloseTo(0.92);
  });

  test('lights clockwise from the top, the second ring between the first', () => {
    expect([0, 1, 11].map(index => petalAngle('inner', index))).toEqual([
      0, 30, 330,
    ]);
    expect([0, 1, 11].map(index => petalAngle('outer', index))).toEqual([
      15, 45, 345,
    ]);
  });

  test('restore wakes at exactly 12 or 24 words, and the bloom says how many', async () => {
    const onCreated = jest.fn().mockResolvedValue(undefined);
    const client = {
      connection: { url: 'embedded:', token: '' },
      getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
      createWallet: jest.fn(),
    } as unknown as WalletAdapter;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <CreateWalletScreen
          client={client}
          profile={REGTEST}
          initialRestoring
          onCreated={onCreated}
          onBusy={jest.fn()}
        />,
      );
    });
    const bloom = () =>
      tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === 'Recovery phrase words',
      )[0].props.accessibilityValue;
    const type = async (count: number) => {
      await act(async () => {
        field(tree, 'Recovery phrase').props.onChangeText(phraseOf(count));
      });
    };
    const restore = () => label(tree, 'Restore regtest wallet').props.disabled;
    expect(bloom()).toEqual({ min: 0, max: 24, now: 0 });
    expect(restore()).toBe(true);
    await type(5);
    expect(bloom()).toMatchObject({
      now: 5,
      text: '5 words so far. A phrase has 12 or 24.',
    });
    expect(restore()).toBe(true);
    await type(12);
    expect(bloom()).toMatchObject({ now: 12, text: '12 words.' });
    expect(restore()).toBe(false);
    await type(13);
    expect(bloom()).toMatchObject({
      now: 13,
      text: '13 words so far. A phrase has 12 or 24.',
    });
    expect(restore()).toBe(true);
    await type(24);
    expect(bloom()).toMatchObject({ now: 24, text: '24 words.' });
    expect(restore()).toBe(false);
    await type(25);
    expect(bloom()).toMatchObject({
      now: 25,
      text: '25 words so far. A phrase has 12 or 24.',
    });
    expect(restore()).toBe(true);
    // A test network's phrase is drawn in slate, as its mark is.
    expect(tree.root.findByType(PhraseBloom).props.test).toBe(true);
    await act(async () => tree.unmount());
  });

  test('a phrase the wallet refused wilts the bloom until it is changed', async () => {
    const client = {
      connection: { url: 'embedded:', token: '' },
      getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
      createWallet: jest
        .fn()
        .mockRejectedValue(new Error('That recovery phrase is not valid.')),
    } as unknown as WalletAdapter;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <CreateWalletScreen
          client={client}
          profile={REGTEST}
          initialRestoring
          onCreated={jest.fn()}
          onBusy={jest.fn()}
        />,
      );
    });
    await act(async () => {
      field(tree, 'Recovery phrase').props.onChangeText(phraseOf(12));
    });
    await act(async () => {
      await label(tree, 'Restore regtest wallet').props.onPress();
    });
    expect(JSON.stringify(tree.toJSON())).toContain(
      'That recovery phrase is not valid.',
    );
    expect(tree.root.findByType(PhraseBloom).props.wilted).toBe(true);
    await act(async () => {
      field(tree, 'Recovery phrase').props.onChangeText(phraseOf(11));
    });
    expect(tree.root.findByType(PhraseBloom).props.wilted).toBe(false);
    await act(async () => tree.unmount());
  });
});

describe('the backup hold', () => {
  test('ticks at each quarter of its 900ms and commits at the end', () => {
    expect(holdSteps(900)).toEqual([225, 450, 675, 900]);
  });

  test('the words rise 30ms apart, in reading order', () => {
    expect([0, 1, 2, 23].map(wordDelay)).toEqual([0, 30, 60, 690]);
  });
});

test('a new wallet lands a screen reader on the phrase it has to save', async () => {
  const sent = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
  sent.mockClear();
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet: jest.fn().mockResolvedValue({
      id: 'new',
      name: 'Everyday wallet',
      network: 'regtest',
      status: 'stopped',
      mnemonic: phraseOf(12),
    }),
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        profile={REGTEST}
        onCreated={jest.fn().mockResolvedValue(undefined)}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create regtest wallet').props.onPress();
  });
  // Focus moves once nothing is moving, which here is the next tick.
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  });
  // Under Jest a host ref holds the mocked component, props and all.
  const landed = sent.mock.calls
    .filter(([, kind]) => kind === 'focus')
    .map(([node]) => node as unknown as { props: { children: unknown } })
    .map(node => node.props.children);
  expect(landed).toEqual(['Save your recovery phrase.']);
  await act(async () => tree.unmount());
});

test('turning a new wallet to mainnet is felt and read out at once', async () => {
  const announced = jest.mocked(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  );
  const trigger = jest.mocked(HapticFeedback.trigger);
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet: jest.fn(),
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={jest.fn()}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => label(tree, 'regtest').props.onPress());
  announced.mockClear();
  trigger.mockClear();
  await act(async () => label(tree, 'mainnet').props.onPress());
  expect(announced).toHaveBeenCalledWith(
    'This creates a real mainnet wallet. The primary node is trusted for instant funding.',
    { queue: false },
  );
  expect(trigger).toHaveBeenCalledWith(
    'notificationWarning',
    expect.anything(),
  );
  // Choosing it again, or a test network, says nothing more.
  announced.mockClear();
  await act(async () => label(tree, 'mainnet').props.onPress());
  await act(async () => label(tree, 'testnet').props.onPress());
  expect(announced).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
