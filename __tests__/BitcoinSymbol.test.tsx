import React, { useState } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import * as Keychain from 'react-native-keychain';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { ReceiveRequest, SendReview } from '@beignet/wallet-core';
import { AmountField } from '../src/components/AmountField';
import { copy } from '../src/design/copy';
import { inlineAmount } from '../src/glyphs/InlineAmount';
import { Odometer } from '../src/glyphs/Odometer';
import { ActivityRow } from '../src/scenes/activity/ActivityRow';
import { HomePane } from '../src/scenes/home/HomePane';
import { ReceiveScreen } from '../src/screens/Receive';
import { SendScreen } from '../src/screens/Send';
import { HomeScreen } from '../src/screens/Wallet';
import type { WalletAdapter } from '../src/services/wallet';
import { useCanvasView } from '../src/stage/Canvas';
import type { CanvasSession } from '../src/stage/Canvas';
import { clearHeldRequests } from '../src/stage/heldRequests';
import { stops } from '../src/stage/layout';
import { Pane, PanesProvider } from '../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import {
  SYMBOL_SCALE,
  TEXT_SYMBOL_SCALE,
  amountIn,
  nextFace,
  symbolLift,
  type as typography,
  unitAffixes,
} from '../src/theme';
import {
  NOW,
  activityOf,
  receiptOf,
  requestOf,
  snapshotOf,
} from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { enterAmount } from '../test-support/keypad';
import { drawnIn, press, visibleText } from '../test-support/query';

/**
 * The sats face drawn as BIP 177 draws it, `₿2,000` rather than
 * `2,000 sats`, as the second stop of the tap on the balance: sats, then
 * ₿, then BTC. Only what is drawn changes: BTC is as it was, a screen
 * reader still hears sats, and what is keyed, sent and asked for is the
 * same integer in sats.
 */

const noop = () => {};
const MAINNET = { wallet: { network: 'mainnet' as const } };

beforeEach(() => clearHeldRequests());

/** The host node with `testID`. */
const byId = (tree: ReactTestRenderer | ReactTestInstance, testID: string) =>
  ('root' in tree ? tree.root : tree).find(
    node => typeof node.type === 'string' && node.props.testID === testID,
  );

/** An amount inside a line of text at 20pt, read as it is drawn. */
async function inLine(sats: number, unit: 'sats' | 'btc', symbol: boolean) {
  const tree = await mount(<Text>{inlineAmount(sats, unit, symbol, 20)}</Text>);
  const drawn = drawnIn(tree.root);
  await act(async () => tree.unmount());
  return drawn;
}

describe('the formatter', () => {
  test('sats, as today', async () => {
    expect(amountIn(2_000, 'sats')).toEqual({
      prefix: '',
      value: '2,000',
      suffix: 'sats',
    });
    expect(await inLine(2_000, 'sats', false)).toBe('2,000 sats');
  });

  test('sats as ₿: the sign before, no space, and no word after', async () => {
    expect(amountIn(2_000, 'sats', true)).toEqual({
      prefix: '₿',
      value: '2,000',
      suffix: '',
    });
    expect(await inLine(2_000, 'sats', true)).toBe('₿2,000');
    expect(await inLine(1_023_486_000, 'sats', true)).toBe('₿1,023,486,000');
  });

  test('BTC is the same either way, with its suffix', async () => {
    for (const sats of [0, 2_000, 10_000, 100_000_000]) {
      expect(amountIn(sats, 'btc', true)).toEqual(amountIn(sats, 'btc'));
      expect(await inLine(sats, 'btc', true)).toBe(
        await inLine(sats, 'btc', false),
      );
    }
    expect(await inLine(2_000, 'btc', true)).toBe('0.00002 BTC');
    expect(unitAffixes('btc', true)).toEqual({ prefix: '', suffix: 'BTC' });
  });

  test('a value the formatter refuses is its placeholder, in either face', async () => {
    for (const refused of [1.5, -1, Number.NaN]) {
      expect(await inLine(refused, 'sats', false)).toBe('- sats');
      expect(await inLine(refused, 'sats', true)).toBe('₿-');
    }
  });

  test('in a line of text the sign stands at its share of the line', async () => {
    const tree = await mount(
      <Text style={{ fontSize: 20 }}>
        {inlineAmount(2_000, 'sats', true, 20)}
      </Text>,
    );
    const sign = tree.root.find(
      node => typeof node.type === 'string' && node.children.join('') === '₿',
    );
    expect(StyleSheet.flatten(sign.props.style).fontSize).toBe(
      20 * TEXT_SYMBOL_SCALE,
    );
    await act(async () => tree.unmount());
  });

  test('what is heard stays in sats', () => {
    expect(copy.amount.spoken(2_000)).toBe('2,000 sats');
    expect(copy.amount.field).toBe('Amount in sats');
    expect(copy.home.totalBalance(2_000, 'sats')).toBe(
      'Total balance 2,000 sats',
    );
  });
});

describe('the tap on the balance', () => {
  test('rolls from ₿ to BTC to sats and back to ₿', () => {
    const sats = { unit: 'sats', symbol: false } as const;
    const symbol = { unit: 'sats', symbol: true } as const;
    const btc = { unit: 'btc', symbol: false } as const;
    expect(nextFace(sats.unit, sats.symbol)).toEqual(symbol);
    expect(nextFace(symbol.unit, symbol.symbol)).toEqual(btc);
    expect(nextFace(btc.unit, btc.symbol)).toEqual(sats);
    // BTC goes back to sats whatever the sign was left at.
    expect(nextFace('btc', true)).toEqual(sats);
  });

  const session: CanvasSession = {
    error: '',
    switchError: '',
    refreshing: false,
    connecting: false,
    refresh: jest.fn(),
    manualRefresh: jest.fn(),
    disconnect: jest.fn(),
    switchNetwork: jest.fn(),
    eraseDevice: jest.fn(),
  };
  const client = new DemoWalletClient();

  /**
   * Home on the canvas with the stage's own view, which outlives Home as
   * it does a lock: `home` false takes Home away and keeps the view.
   */
  function Stage({ home }: { home: boolean }) {
    const stage = useStageStore();
    const view = useCanvasView();
    const panes = {
      seam: useSharedValue(0),
      hero: useSharedValue(1),
      bar: useSharedValue(1),
      cover: useSharedValue(0),
      scan: useSharedValue(0),
      pull: useSharedValue(0),
      stops: stops(844, { top: 0 }),
    };
    return (
      <GestureHandlerRootView>
        <StageProvider value={stage}>
          <PanesProvider value={panes}>
            {home ? (
              <Pane active>
                <HomePane
                  snapshot={snapshotOf(MAINNET)}
                  client={client}
                  session={session}
                  view={view}
                  stale={false}
                  backup={null}
                  arrived={0}
                  home
                />
              </Pane>
            ) : null}
          </PanesProvider>
        </StageProvider>
      </GestureHandlerRootView>
    );
  }

  /** The balance, the control a tap rolls. */
  const balance = (tree: ReactTestRenderer) =>
    byId(tree, 'home-hero').findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )[0];
  const total = (tree: ReactTestRenderer) => drawnIn(byId(tree, 'home-total'));
  const tap = (tree: ReactTestRenderer) =>
    act(async () => balance(tree).props.onPress());
  const sats = copy.home.totalBalance(261_500, 'sats');
  const btc = copy.home.totalBalance(261_500, 'btc');

  test('opens in ₿, draws each face in turn, and says sats for both integer faces', async () => {
    const tree = await mount(<Stage home />);
    expect(total(tree)).toBe('₿261,500');
    expect(balance(tree).props.accessibilityLabel).toBe(sats);
    expect(balance(tree).props.accessibilityLabel).toContain(
      copy.amount.spoken(261_500),
    );
    await tap(tree);
    expect(total(tree)).toBe('0.00261500BTC');
    expect(balance(tree).props.accessibilityLabel).toBe(btc);
    await tap(tree);
    expect(total(tree)).toBe('261,500sats');
    expect(balance(tree).props.accessibilityLabel).toBe(sats);
    await tap(tree);
    expect(total(tree)).toBe('₿261,500');
    await act(async () => tree.unmount());
  });

  test("a screen reader's action rolls it the same way", async () => {
    const tree = await mount(<Stage home />);
    const roll = () =>
      act(async () =>
        balance(tree).props.onAccessibilityAction({
          nativeEvent: { actionName: 'unit' },
        }),
      );
    expect(balance(tree).props.accessibilityHint).toBe(copy.home.unitHint);
    await roll();
    expect(total(tree)).toBe('0.00261500BTC');
    await roll();
    expect(total(tree)).toBe('261,500sats');
    await act(async () => tree.unmount());
  });

  test('the face holds while Home is away, as across a lock', async () => {
    const tree = await mount(<Stage home />);
    await tap(tree);
    expect(total(tree)).toBe('0.00261500BTC');
    await act(async () => tree.update(<Stage home={false} />));
    await act(async () => tree.update(<Stage home />));
    expect(total(tree)).toBe('0.00261500BTC');
    await act(async () => tree.unmount());
  });

  describe('across launches', () => {
    const FACE = 'com.beignet.wallet.balance-face';
    let saved: Map<string, string>;
    beforeEach(() => {
      saved = new Map();
      jest
        .mocked(Keychain.getGenericPassword)
        .mockImplementation(async options =>
          saved.has(options?.service || '')
            ? ({ password: saved.get(options?.service || '') } as never)
            : false,
        );
      jest
        .mocked(Keychain.setGenericPassword)
        .mockImplementation(async (_name, value, options) => {
          saved.set(options?.service || '', value);
          return { service: options?.service || '' } as never;
        });
    });
    afterEach(() => {
      jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
      jest
        .mocked(Keychain.setGenericPassword)
        .mockResolvedValue({ service: 'test' } as never);
    });

    test('the face tapped to is the one the next launch opens on', async () => {
      const first = await mount(<Stage home />);
      await tap(first);
      await tap(first);
      expect(total(first)).toBe('261,500sats');
      expect(saved.get(FACE)).toBe('sats');
      await act(async () => first.unmount());

      const second = await mount(<Stage home />);
      expect(total(second)).toBe('261,500sats');
      await tap(second);
      expect(total(second)).toBe('₿261,500');
      expect(saved.get(FACE)).toBe('symbol');
      await act(async () => second.unmount());
    });

    test('BTC is kept too', async () => {
      saved.set(FACE, 'btc');
      const tree = await mount(<Stage home />);
      expect(total(tree)).toBe('0.00261500BTC');
      await act(async () => tree.unmount());
    });

    test('nothing saved, or something unreadable, opens in ₿', async () => {
      saved.set(FACE, 'nonsense');
      const tree = await mount(<Stage home />);
      expect(total(tree)).toBe('₿261,500');
      await act(async () => tree.unmount());
      jest
        .mocked(Keychain.getGenericPassword)
        .mockRejectedValue(new Error('locked'));
      const locked = await mount(<Stage home />);
      expect(total(locked)).toBe('₿261,500');
      await act(async () => locked.unmount());
    });

    test('a tap before the saved face is read wins over it', async () => {
      saved.set(FACE, 'sats');
      let answer!: () => void;
      jest.mocked(Keychain.getGenericPassword).mockImplementation(
        () =>
          new Promise(resolve => {
            answer = () => resolve({ password: 'sats' } as never);
          }),
      );
      const tree = await mount(<Stage home />);
      expect(total(tree)).toBe('₿261,500');
      await tap(tree);
      expect(total(tree)).toBe('0.00261500BTC');
      await act(async () => answer());
      expect(total(tree)).toBe('0.00261500BTC');
      expect(saved.get(FACE)).toBe('btc');
      await act(async () => tree.unmount());
    });

    test('a save that fails still draws the face tapped to', async () => {
      jest
        .mocked(Keychain.setGenericPassword)
        .mockRejectedValue(new Error('full'));
      const tree = await mount(<Stage home />);
      await tap(tree);
      expect(total(tree)).toBe('0.00261500BTC');
      await act(async () => tree.unmount());
    });
  });

  test('BTC is drawn the same whichever face came before it', async () => {
    function Alone({ symbol }: { symbol: boolean }) {
      const [unit, setUnit] = useState<'sats' | 'btc'>('sats');
      return (
        <GestureHandlerRootView>
          <HomeScreen
            snapshot={snapshotOf(MAINNET)}
            unit={unit}
            symbol={symbol}
            onSend={noop}
            onReceive={noop}
            onActivity={noop}
            onDetail={noop}
            onToggleUnit={() => setUnit('btc')}
          />
        </GestureHandlerRootView>
      );
    }
    const drawn: string[] = [];
    for (const symbol of [false, true]) {
      const tree = await mount(<Alone symbol={symbol} />);
      await tap(tree);
      drawn.push(total(tree));
      await act(async () => tree.unmount());
    }
    expect(drawn).toEqual(['0.00261500BTC', '0.00261500BTC']);
  });
});

describe('the bitcoin sign beside large figures', () => {
  // The system's text size grows the large figures up to 1.2 times, and
  // the lift with them.
  const GROWN = Math.min(Dimensions.get('window').fontScale, 1.2);
  const flat = (node: ReactTestInstance) =>
    StyleSheet.flatten(node.props.style) as {
      fontSize?: number;
      lineHeight?: number;
      alignSelf?: string;
      fontWeight?: string;
      transform?: Array<{ translateY?: number }>;
    };
  /** The text node drawing `₿`, and one drawing a figure, under `node`. */
  const texts = (node: ReactTestInstance) => {
    const all = node.findAll(
      at => typeof at.type === 'string' && at.children.length > 0,
    );
    const sign = all.find(at => at.children.join('') === '₿')!;
    const figure = all.find(at => /^\d$/.test(at.children.join('')))!;
    return { sign: flat(sign), figure: flat(figure) };
  };

  test('is a little smaller than the hero, in its line box', async () => {
    const tree = await mount(
      <Odometer sats={2_000} unit="sats" symbol variant="hero" />,
    );
    const { sign, figure } = texts(tree.root);
    expect(figure.fontSize).toBe(typography.hero.fontSize);
    expect(sign.fontSize).toBe(typography.hero.fontSize * SYMBOL_SCALE);
    expect(sign.lineHeight).toBe(figure.lineHeight);
    // A weight over the light figures, so its smaller strokes match theirs,
    // and raised so its middle is theirs.
    expect(figure.fontWeight).toBe('300');
    expect(sign.fontWeight).toBe('400');
    expect(sign.transform).toEqual([
      {
        translateY:
          -symbolLift(figure.fontSize ?? 0, figure.lineHeight ?? 0) * GROWN,
      },
    ]);
    await act(async () => tree.unmount());
  });

  test('in a row, stands on the figures at its share of the line', async () => {
    const tree = await mount(
      <Odometer sats={2_000} unit="sats" symbol variant="row" sign="+" />,
    );
    const { sign, figure } = texts(tree.root);
    expect(sign.fontSize).toBe((figure.fontSize ?? 0) * TEXT_SYMBOL_SCALE);
    expect(sign.transform).toBeUndefined();
    await act(async () => tree.unmount());
  });

  test('is as much smaller than the keyed digits, centred on them', async () => {
    const tree = await mount(
      <AmountField value="2000" onChangeText={noop} symbol />,
    );
    const readout = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.amount.field,
    );
    const { sign, figure } = texts(readout);
    expect(sign.fontSize).toBe((figure.fontSize ?? 0) * SYMBOL_SCALE);
    expect(sign.lineHeight).toBe(figure.lineHeight);
    expect(sign.alignSelf).toBe('center');
    expect(sign.fontWeight).toBe('400');
    expect(sign.transform).toEqual([
      {
        translateY:
          -symbolLift(figure.fontSize ?? 0, figure.lineHeight ?? 0) * GROWN,
      },
    ]);
    await act(async () => tree.unmount());
  });
});

describe('a row', () => {
  const row = async (item: ReturnType<typeof activityOf>, hidden = false) => {
    const tree = await mount(
      <ActivityRow item={item} onPress={noop} hidden={hidden} symbol />,
    );
    const drawn = drawnIn(tree.root);
    const label = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button',
    ).props.accessibilityLabel as string;
    await act(async () => tree.unmount());
    return { drawn, label };
  };

  test('puts the sign before the ₿, and says the amount in sats', async () => {
    const sent = activityOf('sent', 'completed', { amountSats: 2_000 });
    const received = activityOf('received', 'completed', { amountSats: 2_000 });
    expect((await row(sent)).drawn).toContain('−₿2,000');
    expect((await row(sent)).label).toContain(copy.amount.spoken(2_000));
    expect((await row(received)).drawn).toContain('+₿2,000');
    expect((await row(received)).drawn).not.toContain('sats');
  });

  test('hidden, keeps the ₿ and drops the sign and figures', async () => {
    const sent = activityOf('sent', 'completed', { amountSats: 2_000 });
    const { drawn } = await row(sent, true);
    expect(drawn).toContain('₿••••••');
    expect(drawn).not.toContain('2,000');
    expect(drawn).not.toContain('−');
  });

  test("leaves the engine's words about sats as they are", async () => {
    const note = '200,000 sats are in a transfer';
    const moving = activityOf('transfer', 'pending', { description: note });
    expect((await row(moving)).drawn).toContain(note);
  });
});

describe('the keypad', () => {
  test('draws ₿ before the digits and no "sats", and is heard in sats', async () => {
    const tree = await mount(
      <AmountField value="2000" onChangeText={noop} symbol />,
    );
    const readout = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.amount.field,
    );
    expect(drawnIn(readout)).toBe('₿2,000');
    expect(readout.props.accessibilityValue).toEqual({ text: '2,000 sats' });
    await act(async () => tree.unmount());
  });

  test('with nothing keyed, draws ₿0', async () => {
    const tree = await mount(
      <AmountField value="" onChangeText={noop} symbol />,
    );
    const readout = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.amount.field,
    );
    expect(drawnIn(readout)).toBe('₿0');
    await act(async () => tree.unmount());
  });
});

describe('a send', () => {
  const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  const review: SendReview = {
    id: 'review-symbol',
    destination: ADDRESS,
    description: '',
    amountSats: 4_200,
    feeSats: 20,
    feeLabel: 'Maximum fee',
    totalSats: 4_220,
    route: 'lightning',
    expiresAt: Date.now() + 600_000,
    warnings: [],
  };

  /** Keys 4,200 on the keypad and reviews it, in the face given. */
  async function reviewed(symbol: boolean) {
    const prepareSend = jest.fn().mockResolvedValue(review);
    const tree = await mount(
      <GestureHandlerRootView>
        <SendScreen
          client={{ prepareSend } as unknown as WalletAdapter}
          initialRequest={ADDRESS}
          onActivity={noop}
          onRefresh={noop}
          onBusy={noop}
          balance={snapshotOf().balance}
          activity={[]}
          symbol={symbol}
        />
      </GestureHandlerRootView>,
    );
    await enterAmount(tree, '4200');
    await press(tree, copy.send.review);
    return { tree, prepareSend };
  }

  /** The review's amount, the one element a screen reader lands on. */
  const summary = (tree: ReactTestRenderer): ReactTestInstance =>
    tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessible === true &&
        node.props.accessibilityLabel === copy.amount.spoken(4_200),
    );

  test('a review draws ₿ and is heard in sats', async () => {
    const { tree } = await reviewed(true);
    expect(drawnIn(summary(tree))).toBe('₿4,200');
    expect(drawnIn(tree.root)).toContain('₿20');
    expect(drawnIn(tree.root)).toContain('₿4,220');
    expect(visibleText(tree).join(' ')).not.toContain('sats');
    await act(async () => tree.unmount());
  });

  test('asks the wallet for the same amount either way', async () => {
    const off = await reviewed(false);
    await act(async () => off.tree.unmount());
    const on = await reviewed(true);
    await act(async () => on.tree.unmount());
    expect(on.prepareSend.mock.calls).toEqual(off.prepareSend.mock.calls);
    expect(on.prepareSend).toHaveBeenCalledWith(
      expect.objectContaining({ amountSats: 4_200 }),
    );
  });
});

describe('a receive', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(0);
    });

  /** Keys 10,000, takes the quote and makes the request. */
  async function requested(symbol: boolean) {
    const client = {
      getConfig: jest.fn().mockResolvedValue({}),
      quoteReceive: jest.fn().mockResolvedValue({
        id: 'quote',
        amountSats: 10_000,
        description: '',
        feeSats: 100,
        netSats: 9_900,
        expiresAt: NOW + 60_000,
        warnings: [],
      }),
      receive: jest
        .fn()
        .mockResolvedValue(requestOf({ createdAt: NOW }) as ReceiveRequest),
      getReceiveStatus: jest.fn().mockResolvedValue(receiptOf('waiting')),
    };
    const tree = await mount(
      <ReceiveScreen
        client={client as unknown as WalletAdapter}
        receivableSats={100_000}
        onActivity={noop}
        onBusy={noop}
        symbol={symbol}
      />,
    );
    await settle();
    await enterAmount(tree, '10000');
    await press(tree, copy.receive.continue);
    await settle();
    const quoted = drawnIn(tree.root);
    await press(tree, copy.receive.create);
    await settle();
    const made = drawnIn(tree.root);
    await act(async () => tree.unmount());
    return { client, quoted, made };
  }

  test('draws the quote and the request in ₿', async () => {
    const { quoted, made } = await requested(true);
    for (const amount of ['₿10,000', '₿100', '₿9,900']) {
      expect(quoted).toContain(amount);
    }
    expect(quoted).not.toContain('sats');
    expect(made).toContain('₿10,000');
  });

  test('asks for the same quote and request either way', async () => {
    const off = await requested(false);
    const on = await requested(true);
    expect(on.client.quoteReceive.mock.calls).toEqual(
      off.client.quoteReceive.mock.calls,
    );
    expect(on.client.receive.mock.calls).toEqual(off.client.receive.mock.calls);
    expect(on.client.quoteReceive).toHaveBeenCalledWith(
      expect.objectContaining({ amountSats: 10_000 }),
    );
  });
});
