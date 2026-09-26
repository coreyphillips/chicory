import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { SettingsScreen, setupWord } from '../../../screens/Settings';
import type { WalletAdapter } from '../../../services/wallet';
import { fonts } from '../../../theme';
import { snapshotOf } from '../../../../test-support/fixtures';
import { press } from '../../../../test-support/query';
import { nodeAddressText } from '../ui';

/**
 * Settings read on the phone (the P10 device pass): setup in words rather
 * than the engine's value, and a node address that breaks only where it may
 * and is in the one face, typed or saved.
 */

const words = copy.settings;

/** A zero-width space, where a line may break without drawing anything. */
const BREAK = '\u200B';

const KEY = `02492a7b6f78c57d79f2d798162e21bc74259182c4a34181e21ab76b7ece169598`;
const URI = `${KEY}@127.0.0.1:19950`;

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn(),
    updatePrimary: jest.fn(),
    retrySetup: jest.fn(),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
}

let mounted: ReactTestRenderer | null = null;

async function render(snapshot: WalletSnapshot = snapshotOf()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SettingsScreen
        snapshot={snapshot}
        client={client()}
        switchError=""
        onDisconnect={jest.fn()}
        onChooseWallet={jest.fn()}
        onRefresh={jest.fn()}
        onNetwork={jest.fn()}
        onErase={jest.fn().mockResolvedValue(undefined)}
      />,
    );
  });
  mounted = tree;
  return tree;
}

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) await act(async () => tree.unmount());
});

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => node.type === Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'string');

describe('setup', () => {
  test("is said in words, never the engine's own value", () => {
    const of = (primary: Partial<WalletSnapshot['primary']>) =>
      setupWord({ uri: URI, connected: true, setup: '', ...primary });
    expect(of({ setup: 'ready' })).toBe(words.primary.setupReady);
    expect(of({ setup: 'pending' })).toBe(words.primary.setupPending);
    expect(of({ setup: 'failed' })).toBe(words.primary.setupFailed);
    expect(of({ setup: 'pending', setupError: 'Unavailable.' })).toBe(
      words.primary.setupFailed,
    );
    expect(of({ setup: '' })).toBe(words.primary.waiting);
  });

  test('a ready setup reads Ready, not ready', async () => {
    const tree = await render();
    // P10: "ready", lowercase, as the engine reports it.
    expect(texts(tree)).toContain(words.primary.setupReady);
    expect(texts(tree)).not.toContain('ready');
  });
});

describe('a node address', () => {
  test('breaks only between its key groups, after the @ and before the port', () => {
    const shown = nodeAddressText(URI);
    const pieces = shown.split(/[ \u200B]/);
    // The key in groups of four, the last with what is left over.
    expect(pieces.slice(0, 16).every(piece => piece.length === 4)).toBe(true);
    expect(pieces.slice(0, 17).join('')).toBe(`${KEY}@`);
    // P10: "…@127" over ".0.0.1:19846", and "1995" over "0".
    expect(pieces.slice(17)).toEqual(['127.0.0.1', ':19950']);
    expect(shown).toContain(`@${BREAK}127.0.0.1${BREAK}:19950`);
    expect(shown.replace(/[ \u200B]/g, '')).toBe(URI);
  });

  test('a key alone is grouped, and anything else is drawn as it is', () => {
    expect(nodeAddressText(KEY).replace(/ /g, '')).toBe(KEY);
    expect(nodeAddressText(KEY)).not.toContain(BREAK);
    expect(nodeAddressText(`${KEY}@node.example`)).toBe(
      `${nodeAddressText(KEY)}@${BREAK}node.example`,
    );
    expect(nodeAddressText('node@host:9735')).toBe('node@host:9735');
    expect(nodeAddressText(words.primary.none)).toBe(words.primary.none);
  });

  test('is drawn with its breaks, and copied as it is', async () => {
    const tree = await render(snapshotOf({ primary: { uri: URI } }));
    const drawn = tree.root.find(
      node =>
        node.type === Text && node.props.children === nodeAddressText(URI),
    );
    expect(StyleSheet.flatten(drawn.props.style).fontFamily).toBe(fonts.mono);
    // Its spaces and invisible breaks are never selected in the value's place.
    expect(drawn.props.selectable).toBe(false);
    jest.mocked(Clipboard.setString).mockClear();
    await press(tree, words.primary.copy);
    expect(Clipboard.setString).toHaveBeenCalledWith(URI);
  });

  test('is typed in the mono face it is shown in', async () => {
    const tree = await render(snapshotOf({ primary: { uri: URI } }));
    await press(tree, words.primary.change);
    const input = tree.root.find(
      node =>
        node.type === TextInput &&
        node.props.accessibilityLabel === words.primary.address,
    );
    // P10: the proportional face while typing, mono once saved.
    expect(StyleSheet.flatten(input.props.style).fontFamily).toBe(fonts.mono);
  });
});
