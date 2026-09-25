import React from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, Text } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import type { WalletAdapter } from '../../../services/wallet';
import type { CanvasSession, CanvasView } from '../../../stage/Canvas';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import { snapshotOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { RecoveryWords } from '../RecoveryWords';
import { SettingsLayer } from '../SettingsLayer';
import { NetworkChoice, Section } from '../ui';

/**
 * Settings on the phone (the P7 device pass): it has no ceiling on text size
 * (REDESIGN.md 3.3), so its bar, headings and pills must reflow rather than
 * clip; and its cards hold what rises into them.
 *
 * Jest lays nothing out, so the layout is held here as the styles that make
 * it, and the reasons are in the components.
 */

const PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
}

const session = {
  error: '',
  switchError: '',
  refreshing: false,
  connecting: false,
  refresh: jest.fn(),
  manualRefresh: jest.fn(),
  disconnect: jest.fn(),
  chooseWallet: jest.fn(),
  switchNetwork: jest.fn().mockResolvedValue(undefined),
  eraseDevice: jest.fn().mockResolvedValue(undefined),
} as unknown as CanvasSession;

const view = {
  hidden: false,
  setHidden: jest.fn(),
  unit: 'sats',
  setUnit: jest.fn(),
} as unknown as CanvasView;

function OnStage({ children }: PropsWithChildren) {
  const stage = useStageStore();
  return <StageProvider value={stage}>{children}</StageProvider>;
}

function settings(snapshot: WalletSnapshot) {
  return mount(
    <OnStage>
      <SettingsLayer
        snapshot={snapshot}
        client={client()}
        session={session}
        view={view}
        stale={false}
        backup={null}
        arrived={0}
      />
    </OnStage>,
  );
}

const regtest = snapshotOf();

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

/** The host view drawn for the control labelled `label`. */
const host = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

/** The row the three network pills sit in. */
const pills = (tree: ReactTestRenderer) => {
  const names = ['mainnet', 'testnet', 'regtest'];
  const rows = tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      !names.includes(node.props.accessibilityLabel) &&
      node.findAll(
        inner =>
          typeof inner.type === 'string' &&
          names.includes(inner.props.accessibilityLabel),
      ).length === 3,
  );
  // The deepest of the views that hold all three.
  return rows[rows.length - 1];
};

const unmount = (tree: ReactTestRenderer) => act(async () => tree.unmount());

describe('at the largest text size', () => {
  test('the bar grows, and its title gives way before the close does', async () => {
    const tree = await settings(regtest);
    const title = tree.root.find(
      node => node.type === Text && node.props.children === copy.settings.title,
    );
    const bar = title.parent!;
    expect(flat(bar).height).toBeUndefined();
    expect(flat(bar).minHeight).toBe(56);
    // One word: it shrinks to fit beside the close rather than breaking.
    expect(flat(title).flexShrink).toBe(1);
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.adjustsFontSizeToFit).toBe(true);
    expect(
      bar.findAll(node => node.props.accessibilityLabel === copy.home.close)
        .length,
    ).toBeGreaterThan(0);
    await unmount(tree);
  });

  test('a heading keeps its width and its accessory drops below it', async () => {
    const tree = await settings(regtest);
    const heading = tree.root.find(
      node =>
        node.type === Text &&
        node.props.accessibilityRole === 'header' &&
        node.props.children === copy.settings.primary.heading,
    );
    // Not `flex: 1`, which starts the heading at no width and gives the
    // accessory whatever it asks for.
    expect(flat(heading)).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 'auto',
    });
    expect(flat(heading.parent!)).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
    const words = heading.parent!.findAll(
      node =>
        node.type === Text &&
        node.props.children === copy.settings.primary.connected,
    );
    expect(words).toHaveLength(1);
    await unmount(tree);
  });

  test('the network pills break onto more lines, not their words', async () => {
    const tree = await mount(
      <NetworkChoice
        options={['mainnet', 'testnet', 'regtest'] as const}
        value="regtest"
        onChange={jest.fn()}
      />,
    );
    const chip = host(tree, 'mainnet');
    expect(flat(pills(tree))).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
    expect(flat(chip)).toMatchObject({
      flexGrow: 1,
      flexBasis: 'auto',
      minWidth: '30%',
    });
    expect(flat(chip).flex).toBeUndefined();
    expect(flat(chip).minHeight).toBeGreaterThanOrEqual(48);
    await unmount(tree);
  });
});

describe('the recovery words', () => {
  test('pair up while they fit, and take a line each once they do not', async () => {
    const tree = await mount(<RecoveryWords words={PHRASE.split(' ')} />);
    const [cell] = tree.root.findAll(
      node => typeof node.type !== 'string' && !!node.props.entering,
    );
    expect(flat(cell)).toMatchObject({
      flexGrow: 1,
      flexBasis: 'auto',
      minWidth: '48.5%',
    });
    expect(flat(cell).width).toBeUndefined();
    await unmount(tree);
  });
});

describe('a section', () => {
  test('clips what it holds while it grows to it', async () => {
    // The first recovery word rises the frame it arrives, laid out where the
    // card will end, before the card's linear transition has grown to it.
    const tree = await mount(
      <Section glyph="key" title="Recovery phrase">
        <Text>word</Text>
      </Section>,
    );
    const [card] = tree.root.findAll(
      node => typeof node.type !== 'string' && !!node.props.layout,
    );
    expect(flat(card).overflow).toBe('hidden');
    await unmount(tree);
  });
});
