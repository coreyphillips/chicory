import React from 'react';
import { AccessibilityInfo, ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { CopyChip } from '../../../glyphs/CopyChip';
import { Odometer } from '../../../glyphs/Odometer';
import { StatusRing } from '../../../glyphs/StatusRing';
import { DetailScreen } from '../../../screens/wallet/Detail';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import { DetailCard } from '../../../stage/layers/DetailCard';
import { SceneSlot } from '../../../stage/panes/SceneSlot';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { dateLabel } from '../../../theme';
import {
  activityOf,
  everyActivity,
  snapshotOf,
} from '../../../../test-support/fixtures';
import { alerts, meaning, visibleText } from '../../../../test-support/query';
import { ringWords, statusSentence } from '../model';
import { CARD_RADIUS, ROW_RADIUS, frameOver } from '../motion';

/**
 * A payment's detail (REDESIGN.md 6, Detail, and 7, T4): what its ring says,
 * the lines and chips under it, and the card that grows out of its row.
 */
const EVERY = everyActivity();

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** The labelled element a screen reader stops on for `label`. */
const spoken = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  )[0];

afterEach(() => jest.restoreAllMocks());

describe('what the ring says', () => {
  test.each<[string, string]>([
    ['sent completed', copy.detail.completed],
    ['sent pending', copy.detail.inProgress],
    ['received pending', copy.detail.detected],
    ['request pending', copy.detail.awaiting],
    ['sent uncertain', copy.detail.uncertain],
    ['sent failed', copy.detail.failed],
    ['request expired', copy.detail.expired],
    ['legacy invoice, expired', copy.detail.legacyExpired],
  ])('%s', (name, sentence) => {
    expect(statusSentence(EVERY[name])).toBe(sentence);
  });

  test('an unknown outcome and a reused address are said at once', () => {
    const safety = Object.entries(EVERY)
      .filter(([, item]) => ringWords(item).safety)
      .map(([name]) => name);
    expect(safety).toEqual([
      'sent uncertain',
      'received uncertain',
      'request uncertain',
      'transfer uncertain',
      'request with a reused address',
    ]);
  });

  test('a receipt says where the money has got to', () => {
    expect(ringWords(EVERY['request partly paid']).label).toBe(
      'Partially received.',
    );
    expect(ringWords(EVERY['request paid, confirming']).label).toBe(
      'Confirming.',
    );
  });

  test('what the badge adds, and a status that could not be read, follow', () => {
    expect(ringWords(EVERY['request with a reused address']).label).toBe(
      `${copy.detail.awaiting} Address reused.`,
    );
    expect(ringWords(EVERY['request whose status is unavailable']).label).toBe(
      `${copy.detail.awaiting} ${copy.detail.unavailable}`,
    );
    expect(ringWords(EVERY['legacy invoice, expired']).label).toBe(
      `${copy.detail.legacyExpired} Older request.`,
    );
    expect(ringWords(EVERY['sent completed']).value).toBe('Status, Completed');
  });
});

describe('the detail', () => {
  test('leads with the ring and the amount, and says the rest in glyph-led lines', async () => {
    const item = EVERY['received with a note'];
    const tree = await render(<DetailScreen item={item} />);
    expect(tree.root.findByType(StatusRing).props.size).toBe(96);
    const amount = tree.root.findByType(Odometer);
    expect(amount.props).toMatchObject({
      sats: 4_200,
      variant: 'amountDetail',
      sign: '+',
      accessibilityLabel: 'Amount, 4,200 sats',
    });
    const date = dateLabel(item.timestamp);
    expect(spoken(tree, `Date, ${date}`)).toBeDefined();
    expect(spoken(tree, 'Fee, 0 sats')).toBeDefined();
    expect(spoken(tree, 'Note, Lunch with Sam')).toBeDefined();
    expect(visibleText(tree)).toEqual(
      expect.arrayContaining([date, '0 sats', 'Lunch with Sam']),
    );
    // The engine's title and the outcome are for a screen reader only.
    expect(visibleText(tree)).not.toContain(item.title);
    expect(visibleText(tree)).not.toContain(copy.detail.completed);
    expect(meaning(tree)).toContain(item.title);
    expect(meaning(tree)).toContain(copy.detail.completed);
    await act(async () => tree.unmount());
  });

  test('marks an estimated fee, and asks about one that is not known', async () => {
    let tree = await render(
      <DetailScreen item={EVERY['sent with an estimated fee']} />,
    );
    expect(spoken(tree, 'Estimated fee, 12 sats')).toBeDefined();
    expect(visibleText(tree)).toEqual(expect.arrayContaining(['≈', '12 sats']));
    await act(async () => tree.unmount());
    tree = await render(
      <DetailScreen item={EVERY['sent with an unknown fee']} />,
    );
    expect(spoken(tree, copy.detail.feeUnavailable)).toBeDefined();
    expect(visibleText(tree)).not.toContain('12 sats');
    await act(async () => tree.unmount());
  });

  test('copies each reference once, each with a glyph for what it is', async () => {
    const chips = async (item: Activity) => {
      const tree = await render(<DetailScreen item={item} />);
      const found = tree.root
        .findAllByType(CopyChip)
        .map(chip => [chip.props.label, chip.props.glyph]);
      await act(async () => tree.unmount());
      return found;
    };
    expect(await chips(EVERY['sent completed'])).toEqual([
      ['Payment hash', 'bolt'],
    ]);
    expect(await chips(EVERY['sent on chain'])).toEqual([
      ['Transaction', 'chain'],
      ['Address', 'pin'],
    ]);
    expect(
      await chips({ ...EVERY['sent completed'], reference: 'lnbcrt1ref' }),
    ).toEqual([
      ['Reference', 'hash'],
      ['Payment hash', 'bolt'],
    ]);
  });

  test('keeps a hidden balance hidden, in what it shows and what it says', async () => {
    const item = EVERY['sent completed'];
    const tree = await render(<DetailScreen item={item} hidden />);
    expect(tree.root.findByType(Odometer).props).toMatchObject({
      masked: true,
      sign: null,
      accessibilityLabel: copy.detail.amountHidden,
    });
    expect(spoken(tree, copy.detail.feeHidden(false))).toBeDefined();
    expect(meaning(tree)).not.toContain('4,200');
    expect(meaning(tree)).not.toContain('12 sats');
    await act(async () => tree.unmount());
  });

  test('a request for any amount shows infinity', async () => {
    const tree = await render(
      <DetailScreen item={EVERY['request for any amount']} />,
    );
    expect(tree.root.findAllByType(Odometer)).toHaveLength(0);
    expect(spoken(tree, copy.amount.any)).toBeDefined();
    await act(async () => tree.unmount());
  });
});

describe('an unknown outcome', () => {
  test('is held, and a screen reader hears it at once', async () => {
    const announce = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    const polite = jest.mocked(AccessibilityInfo.announceForAccessibility);
    announce.mockClear();
    polite.mockClear();
    const tree = await render(<DetailScreen item={EVERY['sent uncertain']} />);
    expect(tree.root.findByType(StatusRing).props.visual).toMatchObject({
      tone: 'honey',
      pattern: 'held',
      glyph: 'pause',
    });
    expect(alerts(tree)).toEqual([copy.detail.uncertain]);
    const said = [...announce.mock.calls, ...polite.mock.calls].map(
      ([text]) => text,
    );
    expect(said).toContain(copy.detail.uncertain);
    expect(spoken(tree, copy.detail.uncertain).props).toMatchObject({
      accessibilityLiveRegion: 'assertive',
    });
    await act(async () => tree.unmount());
  });

  test('is felt when a payment turns uncertain while its detail is open', async () => {
    const held = jest.spyOn(haptics, 'held').mockImplementation(() => {});
    const pending = EVERY['sent pending'];
    const tree = await render(<DetailScreen item={pending} />);
    expect(held).not.toHaveBeenCalled();
    await act(async () =>
      tree.update(<DetailScreen item={{ ...pending, status: 'uncertain' }} />),
    );
    expect(held).toHaveBeenCalledTimes(1);
    await act(async () =>
      tree.update(<DetailScreen item={{ ...pending, status: 'uncertain' }} />),
    );
    expect(held).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('is never drawn or said as done', async () => {
    const tree = await render(<DetailScreen item={EVERY['sent uncertain']} />);
    expect(meaning(tree)).not.toContain(copy.detail.completed);
    expect(alerts(tree)).not.toContain(copy.detail.completed);
    await act(async () => tree.unmount());
  });
});

describe('a reused address', () => {
  const reused = EVERY['request with a reused address'];
  const label = `${copy.detail.awaiting} Address reused.`;

  test('is said at once, over whatever else is being read', async () => {
    const announce = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    announce.mockClear();
    const tree = await render(<DetailScreen item={reused} />);
    expect(alerts(tree)).toEqual([label]);
    expect(announce).toHaveBeenCalledWith(label, { queue: false });
    await act(async () => tree.unmount());
  });

  test('is felt when it is found while the detail is open', async () => {
    const warning = jest.spyOn(haptics, 'warning').mockImplementation(() => {});
    const held = jest.spyOn(haptics, 'held').mockImplementation(() => {});
    const waiting = EVERY['request pending'];
    const tree = await render(<DetailScreen item={waiting} />);
    await act(async () =>
      tree.update(
        <DetailScreen
          item={{ ...waiting, receiveRequest: reused.receiveRequest }}
        />,
      ),
    );
    expect(warning).toHaveBeenCalledTimes(1);
    expect(held).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('the card', () => {
  const rect = { x: 24, y: 480, width: 327, height: 64 };

  test('lies over the row in its parent’s coordinates', () => {
    expect(frameOver(rect, { x: 0, y: 0 }, { x: 0, y: 72 })).toEqual({
      originX: 24,
      originY: 408,
      width: 327,
      height: 64,
    });
    expect(frameOver(rect, { x: 10, y: 20 }, { x: 10, y: 92 })).toEqual({
      originX: 24,
      originY: 408,
      width: 327,
      height: 64,
    });
  });

  /** The card's animated view, which carries its layout animations. */
  const cardView = (tree: ReactTestRenderer): ReactTestInstance =>
    tree.root
      .findByType(DetailCard)
      .findAll(node => typeof node.type === 'string')[0];

  const target = {
    targetOriginX: 0,
    targetOriginY: 0,
    targetWidth: 375,
    targetHeight: 740,
    targetBorderRadius: CARD_RADIUS,
    targetGlobalOriginX: 0,
    targetGlobalOriginY: 72,
    windowWidth: 375,
    windowHeight: 812,
  };

  test('grows out of the row it was opened from', async () => {
    const tree = await render(
      <DetailCard item={EVERY['sent completed']} from={rect}>
        <Text>4,200</Text>
      </DetailCard>,
    );
    const grown = cardView(tree).props.entering(target);
    expect(grown.initialValues).toEqual({
      originX: 24,
      originY: 408,
      width: 327,
      height: 64,
      borderRadius: ROW_RADIUS,
    });
    // Under Jest a timing lands on its target at once.
    expect(grown.animations).toEqual({
      originX: 0,
      originY: 0,
      width: 375,
      height: 740,
      borderRadius: CARD_RADIUS,
    });
    await act(async () => tree.unmount());
  });
});

describe('the detail on the canvas', () => {
  let stage!: StageStore;
  const item = activityOf('sent', 'completed', { title: 'Coffee' });
  const rect = { x: 24, y: 480, width: 327, height: 64 };
  const snapshot = snapshotOf({ activity: [item] });

  function OnCanvas() {
    stage = useStageStore();
    const view = useCanvasView();
    return (
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={new DemoWalletClient()}
          snapshot={snapshot}
          session={{
            error: '',
            switchError: '',
            refreshing: false,
            connecting: false,
            refresh: jest.fn(),
            manualRefresh: jest.fn(),
            disconnect: jest.fn(),
            chooseWallet: jest.fn(),
            switchNetwork: jest.fn(),
            eraseDevice: jest.fn(),
          }}
          stale={false}
          backup={null}
          view={view}
        />
      </StageProvider>
    );
  }

  const leaving = {
    currentOriginX: 0,
    currentOriginY: 0,
    currentWidth: 375,
    currentHeight: 740,
    currentBorderRadius: CARD_RADIUS,
    currentGlobalOriginX: 0,
    currentGlobalOriginY: 72,
    windowWidth: 375,
    windowHeight: 812,
  };
  const exitOf = (tree: ReactTestRenderer) =>
    tree.root
      .findByType(DetailCard)
      .findAll(node => typeof node.type === 'string')[0]
      .props.exiting(leaving);

  test('folds back into its row when it closes onto the list', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await act(async () => {});
    await act(async () => stage.actions.openDetail(item, rect));
    const folded = exitOf(tree);
    expect(folded.animations).toMatchObject({
      originX: 24,
      originY: 408,
      width: 327,
      height: 64,
      borderRadius: ROW_RADIUS,
      opacity: 0,
    });
    await act(async () => tree.unmount());
  });

  test('fades when it closes onto home, where the row is moving', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openDetail(item, rect));
    expect(exitOf(tree)).toEqual({
      initialValues: { opacity: 1 },
      animations: { opacity: 0 },
    });
    await act(async () => tree.unmount());
  });

  test('keeps the end of the detail clear of the system bars', async () => {
    const tree = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, bottom: 34, left: 0, right: 0 },
        }}
      >
        <OnCanvas />
      </SafeAreaProvider>,
    );
    await act(async () => stage.actions.openDetail(item));
    const slot = tree.root.findByType(SceneSlot);
    const [, spacer] = slot.findByType(ScrollView).props.children;
    expect(spacer.props.style).toEqual({ height: 34 });
    await act(async () => tree.unmount());
  });
});
