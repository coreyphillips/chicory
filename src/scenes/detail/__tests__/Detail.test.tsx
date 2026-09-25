import React from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity } from '@beignet/wallet-core';
import { forgetSpoken } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { Glyph } from '../../../design/glyphs';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { CopyChip } from '../../../glyphs/CopyChip';
import { Odometer } from '../../../glyphs/Odometer';
import { StatusRing } from '../../../glyphs/StatusRing';
import { FOCUS_SETTLE_MS } from '../../../motion/speech';
import { ReceiveRequestDetails } from '../../../components/ReceiveRequestDetails';
import { DetailScreen } from '../../../screens/wallet/Detail';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import {
  DetailCard,
  DetailReturn,
  GROUND_MS,
} from '../../../stage/layers/DetailCard';
import { SceneSlot } from '../../../stage/panes/SceneSlot';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { MASK, dateLabel } from '../../../theme';
import { durations } from '../../../motion/tokens';
import { PANE_SETTLE_MS } from '../../../stage/layout';
import {
  activityOf,
  everyActivity,
  snapshotOf,
} from '../../../../test-support/fixtures';
import {
  alerts,
  meaning,
  visibleText,
  whispers,
} from '../../../../test-support/query';
import * as motionPrefs from '../../../services/motion';
import { ringWords, statusSentence } from '../model';
import {
  CARD_RADIUS,
  EXPAND_MS,
  HEADER_TOPS,
  ROW_RADIUS,
  frameOver,
  headerIn,
  launch,
  restingFrame,
  rowParts,
} from '../motion';

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

/**
 * The live regions that would speak `label` again whenever it changes: any
 * host element carrying it that Android reads out on its own.
 */
const liveRegions = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === label &&
        !!node.props.accessibilityLiveRegion &&
        node.props.accessibilityLiveRegion !== 'none',
    )
    .map(node => node.props.accessibilityLiveRegion);

// A phrase said within 2s is not said again, so each test starts with
// nothing said.
beforeEach(() => forgetSpoken());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

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

  test('copies each reference once, each led by a glyph for what it is', async () => {
    const chips = async (item: Activity) => {
      const tree = await render(<DetailScreen item={item} />);
      const found = tree.root.findAllByType(CopyChip).map(chip => {
        // The chip keeps its copy glyph, so it shows that it copies; the
        // glyph before it on its line says what the value is.
        expect(chip.props.glyph ?? 'copy').toBe('copy');
        // The glyph is memoized; the test renderer sees the one inside.
        const drawn = (Glyph as unknown as { type: React.ComponentType }).type;
        const own = chip.findAllByType(drawn);
        const leads = (node: ReactTestInstance) =>
          node.findAllByType(drawn).filter(glyph => !own.includes(glyph));
        let line = chip.parent!;
        while (!leads(line).length) line = line.parent!;
        return [chip.props.label, leads(line)[0].props.name];
      });
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

  test('in BTC its fee keeps all eight decimals, as the hero, the trailing zeros in dust', async () => {
    const item = { ...EVERY['sent completed'], feeSats: 1_000 };
    const tree = await render(<DetailScreen item={item} unit="btc" />);
    const line = spoken(tree, 'Fee, 1,000 sats');
    // Read in the order it is drawn, nested text and all.
    const read = (node: ReactTestInstance): string =>
      node.children
        .map(child => (typeof child === 'string' ? child : read(child)))
        .join('');
    expect(read(line)).toBe('0.00001000 BTC');
    const dust = line.findAll(
      node =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.color === palette.dust,
    );
    expect(dust.map(node => node.children)).toEqual([['000']]);
    await act(async () => tree.unmount());
  });

  test('keeps a hidden balance hidden, in what it shows and what it says', async () => {
    const item = EVERY['sent completed'];
    const tree = await render(<DetailScreen item={item} hidden />);
    const amount = tree.root.findByType(Odometer);
    expect(amount.props).toMatchObject({
      masked: true,
      accessibilityLabel: copy.detail.amountHidden,
    });
    // The mask alone, with no sign to say which way the money went.
    const drawn = amount
      .findAllByType(Text)
      .flatMap(node => node.props.children)
      .join('');
    expect(drawn).toBe(`${MASK}sats`);
    expect(spoken(tree, copy.detail.feeHidden(false))).toBeDefined();
    expect(meaning(tree)).not.toContain('4,200');
    expect(meaning(tree)).not.toContain('12 sats');
    await act(async () => tree.unmount());
  });

  test('held, its ring whispers what it shows', async () => {
    const item = EVERY['sent completed'];
    const tree = await render(<DetailScreen item={item} />);
    expect(whispers(tree)).toContainEqual({
      label: ringWords(item).label,
      on: true,
    });
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
  test('is held, and a screen reader hears it once focus has landed', async () => {
    jest.useFakeTimers();
    const announce = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    const polite = jest.mocked(AccessibilityInfo.announceForAccessibility);
    announce.mockClear();
    polite.mockClear();
    const said = () =>
      [...announce.mock.calls, ...polite.mock.calls]
        .map(([text]) => text)
        .filter(text => text === copy.detail.uncertain);
    const tree = await render(<DetailScreen item={EVERY['sent uncertain']} />);
    expect(tree.root.findByType(StatusRing).props.visual).toMatchObject({
      tone: 'honey',
      pattern: 'held',
      glyph: 'pause',
    });
    expect(alerts(tree)).toEqual([copy.detail.uncertain]);
    // Held until the card has settled and the canvas's focus move has
    // landed, so the move does not cut it short (REDESIGN.md 9).
    expect(said()).toEqual([]);
    await act(async () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 100));
    expect(said()).toHaveLength(1);
    expect(announce).toHaveBeenCalledWith(copy.detail.uncertain, {
      queue: false,
    });
    // Said once: a live region carrying the same words would have Android
    // read them a second time.
    expect(liveRegions(tree, copy.detail.uncertain)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test('is not said once the detail has closed before it is heard', async () => {
    jest.useFakeTimers();
    const announce = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    announce.mockClear();
    const tree = await render(<DetailScreen item={EVERY['sent uncertain']} />);
    await act(async () => tree.unmount());
    await act(async () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 100));
    expect(announce).not.toHaveBeenCalled();
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

  test('is said once focus has landed, over whatever else is being read', async () => {
    jest.useFakeTimers();
    const announce = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    announce.mockClear();
    const tree = await render(<DetailScreen item={reused} />);
    expect(alerts(tree)).toEqual([label]);
    expect(announce).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(FOCUS_SETTLE_MS + 100));
    expect(announce).toHaveBeenCalledWith(label, { queue: false });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(liveRegions(tree, label)).toEqual([]);
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

describe('the lines', () => {
  /** Whether `node` is drawn inside a component of type `type`. */
  const within = (node: ReactTestInstance, type: unknown) => {
    for (let at = node.parent; at; at = at.parent) {
      if (at.type === type) return true;
    }
    return false;
  };

  test('hold their type to the 1.4 cap of the row amounts', async () => {
    const item = {
      ...EVERY['sent completed'],
      description: 'Coffee beans',
      feeEstimated: true,
    };
    const tree = await render(<DetailScreen item={item} />);
    const lines = tree.root
      .findAllByType(Text)
      .filter(text => !within(text, Odometer) && !within(text, CopyChip));
    const said = lines.map(text => text.props.children);
    expect(said).toEqual(
      expect.arrayContaining([dateLabel(item.timestamp), '≈', 'Coffee beans']),
    );
    expect(lines.map(text => text.props.maxFontSizeMultiplier)).toEqual(
      lines.map(() => 1.4),
    );
    await act(async () => tree.unmount());
  });

  test('hand the test network to the request a payment keeps', async () => {
    const item = EVERY['request pending'];
    expect(item.receiveRequest).toBeDefined();
    for (const test of [false, true]) {
      const tree = await render(<DetailScreen item={item} test={test} />);
      expect(
        tree.root
          .findAllByType(ReceiveRequestDetails)
          .map(details => details.props.test),
      ).toEqual([test]);
      await act(async () => tree.unmount());
    }
  });
});

describe('the card', () => {
  const rect = { x: 24, y: 480, width: 327, height: 64 };

  test('grows in the 320ms T4 gives it, inside the transition lock', () => {
    // REDESIGN.md 7, T4: the ring and amount fly to the header from 0 to
    // 320, and the card that carries them holds the 340ms lock, so taps wait
    // until it has grown.
    expect(EXPAND_MS).toBe(durations.move);
    expect(EXPAND_MS).toBeLessThanOrEqual(PANE_SETTLE_MS);
  });

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

  /**
   * What a layout animation is handed on the new architecture: the frame in
   * its parent's coordinates, with the "global" origin the very same frame
   * rather than the window's (Reanimated 4, LayoutAnimationsProxyCommon).
   */
  const target = {
    targetOriginX: 0,
    targetOriginY: 0,
    targetWidth: 375,
    targetHeight: 740,
    targetBorderRadius: CARD_RADIUS,
    targetGlobalOriginX: 0,
    targetGlobalOriginY: 0,
    windowWidth: 375,
    windowHeight: 812,
  };

  /** The slot the canvas keeps for the card, 72 down with no insets. */
  const card = { x: 0, y: 72, width: 375 };
  const place = {
    card,
    back: { get: () => null },
  } as unknown as React.ContextType<typeof DetailReturn>;

  test('grows out of the row it was opened from, wherever its parent sits', async () => {
    const tree = await render(
      <DetailReturn value={place}>
        <DetailCard item={EVERY['sent completed']} from={rect}>
          <Text>4,200</Text>
        </DetailCard>
      </DetailReturn>,
    );
    const grown = cardView(tree).props.entering(target);
    // Laid over the row in the window: 480 down is 408 into the slot.
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

  test('without its place on the canvas it only fades in', async () => {
    const tree = await render(
      <DetailCard item={EVERY['sent completed']} from={rect}>
        <Text>4,200</Text>
      </DetailCard>,
    );
    const faded = cardView(tree).props.entering(target);
    expect(faded.initialValues).not.toHaveProperty('originY');
    expect(faded.initialValues).toMatchObject({ opacity: 0 });
    await act(async () => tree.unmount());
  });

  /** The card's ground, drawn under what it holds. */
  const groundOf = (tree: ReactTestRenderer) =>
    cardView(tree).findAll(node => typeof node.type === 'string')[1];

  test('grown out of a row, its ground comes up as the rows around it fade', async () => {
    // T4: the other rows fade and drop from 0 to 140. An opaque card would
    // sweep them away under its edges as it grows instead.
    expect(GROUND_MS).toBe(durations.exit);
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const tree = await render(
      <DetailReturn value={place}>
        <DetailCard item={EVERY['sent completed']} from={rect}>
          <Text>4,200</Text>
        </DetailCard>
      </DetailReturn>,
    );
    expect(StyleSheet.flatten(cardView(tree).props.style)).not.toHaveProperty(
      'backgroundColor',
    );
    const ground = StyleSheet.flatten(groundOf(tree).props.style);
    expect(ground.backgroundColor).toBe(palette.espresso);
    expect(timings).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: GROUND_MS }),
    );
    await act(async () => tree.unmount());
  });

  test('without a row to grow from, its ground is there from the start', async () => {
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const tree = await render(
      <DetailReturn value={place}>
        <DetailCard item={EVERY['sent completed']} from={null}>
          <Text>4,200</Text>
        </DetailCard>
      </DetailReturn>,
    );
    expect(StyleSheet.flatten(groundOf(tree).props.style).opacity).toBe(1);
    expect(timings).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: GROUND_MS }),
    );
    await act(async () => tree.unmount());
  });
});

describe('the header flying out of its row', () => {
  const rect = { x: 24, y: 480, width: 327, height: 64 };

  test('starts where the row drew its ring and its amount', () => {
    expect(rowParts(rect, { banded: false, note: false })).toEqual({
      ring: { x: 44, y: 512 },
      amount: { x: 76, y: 512 },
    });
    // A pinned row pads its content in from the band, and a note under the
    // amount lifts it above the row's middle.
    expect(rowParts(rect, { banded: true, note: true })).toEqual({
      ring: { x: 56, y: 512 },
      amount: { x: 88, y: 503 },
    });
  });

  test('flies straight to its place while the card grows around it', () => {
    const flight = { from: rect, card: { x: 0, y: 72, width: 375 } };
    const target = { originX: 139.5, originY: 88, width: 96, height: 96 };
    const start = { x: 44, y: 512 };
    const off = launch(target, flight, start, 40 / 96, 'center');
    expect(off.scale).toBe(40 / 96);
    // The card and the transform share a clock and a curve, so at any
    // point `e` of it the card has come that far and the transform has that
    // far left to go.
    const centre = (e: number) => ({
      x:
        rect.x +
        (flight.card.x - rect.x) * e +
        (target.originX - flight.card.x) +
        target.width / 2 +
        off.translateX * (1 - e),
      y:
        rect.y +
        (flight.card.y - rect.y) * e +
        (target.originY - flight.card.y) +
        target.height / 2 +
        off.translateY * (1 - e),
    });
    const place = { x: 187.5, y: 136 };
    expect(centre(0)).toEqual(start);
    expect(centre(1)).toEqual(place);
    expect(centre(0.5)).toEqual({
      x: (start.x + place.x) / 2,
      y: (start.y + place.y) / 2,
    });
  });

  test('an amount keeps its left end on the row’s as it grows', () => {
    const flight = { from: rect, card: { x: 0, y: 72, width: 375 } };
    const target = { originX: 100, originY: 190, width: 175, height: 48 };
    const off = launch(target, flight, { x: 76, y: 512 }, 0.4, 'left');
    const left =
      rect.x +
      target.originX -
      flight.card.x +
      target.width / 2 +
      off.translateX -
      (target.width * off.scale) / 2;
    expect(left).toBe(76);
  });

  test('lands centred across the card, under the top of its slot', () => {
    // The slot's scroll starts 16 down, the header pads 8 over the ring, and
    // the amount sits 12 under the 96pt ring.
    expect(HEADER_TOPS).toEqual({ ring: 24, amount: 132 });
    const card = { x: 10, y: 72, width: 375 };
    expect(restingFrame(card, HEADER_TOPS.ring, 96, 96)).toEqual({
      originX: 10 + (375 - 96) / 2,
      originY: 96,
      width: 96,
      height: 96,
    });
    expect(restingFrame(card, HEADER_TOPS.amount, 175, 48)).toEqual({
      originX: 10 + (375 - 175) / 2,
      originY: 204,
      width: 175,
      height: 48,
    });
  });

  test('without a row, the ring grows where it stands and the amount waits', () => {
    const header = headerIn(null, EVERY['sent completed']);
    expect(header.amount).toBeUndefined();
    expect(header.ring({} as never)).toMatchObject({
      initialValues: { opacity: 0, transform: [{ scale: 40 / 96 }] },
    });
  });

  test('under Reduce Motion nothing flies', () => {
    jest.spyOn(motionPrefs, 'motionReduced').mockReturnValue(true);
    const header = headerIn(
      { from: rect, card: { x: 0, y: 72, width: 375 } },
      EVERY['sent completed'],
    );
    expect(header.amount).toBeUndefined();
    const ring = header.ring({} as never);
    expect(ring.initialValues).toMatchObject({ opacity: 0 });
    expect(ring.initialValues.transform).not.toContainEqual({
      scale: 40 / 96,
    });
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
      <GestureHandlerRootView>
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
      </GestureHandlerRootView>
    );
  }

  // As the new architecture hands it over: the "global" origin is the frame
  // in the parent's coordinates too.
  const leaving = {
    currentOriginX: 0,
    currentOriginY: 0,
    currentWidth: 375,
    currentHeight: 740,
    currentBorderRadius: CARD_RADIUS,
    currentGlobalOriginX: 0,
    currentGlobalOriginY: 0,
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

  test('flies its ring and amount out of the row it grew from', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await act(async () => {});
    await act(async () => stage.actions.openDetail(item, rect));
    // Each is handed its frame in its own parent, the header, and a
    // "global" origin that is that same frame.
    const entering = (node: ReactTestInstance) => {
      const x = node === ring ? 139.5 : 100;
      const y = node === ring ? 8 : 116;
      return node.props.entering({
        targetOriginX: x,
        targetOriginY: y,
        targetGlobalOriginX: x,
        targetGlobalOriginY: y,
        targetWidth: node === ring ? 96 : 175,
        targetHeight: node === ring ? 96 : 48,
      });
    };
    const ring = spoken(tree, ringWords(item).label);
    // Home's hero is an Odometer too, so look inside the card.
    const amount = tree.root.findByType(DetailCard).findByType(Odometer)
      .parent!;
    // The slot sits at the compact stop, 72 below the top with no insets,
    // and the card fills the canvas's width. Grown from the row, the card
    // starts 480 - 72 lower than it rests, and 24 to the right.
    const { width } = Dimensions.get('window');
    expect(entering(ring).initialValues.transform).toEqual([
      { translateX: 44 - (24 + (width - 96) / 2 + 48) },
      { translateY: 512 - (480 + 24 + 48) },
      { scale: 40 / 96 },
    ]);
    expect(entering(amount).initialValues.transform).toEqual([
      { translateX: 76 + (175 * 0.4) / 2 - (24 + (width - 175) / 2 + 87.5) },
      { translateY: 512 - (480 + 132 + 24) },
      { scale: 0.4 },
    ]);
    expect(entering(amount).animations.transform).toEqual([
      { translateX: 0 },
      { translateY: 0 },
      { scale: 1 },
    ]);
    await act(async () => tree.unmount());
  });

  test('rings in slate on a test network, as the rows do', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openDetail(item, rect));
    const ring = tree.root.findByType(DetailCard).findByType(StatusRing);
    expect(snapshot.wallet.network).not.toBe('mainnet');
    expect(ring.props.test).toBe(true);
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
