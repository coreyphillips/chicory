import React from 'react';
import type { PropsWithChildren } from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../../../design/copy';
import type { WalletAdapter } from '../../../services/wallet';
import type { CanvasSession, CanvasView } from '../../../stage/Canvas';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import { snapshotOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { press } from '../../../../test-support/query';
import {
  REVEAL_GROWTH,
  REVEAL_MARGIN,
  SCROLL_THROTTLE,
  revealOffset,
} from '../reveal';
import { SettingsLayer, TITLE_FADE } from '../SettingsLayer';

/**
 * A row that opens below the fold is scrolled into view (REDESIGN.md 6,
 * Settings): the release gallery saw Empty wallet's review, Erase's warning
 * and Diagnostics' report open entirely below the fold, a chevron turning
 * and nothing else changing. The page scrolls only down, only as far as
 * keeps the row's header in view under the title's fade, never for a row
 * already in view or one closing, and never under a finger.
 */

const s = copy.settings;

describe('where the page scrolls to', () => {
  /** A 700pt page that starts under a 16pt fade and has 34pt cut off. */
  const at = (rowTop: number, rowBottom: number, current = 0) =>
    revealOffset({
      rowTop,
      rowBottom,
      viewportTop: 16,
      viewportHeight: 666,
      current,
      margin: 8,
    });

  test.each([
    ['a row already in view stays', 120, 520, 0, null],
    ['a row just in view at the foot stays', 300, 666, 0, null],
    [
      "a row whose foot is below brings its foot to the view's foot",
      400,
      900,
      0,
      234,
    ],
    [
      'a row taller than the view brings its header to the top, no further',
      400,
      1500,
      0,
      376,
    ],
    [
      'a row wholly below the fold, opened on its own, comes up to the foot',
      1200,
      1500,
      0,
      834,
    ],
    ['from part way down, the same', 500, 1000, 100, 334],
    [
      'a header already at the top stays, whatever is below',
      424,
      1500,
      400,
      null,
    ],
    [
      'a header the person scrolled away is never brought back',
      400,
      1400,
      600,
      null,
    ],
    ['a header under the fade is not chased upward', 410, 700, 400, null],
    ['less than a point is not worth a move', 400, 666.5, 0, null],
  ])('%s', (_, top, bottom, current, target) => {
    expect(at(top, bottom, current)).toBe(target);
  });

  test("never past where the header leaves the view's clear top", () => {
    for (const rowTop of [200, 640, 1300]) {
      for (const height of [56, 400, 2000]) {
        const y = at(rowTop, rowTop + height);
        if (y === null) continue;
        expect(rowTop - y).toBeGreaterThanOrEqual(16 + 8);
      }
    }
  });

  test('a page not yet laid out, or a row with no height, moves nowhere', () => {
    expect(
      revealOffset({
        rowTop: 900,
        rowBottom: 1300,
        viewportTop: 16,
        viewportHeight: 0,
        current: 0,
        margin: 8,
      }),
    ).toBeNull();
    expect(at(900, 900)).toBeNull();
  });

  test('the margin and the growth that counts', () => {
    expect(REVEAL_MARGIN).toBe(8);
    expect(REVEAL_GROWTH).toBe(48);
    expect(SCROLL_THROTTLE).toBe(16);
  });
});

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn(),
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

/** The page, its viewport and where the Erase row lands as it opens. */
const PAGE = 700;
const SCROLLED = 120;
const ROW_TOP = 900;
const ROW_HEIGHT = 400;
/** Where that leaves the page: the row's foot at the foot of the view. */
const TARGET = ROW_TOP + ROW_HEIGHT - (PAGE - INSETS.bottom);

/** What scrolls: the ScrollView's own content view. */
const CONTENT = { content: true };

const trees: ReactTestRenderer[] = [];

async function settings() {
  const tree = await mount(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <OnStage>
        <SettingsLayer
          snapshot={snapshotOf()}
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
  trees.push(tree);
  // Reduce Motion is read as Settings mounts.
  await act(async () => {});
  return tree;
}

const page = (tree: ReactTestRenderer) => tree.root.findByType(ScrollView);

/** The page lays out at its height, scrolled down `y`. */
const layOut = (tree: ReactTestRenderer, y = SCROLLED) =>
  act(async () => {
    page(tree).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: PAGE } },
    });
    page(tree).props.onScroll({
      nativeEvent: { contentOffset: { x: 0, y } },
    });
  });

/** The frame of the row labelled `label`: what moves as the page lays out. */
function frameOf(tree: ReactTestRenderer, label: string): ReactTestInstance {
  let at: ReactTestInstance | null = tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  )[0];
  while (at && !(at.props.layout && at.props.onLayout)) at = at.parent;
  return at!;
}

/** The row's frame reports the layout it ends at. */
const rowLaysOut = (
  tree: ReactTestRenderer,
  label: string,
  height = ROW_HEIGHT,
) =>
  act(async () => {
    frameOf(tree, label).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 342, height } },
    });
  });

/*
 * The mocks' own methods: one each, shared by every scroll view and every
 * view a suite draws, so each test starts them afresh.
 */
type ScrollTo = jest.Mock<void, [{ y: number; animated: boolean }]>;
type InnerView = jest.Mock<unknown, []>;
type Measure = jest.Mock<
  void,
  [unknown, (x: number, y: number, width: number, height: number) => void]
>;
const scrollTo = () => ScrollView.prototype.scrollTo as unknown as ScrollTo;
const innerView = () =>
  ScrollView.prototype.getInnerViewRef as unknown as InnerView;
const measureLayout = () => View.prototype.measureLayout as unknown as Measure;

/** Where the page was asked to scroll to, in order. */
const scrolls = () => scrollTo().mock.calls.map(([to]) => to);

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  scrollTo().mockReset();
  innerView().mockReset().mockReturnValue(CONTENT);
  // Measured against what scrolls, a row is where its layout ends.
  measureLayout()
    .mockReset()
    .mockImplementation((relative, done) => {
      if (relative === CONTENT) done(0, ROW_TOP, 342, ROW_HEIGHT);
    });
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  scrollTo().mockReset();
  innerView().mockReset();
  measureLayout().mockReset();
  jest.restoreAllMocks();
});

describe('a row that opens below the fold', () => {
  test('is scrolled into view once it has laid out, animated', async () => {
    const tree = await settings();
    await layOut(tree);
    await press(tree, s.erase.link);
    // Nothing moves before the row reports where it ends.
    expect(scrolls()).toEqual([]);
    await rowLaysOut(tree, s.erase.link);
    expect(TARGET).toBeGreaterThan(SCROLLED);
    expect(scrolls()).toEqual([{ y: TARGET, animated: true }]);
  });

  test('scrolls at its own pace on the frame the layout gives, and only once', async () => {
    const tree = await settings();
    await layOut(tree);
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link);
    // Moved as another row closes above it, it asks for nothing more.
    await rowLaysOut(tree, s.erase.link);
    expect(scrolls()).toHaveLength(1);
  });

  test('a row that closes is not scrolled to', async () => {
    const tree = await settings();
    await layOut(tree);
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link);
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link, 56);
    expect(scrolls()).toHaveLength(1);
  });

  test('a row already in view is left where it is', async () => {
    const tree = await settings();
    await layOut(tree, ROW_TOP - 100);
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link);
    expect(scrolls()).toEqual([]);
  });

  test('never under a finger, nor while a fling glides', async () => {
    const tree = await settings();
    await layOut(tree);
    await act(async () => page(tree).props.onScrollBeginDrag());
    await press(tree, s.diagnostics.heading);
    await rowLaysOut(tree, s.diagnostics.heading);
    expect(scrolls()).toEqual([]);
    await act(async () => {
      page(tree).props.onScrollEndDrag();
      page(tree).props.onMomentumScrollBegin();
    });
    await press(tree, s.diagnostics.heading);
    await press(tree, s.diagnostics.heading);
    await rowLaysOut(tree, s.diagnostics.heading);
    expect(scrolls()).toEqual([]);
    // Once it has come to rest, a row that opens is shown again.
    await act(async () =>
      page(tree).props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 0, y: SCROLLED } },
      }),
    );
    await press(tree, s.diagnostics.heading);
    await press(tree, s.diagnostics.heading);
    await rowLaysOut(tree, s.diagnostics.heading);
    expect(scrolls()).toEqual([{ y: TARGET, animated: true }]);
  });

  test('grown a lot while open by the person, it is shown again; a line more is left', async () => {
    const tree = await settings();
    await layOut(tree);
    await press(tree, s.wallet.serversLabel);
    await rowLaysOut(tree, s.wallet.serversLabel, 300);
    expect(scrolls()).toHaveLength(1);
    // An error's line appears: left where it is.
    await rowLaysOut(tree, s.wallet.serversLabel, 300 + REVEAL_GROWTH);
    expect(scrolls()).toHaveLength(1);
    // Edit servers opens its editor below the networks: shown.
    await press(tree, s.wallet.editServers);
    await rowLaysOut(tree, s.wallet.serversLabel, 900);
    expect(scrolls()).toHaveLength(2);
  });

  test('one that asks before the page is laid out is shown once it is', async () => {
    const tree = await settings();
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link);
    expect(scrolls()).toEqual([]);
    await layOut(tree, 0);
    expect(scrolls()).toEqual([
      { y: ROW_TOP + ROW_HEIGHT - (PAGE - INSETS.bottom), animated: true },
    ]);
  });

  test('the slot reports its scroll once a frame, and keeps its keyboard rules', async () => {
    const tree = await settings();
    expect(page(tree).props).toMatchObject({
      scrollEventThrottle: SCROLL_THROTTLE,
      keyboardShouldPersistTaps: 'handled',
      keyboardDismissMode: 'on-drag',
    });
    // The fade it keeps a header under is the title's.
    expect(TITLE_FADE).toBe(16);
  });
});

// Last in the file: Reduce Motion, once read, holds for the next mount.
describe('under Reduce Motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  test('the page jumps to the row rather than gliding', async () => {
    const tree = await settings();
    await layOut(tree);
    await press(tree, s.erase.link);
    await rowLaysOut(tree, s.erase.link);
    expect(scrolls()).toEqual([{ y: TARGET, animated: false }]);
  });
});
