import React from 'react';
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Stop } from 'react-native-svg';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { palette } from '../../../design/palette';
import type { WalletAdapter } from '../../../services/wallet';
import type { CanvasSession, CanvasView } from '../../../stage/Canvas';
import {
  CORNER_REACH,
  CORNER_TARGET,
} from '../../../stage/panes/CornerControl';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import { space } from '../../../theme';
import { snapshotOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { press } from '../../../../test-support/query';
import { RecoveryWords } from '../RecoveryWords';
import { SettingsLayer, TITLE_FADE } from '../SettingsLayer';
import { NetworkChoice, Section } from '../ui';

/**
 * Settings on the phone (the P7 and P10 device passes): it has no ceiling on
 * text size (REDESIGN.md 3.3), so its bar, headings and pills must reflow
 * rather than clip; its cards hold what rises into them, fade under the
 * title and run under the home indicator; and the network a wallet is on is
 * a checked radio, never a heading.
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

/** An iPhone's insets: the status bar above, the home indicator below. */
const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };

function settings(snapshot: WalletSnapshot) {
  return mount(
    <SafeAreaInsetsContext.Provider value={INSETS}>
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
      </OnStage>
    </SafeAreaInsetsContext.Provider>,
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

/** The radio group the network pills sit in. */
const group = (tree: ReactTestRenderer) =>
  tree.root.find(
    node => node.type === View && node.props.accessibilityRole === 'radiogroup',
  );

const unmount = (tree: ReactTestRenderer) => act(async () => tree.unmount());

describe('the network a wallet is on', () => {
  test('is a checked radio in a radio group, never a heading or a bare button', async () => {
    const tree = await settings(regtest);
    const chips = ['mainnet', 'testnet', 'regtest'].map(label =>
      host(tree, label),
    );
    for (const chip of chips) {
      expect(chip.props.accessibilityRole).toBe('radio');
    }
    expect(chips.map(chip => chip.props.accessibilityState.checked)).toEqual([
      false,
      false,
      true,
    ]);
    expect(
      group(tree).findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityRole === 'radio',
      ),
    ).toHaveLength(3);
    await unmount(tree);
  });

  test('checks another once it is chosen', async () => {
    const tree = await settings(regtest);
    await press(tree, 'mainnet');
    expect(host(tree, 'mainnet').props.accessibilityState.checked).toBe(true);
    expect(host(tree, 'regtest').props.accessibilityState.checked).toBe(false);
    await unmount(tree);
  });
});

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

  test("the close's 48pt target reaches past the page edge, its glyph where the canvas's cog is", async () => {
    const tree = await settings(regtest);
    const title = tree.root.find(
      node => node.type === Text && node.props.children === copy.settings.title,
    );
    const bar = flat(title.parent!);
    // The canvas hangs its corner control CORNER_REACH nearer the edge.
    expect(bar.paddingRight).toBe(space.xl - CORNER_REACH);
    expect(bar.paddingLeft).toBe(space.xl);
    const close = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.home.close,
    );
    expect(flat(close).width).toBe(CORNER_TARGET);
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

describe('the page edges', () => {
  test('the page runs under the home indicator, the inset added to the end of what scrolls', async () => {
    const tree = await settings(regtest);
    const root = tree.root.find(node => node.props.testID === 'scene-settings');
    // P10: the layer took the inset as padding, so the page stopped 34pt
    // above the screen's edge on a hard line.
    expect(flat(root).paddingBottom).toBeUndefined();
    expect(flat(root).marginTop).toBe(INSETS.top);
    const scroll = tree.root.findByType(ScrollView);
    expect(
      scroll.findAll(
        node =>
          node.type === View && flat(node).paddingBottom === INSETS.bottom,
      ).length,
    ).toBeGreaterThan(0);
    await unmount(tree);
  });

  test('cards scrolled up under the title fade into roast rather than end on a hard line', async () => {
    const tree = await settings(regtest);
    const fade = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.testID === 'settings-title-fade',
    );
    expect(fade.props.pointerEvents).toBe('none');
    expect(fade.props.accessibilityElementsHidden).toBe(true);
    // It hangs from the bar's foot, at whatever height the text size gives
    // the bar, and the bar is raised over the page so the fade draws over
    // the cards scrolled up under it.
    expect(flat(fade)).toMatchObject({
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      height: TITLE_FADE,
    });
    const title = tree.root.find(
      node => node.type === Text && node.props.children === copy.settings.title,
    );
    const bar = title.parent!;
    // Compared as booleans: a failed comparison of two tree nodes prints
    // the whole tree.
    expect(bar.findAll(node => node === fade).length).toBe(1);
    expect(flat(bar).zIndex).toBeGreaterThan(0);
    // The page stays the surface's own child, beside the bar: the slot's
    // keyboard offset is measured from the top of Settings.
    const root = tree.root.find(node => node.props.testID === 'scene-settings');
    const page = root.children.find(
      child =>
        typeof child !== 'string' && child.findAllByType(ScrollView).length > 0,
    ) as ReactTestInstance;
    expect(root.children.includes(page)).toBe(true);
    expect(bar.findAllByType(ScrollView)).toHaveLength(0);
    const stops = fade.findAllByType(Stop).map(stop => stop.props);
    expect(stops[0]).toMatchObject({
      stopColor: palette.roast,
      stopOpacity: 1,
    });
    expect(stops.at(-1)).toMatchObject({
      stopColor: palette.roast,
      stopOpacity: 0,
    });
    await unmount(tree);
  });
});
