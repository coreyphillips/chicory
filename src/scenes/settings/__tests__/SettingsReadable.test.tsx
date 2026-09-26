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
import {
  copyFit,
  monoAdvance,
  nodeAddressText,
  unbroken,
  widestPiece,
} from '../ui';
import type { LaidLine } from '../ui';

/**
 * Settings read on the phone (the P10 device pass): setup in words rather
 * than the engine's value, and a node address that breaks only where it may
 * and is in the one face, typed or saved.
 */

const words = copy.settings;

/** A zero-width space, where a line may break without drawing anything. */
const BREAK = '\u200B';
/** A word joiner, where a line may not break, drawing nothing. */
const JOIN = '\u2060';

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

  test('keeps a hyphenated host whole, as one piece', () => {
    // A line may break after a hyphen, so "…@my-" over "node.example".
    expect(nodeAddressText(`${KEY}@my-node.example:9735`)).toBe(
      `${nodeAddressText(KEY)}@${BREAK}my-${JOIN}node.example${BREAK}:9735`,
    );
    expect(widestPiece(nodeAddressText(`${KEY}@my-node.example:9735`))).toBe(
      'my-node.example'.length,
    );
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

describe('a token', () => {
  test('is one piece a line never breaks inside', () => {
    // P12: "Engine 0.22.0-" over "portable".
    expect(unbroken('0.22.0-portable')).toBe(`0.22.0-${JOIN}portable`);
    expect(unbroken('a/b|c!d?e')).toBe(`a/${JOIN}b|${JOIN}c!${JOIN}d?${JOIN}e`);
    // Letters, digits and stops offer no break, and nothing trails.
    expect(unbroken('127.0.0.1')).toBe('127.0.0.1');
    expect(unbroken('0.5.0-')).toBe('0.5.0-');
  });
});

/** Menlo's advance at the largest text size: 0.602 of 12pt, times 3.571. */
const XXXL = 0.602 * 12 * 3.571;

/** A line as the phone lays it out in mono at `advance` a character. */
const laid = (text: string, advance = XXXL): LaidLine => ({
  text,
  width: [...text.replace(/[\u200B\u2060]/g, '').trimEnd()].length * advance,
});

describe('the copy control beside a node address', () => {
  // The P12 device pass: a 314pt card, and a 96pt control at the largest
  // text size, which left the address 206pt.
  const fit = (widest: number) => copyFit({ room: 314, control: 96, widest });

  test('drops below the address once its widest piece no longer fits beside it', () => {
    // "127.0.0.1" is about 232pt: beside the control it broke as "127.0.0"
    // over ".1".
    expect(fit(9 * XXXL)).toEqual({ below: true, shrink: 1 });
    // A size smaller, it fits beside the control.
    expect(fit(9 * 0.602 * 12 * 3.143)).toEqual({ below: false, shrink: 1 });
    expect(fit(9 * 0.602 * 12)).toEqual({ below: false, shrink: 1 });
  });

  test('shrinks the address only for a piece wider than the whole card, to half at the least', () => {
    const host = fit(18 * XXXL);
    expect(host.below).toBe(true);
    expect(host.shrink).toBeLessThan(1);
    expect(18 * XXXL * host.shrink).toBeLessThanOrEqual(314);
    expect(fit(80 * XXXL).shrink).toBe(0.5);
  });

  test('stays beside it until something is measured', () => {
    expect(copyFit({ room: 0, control: 96, widest: 500 })).toEqual({
      below: false,
      shrink: 1,
    });
  });

  test("reads a character's advance off the lines the address was laid out in", () => {
    const lines = [
      laid('0249 '),
      laid(`98@${BREAK}`),
      laid('127.0.0'),
      laid(`.1${BREAK}`),
      laid(':19950'),
    ];
    expect(monoAdvance(lines)).toBeCloseTo(XXXL);
    // A line ending on a space says nothing: its width may count the space.
    expect(monoAdvance([{ text: '0249 2a7b ', width: 10 * XXXL }])).toBe(0);
    expect(widestPiece(nodeAddressText(URI))).toBe('127.0.0.1'.length);
  });

  async function drawn(uri: string) {
    const tree = await render(snapshotOf({ primary: { uri } }));
    const value = () =>
      tree.root.find(
        node =>
          node.type === Text && node.props.children === nodeAddressText(uri),
      );
    // The nearest view above the address that measures the room it shares
    // with its control.
    const line = () => {
      let at = value().parent;
      while (at && typeof at.props.onLayout !== 'function') at = at.parent;
      return at!;
    };
    return { value, line };
  }

  async function measured(uri: string, lines: LaidLine[]) {
    const { value, line } = await drawn(uri);
    await act(async () => {
      line().props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 314, height: 400 } },
      });
      value().props.onTextLayout({ nativeEvent: { lines } });
    });
    return { value, line };
  }

  test('starts where a guess from the window puts it, before anything is measured', async () => {
    // Jest's 750pt window at a font scale of 2: "127.0.0.1" is about 130pt,
    // well inside what the control leaves.
    const { line } = await drawn(URI);
    expect(StyleSheet.flatten(line().props.style).flexDirection).toBe('row');
  });

  test('gives the address the whole width at the largest text size, the control below it', async () => {
    const { value, line } = await measured(URI, [
      laid('0249 '),
      laid(`98@${BREAK}`),
      laid('127.0.0'),
      laid(`.1${BREAK}`),
      laid(':19950'),
    ]);
    expect(StyleSheet.flatten(line().props.style)).toMatchObject({
      flexDirection: 'column',
      alignItems: 'flex-start',
    });
    expect(
      line().findAll(
        node =>
          typeof node.type === 'string' &&
          StyleSheet.flatten(node.props.style)?.alignSelf === 'stretch' &&
          node.findAll(inner => inner.props.onTextLayout).length > 0,
      ).length,
    ).toBeGreaterThan(0);
    // The control is still there, under the address.
    expect(
      line().findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === words.primary.copy,
      ).length,
    ).toBeGreaterThan(0);
    // An IP fits the whole width, so it keeps its size.
    expect(StyleSheet.flatten(value().props.style).fontSize).toBe(12);
  });

  test('shrinks for a host wider than the card, and holds that size once laid out at it', async () => {
    const uri = `${KEY}@node-1.example.com:9735`;
    const { value } = await measured(uri, [
      laid('0249 2a7b '),
      laid(`98@${BREAK}`),
      laid(`node-${JOIN}1.exampl`),
      laid(`e.com${BREAK}`),
      laid(':9735'),
    ]);
    const size = () => StyleSheet.flatten(value().props.style).fontSize;
    const shrunk = size();
    expect(shrunk).toBeLessThan(12);
    expect(shrunk).toBeGreaterThanOrEqual(6);
    // Laid out again at the size it shrank to, it keeps it.
    const scale = shrunk / 12;
    await act(async () => {
      value().props.onTextLayout({
        nativeEvent: {
          lines: [
            laid(`98@${BREAK}`, XXXL * scale),
            laid(`node-${JOIN}1.example.com${BREAK}`, XXXL * scale),
            laid(':9735', XXXL * scale),
          ],
        },
      });
    });
    expect(size()).toBe(shrunk);
  });
});
