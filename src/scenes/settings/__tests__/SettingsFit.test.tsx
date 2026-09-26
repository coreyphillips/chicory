import React from 'react';
import type { PropsWithChildren } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import {
  GLYPH_SCALE_MAX,
  NetworkChoice,
  Section,
  accessoryBelow,
  glyphScale,
} from '../ui';

/**
 * Settings on the phone (the P7 and P10 device passes): it has no ceiling on
 * text size (REDESIGN.md 3.3), so its bar, headings and pills must reflow
 * rather than clip, its words never break inside a word, and its glyphs grow
 * with the text; its cards hold what rises into them, fade under the title
 * and run under the home indicator; and the network a wallet is on is a
 * checked radio, never a heading.
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

/** The glyphs drawn under `node`, by name and size when given. */
const glyphs = (node: ReactTestInstance, name?: string, size?: number) =>
  node.findAll(
    inner =>
      typeof inner.type !== 'string' &&
      typeof inner.props.name === 'string' &&
      typeof inner.props.size === 'number' &&
      typeof inner.props.color === 'string' &&
      (name === undefined || inner.props.name === name) &&
      (size === undefined || inner.props.size === size),
  );

/** Jest's window reports a font scale of 2, an accessibility size. */
const FONT_SCALE = Dimensions.get('window').fontScale;
const grown = (size: number) => Math.round(size * glyphScale(FONT_SCALE));

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
    // At least 48pt, grown with the text as its glyph is.
    expect(flat(close).width).toBe(CORNER_TARGET * glyphScale(FONT_SCALE));
    expect(flat(close).width).toBeGreaterThanOrEqual(CORNER_TARGET);
    await unmount(tree);
  });

  test('a heading starts with its accessory below it at an accessibility size', async () => {
    // Jest's window has a font scale of 2, past BELOW_FROM_SCALE: the heading
    // starts where it will settle, so the card does not change height as
    // Settings arrives.
    const tree = await settings(regtest);
    const heading = tree.root.find(
      node =>
        node.type === Text &&
        node.props.accessibilityRole === 'header' &&
        node.props.children === copy.settings.primary.heading,
    );
    expect(flat(heading.parent!).flexDirection).toBe('column');
    expect(
      heading.parent!.findAll(
        node =>
          node.type === Text &&
          node.props.children === copy.settings.primary.connected,
      ),
    ).toHaveLength(1);
    await unmount(tree);
  });

  test('a heading beside its accessory hands it the line below once the heading needs a second line', async () => {
    const tree = await mount(
      <Section
        glyph="bolt"
        title={copy.settings.primary.heading}
        accessory={<Text>{copy.settings.primary.connected}</Text>}
      >
        <Text>row</Text>
      </Section>,
    );
    const heading = () =>
      tree.root.find(
        node => node.type === Text && node.props.accessibilityRole === 'header',
      );
    const words = () => heading().parent!;
    const accessory = () =>
      words().find(
        node =>
          node.type === View &&
          !!node.props.onLayout &&
          node.findAll(
            inner =>
              inner.type === Text &&
              inner.props.children === copy.settings.primary.connected,
          ).length > 0,
      );
    const layout = (width: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } },
    });
    const lines = (...widths: number[]) => ({
      nativeEvent: {
        lines: widths.map(width => ({ width, height: 18, x: 0, y: 0 })),
      },
    });
    const measure = async (heard: {
      room?: number;
      accessory?: number;
      lines?: number[];
    }) =>
      act(async () => {
        if (heard.room) words().props.onLayout(layout(heard.room));
        if (heard.accessory)
          accessory().props.onLayout(layout(heard.accessory));
        if (heard.lines) heading().props.onTextLayout(lines(...heard.lines));
      });
    const below = () => flat(words()).flexDirection === 'column';

    // Below it, at Jest's font scale, until the heading's one line and the
    // accessory are measured to fit the room together.
    expect(below()).toBe(true);
    await measure({ room: 266, accessory: 120, lines: [240] });
    expect(below()).toBe(true);
    await measure({ lines: [90] });
    expect(below()).toBe(false);
    // Beside it, the heading takes what the accessory leaves and wraps
    // freely, so being squeezed shows as a second line.
    expect(flat(heading()).flex).toBe(1);
    expect(heading().props.numberOfLines).toBeUndefined();
    // The P10 device pass: 41pt wide, a letter or two a line.
    await measure({ lines: [30, 28, 41, 25, 18, 30, 30, 30, 30, 25] });
    expect(below()).toBe(true);
    // Alone on its line it has the whole width, and keeps its words whole.
    expect(flat(heading()).alignSelf).toBe('stretch');
    expect(heading().props).toMatchObject({
      numberOfLines: 2,
      adjustsFontSizeToFit: true,
    });
    expect(flat(accessory()).flexShrink).toBe(0);
    await unmount(tree);
  });

  test('a heading with no accessory measures nothing and keeps its words whole', async () => {
    const tree = await mount(
      <Section glyph="lock" title={copy.settings.phone.heading}>
        <Text>row</Text>
      </Section>,
    );
    const heading = tree.root.find(
      node => node.type === Text && node.props.accessibilityRole === 'header',
    );
    expect(heading.props.onTextLayout).toBeUndefined();
    expect(heading.parent!.props.onLayout).toBeUndefined();
    expect(heading.props.numberOfLines).toBe(2);
    await unmount(tree);
  });

  test('a label wraps between its words and shrinks rather than break one', async () => {
    const tree = await settings(regtest);
    const label = (words: string) =>
      tree.root.find(
        node => node.type === Text && node.props.children === words,
      );
    // "Diagnosti/cs" on the P10 device pass.
    expect(label(copy.settings.diagnostics.heading).props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
    });
    expect(label(copy.settings.wallet.chooseAnother).props).toMatchObject({
      numberOfLines: 3,
      adjustsFontSizeToFit: true,
    });
    expect(label(copy.settings.phone.haptics).props.numberOfLines).toBe(1);
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

describe('where a heading puts its accessory', () => {
  const fit = (lines: number[], room = 266, accessory = 120) => ({
    room,
    accessory,
    lines,
  });

  test('beside it, drops it once the heading takes a second line', () => {
    expect(accessoryBelow(false, fit([90]))).toBe(false);
    expect(accessoryBelow(false, fit([60, 40]))).toBe(true);
  });

  test('below it, brings it back only once the one line and it fit together', () => {
    expect(accessoryBelow(true, fit([90]))).toBe(false);
    // 240 + the gap + 120 is past 266.
    expect(accessoryBelow(true, fit([240]))).toBe(true);
    // Exactly the room, with nothing to spare, stays below.
    expect(accessoryBelow(true, fit([134]))).toBe(true);
    expect(accessoryBelow(true, fit([132]))).toBe(false);
    expect(accessoryBelow(true, fit([150, 60]))).toBe(true);
  });

  test('stays where it is until everything is measured', () => {
    expect(accessoryBelow(true, fit([90], 0))).toBe(true);
    expect(accessoryBelow(false, fit([60, 40], 266, 0))).toBe(false);
    expect(accessoryBelow(false, fit([]))).toBe(false);
  });
});

describe('the glyphs beside the words', () => {
  test('grow with the text size, from their own size to twice it', () => {
    expect(glyphScale(0.82)).toBe(1);
    expect(glyphScale(1)).toBe(1);
    expect(glyphScale(1.353)).toBe(1.353);
    // The largest accessibility size.
    expect(glyphScale(3.571)).toBe(GLYPH_SCALE_MAX);
  });

  test("a row's glyph and chevron, a heading's disc, the pills' and the close's grow at a large size", async () => {
    const tree = await settings(regtest);
    const glyph = (name: string, size: number) => glyphs(tree.root, name, size);
    // Diagnostics' info glyph and chevron (P10: 16 and 20 beside 50pt words).
    expect(glyph('info', grown(20)).length).toBeGreaterThan(0);
    expect(glyph('chevron', grown(16)).length).toBeGreaterThan(0);
    expect(glyph('lock', grown(18)).length).toBeGreaterThan(0);
    expect(glyph('flask', grown(14)).length).toBeGreaterThan(0);
    expect(glyph('chevron', 16)).toHaveLength(0);
    // The close grows whole, its target with its glyph, drawn at that size
    // rather than scaled up from 48pt, in a box that gives the bar the room
    // it takes.
    const size = CORNER_TARGET * glyphScale(FONT_SCALE);
    const box = tree.root.find(
      node =>
        node.type === View &&
        flat(node).width === size &&
        flat(node).height === size &&
        node.findAll(
          inner => inner.props.accessibilityLabel === copy.home.close,
        ).length > 0,
    );
    const close = box.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.home.close,
    );
    expect(flat(close)).toMatchObject({ width: size, height: size });
    expect(
      glyphs(close, 'close', 20 * glyphScale(FONT_SCALE)).length,
    ).toBeGreaterThan(0);
    expect(glyphs(close, 'close', 20)).toHaveLength(0);
    // Nothing between the box and the close scales it again.
    for (let at = close.parent; at && at !== box; at = at.parent) {
      const scale = (flat(at).transform ?? []).find(
        (step: Record<string, unknown>) => 'scale' in step,
      );
      expect(scale?.scale ?? 1).toBe(1);
    }
    await unmount(tree);
  });

  test('every network pill leads with a glyph, so their words share an axis', async () => {
    const tree = await mount(
      <NetworkChoice
        options={['mainnet', 'testnet', 'regtest'] as const}
        value="regtest"
        onChange={jest.fn()}
      />,
    );
    const lead = (label: string) => glyphs(host(tree, label))[0]?.props.name;
    // P10: mainnet had none, so its word sat off the flasks' axis.
    expect(lead('mainnet')).toBe('bolt');
    expect(lead('testnet')).toBe('flask');
    expect(lead('regtest')).toBe('flask');
    expect(glyphs(host(tree, 'mainnet'))[0].props.color).toBe(palette.bloom);
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
