import React, { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Keychain from 'react-native-keychain';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { ReceiveRequest, SendReview } from '@beignet/wallet-core';
import { AmountField } from '../src/components/AmountField';
import { copy } from '../src/design/copy';
import { Odometer } from '../src/glyphs/Odometer';
import { ActivityRow } from '../src/scenes/activity/ActivityRow';
import { shownSats } from '../src/scenes/receive/model';
import { ReceiveScreen } from '../src/screens/Receive';
import { SendScreen } from '../src/screens/Send';
import { SettingsScreen } from '../src/screens/Settings';
import { HomeScreen } from '../src/screens/Wallet';
import {
  loadSymbolPreference,
  setSymbolPreference,
} from '../src/services/symbolPreference';
import type { WalletAdapter } from '../src/services/wallet';
import { useCanvasView } from '../src/stage/Canvas';
import { clearHeldRequests } from '../src/stage/heldRequests';
import { amountIn, amountText, unitAffixes } from '../src/theme';
import type { Unit } from '../src/theme';
import {
  NOW,
  activityOf,
  receiptOf,
  requestOf,
  snapshotOf,
} from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { enterAmount } from '../test-support/keypad';
import { drawnIn, find, press, visibleText } from '../test-support/query';

/**
 * Settings > Show sats as ₿ (BIP 177): the sats face drawn as `₿2,000`
 * rather than `2,000 sats`, off unless turned on. Only what is drawn
 * changes: BTC is as it was, a screen reader still hears sats, and what is
 * keyed, sent and asked for is the same integer in sats.
 */

const SERVICE = 'com.beignet.wallet.bitcoin-symbol';
const noop = () => {};
const MAINNET = { wallet: { network: 'mainnet' as const } };

/** The secure store, as a map the keychain mock reads and writes. */
let records: Map<string, string>;
beforeEach(() => {
  clearHeldRequests();
  records = new Map();
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(async options =>
      records.has(options?.service || '')
        ? ({ password: records.get(options?.service || '') } as never)
        : false,
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (_name, value, options) => {
      records.set(options?.service || '', value);
      return { service: options?.service } as never;
    });
});
afterEach(() => {
  jest.mocked(Keychain.getGenericPassword).mockReset().mockResolvedValue(false);
  jest
    .mocked(Keychain.setGenericPassword)
    .mockReset()
    .mockResolvedValue({ service: 'test' } as never);
});

/** The host node with `testID`. */
const byId = (tree: ReactTestRenderer, testID: string) =>
  tree.root.find(
    node => typeof node.type === 'string' && node.props.testID === testID,
  );

describe('the formatter', () => {
  test('sats with the switch off, as today', () => {
    expect(amountIn(2_000, 'sats')).toEqual({
      prefix: '',
      value: '2,000',
      suffix: 'sats',
    });
    expect(amountText(2_000, 'sats')).toBe('2,000 sats');
  });

  test('sats with the switch on: the sign before, no space, and no word after', () => {
    expect(amountIn(2_000, 'sats', true)).toEqual({
      prefix: '₿',
      value: '2,000',
      suffix: '',
    });
    expect(amountText(2_000, 'sats', true)).toBe('₿2,000');
    expect(amountText(1_023_486_000, 'sats', true)).toBe('₿1,023,486,000');
    expect(shownSats(10_000, true)).toBe('₿10,000');
  });

  test('BTC is the same either way, with its suffix', () => {
    for (const sats of [0, 2_000, 10_000, 100_000_000]) {
      expect(amountIn(sats, 'btc', true)).toEqual(amountIn(sats, 'btc'));
      expect(amountText(sats, 'btc', true)).toBe(amountText(sats, 'btc'));
    }
    expect(amountText(2_000, 'btc', true)).toBe('0.00002 BTC');
    expect(unitAffixes('btc', true)).toEqual({ prefix: '', suffix: 'BTC' });
  });

  test('a value the formatter refuses is its placeholder, in either face', () => {
    for (const refused of [1.5, -1, Number.NaN]) {
      expect(amountText(refused, 'sats')).toBe('- sats');
      expect(amountText(refused, 'sats', true)).toBe('₿-');
    }
  });

  test('what is heard stays in sats', () => {
    expect(copy.amount.spoken(2_000)).toBe('2,000 sats');
    expect(copy.amount.field).toBe('Amount in sats');
    expect(copy.home.totalBalance(2_000, 'sats')).toBe(
      'Total balance 2,000 sats',
    );
  });
});

describe('the saved choice', () => {
  test('is off when nothing is saved, and when the store cannot be read', async () => {
    expect(await loadSymbolPreference()).toBe(false);
    records.set(SERVICE, 'garbled');
    expect(await loadSymbolPreference()).toBe(false);
    jest
      .mocked(Keychain.getGenericPassword)
      .mockRejectedValueOnce(new Error('locked'));
    expect(await loadSymbolPreference()).toBe(false);
  });

  test('is kept under a service of its own, not the haptics one', async () => {
    await setSymbolPreference(true);
    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
      'beignet-bitcoin-symbol',
      'on',
      expect.objectContaining({ service: SERVICE }),
    );
    expect(records.get('com.beignet.wallet.haptics')).toBeUndefined();
    expect(await loadSymbolPreference()).toBe(true);
    await setSymbolPreference(false);
    expect(records.get(SERVICE)).toBe('off');
    expect(await loadSymbolPreference()).toBe(false);
  });

  test('a save the store refuses throws', async () => {
    jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
    await expect(setSymbolPreference(true)).rejects.toThrow(
      copy.settings.phone.symbolFailed,
    );
  });
});

describe('the Settings switch', () => {
  const client = {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.23.1' }),
    snapshot: jest.fn(),
    getRecoveryPhrase: jest.fn(),
    updatePrimary: jest.fn(),
    retrySetup: jest.fn(),
  } as unknown as WalletAdapter;

  /**
   * The stage's view, as the app keeps it across a lock: Settings drawn
   * over it while `open`, and the balance's figures drawn by it otherwise,
   * which a lock or leaving Settings leaves the view to hold.
   */
  function Stage({ open }: { open: boolean }) {
    const view = useCanvasView();
    return open ? (
      <SettingsScreen
        snapshot={snapshotOf()}
        client={client}
        switchError=""
        onDisconnect={noop}
        onChooseWallet={noop}
        onRefresh={noop}
        onNetwork={async () => {}}
        symbol={view.symbol}
        onSymbol={view.setSymbol}
      />
    ) : (
      <Odometer
        sats={2_000}
        unit={view.unit}
        symbol={view.symbol}
        variant="hero"
      />
    );
  }

  const toggle = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === copy.settings.phone.symbolLabel &&
        typeof node.props.onValueChange === 'function',
    )[0];

  test('is off on a fresh install, and says what ₿ means', async () => {
    const tree = await mount(<Stage open />);
    expect(toggle(tree).props.value).toBe(false);
    expect(visibleText(tree)).toContain(copy.settings.phone.symbol);
    expect(visibleText(tree)).toContain(copy.settings.phone.symbolNote);
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith(
      expect.objectContaining({ service: SERVICE }),
    );
    await act(async () => tree.unmount());
  });

  test('turned on, is saved, holds across leaving Settings and a lock, and is read back at launch', async () => {
    const tree = await mount(<Stage open />);
    await act(async () => toggle(tree).props.onValueChange(true));
    expect(records.get(SERVICE)).toBe('on');
    expect(toggle(tree).props.value).toBe(true);
    // Settings gone, as leaving it or a lock takes it: the view keeps it.
    await act(async () => tree.update(<Stage open={false} />));
    expect(drawnIn(tree.root)).toBe('₿2,000');
    await act(async () => tree.update(<Stage open />));
    expect(toggle(tree).props.value).toBe(true);
    await act(async () => tree.unmount());
    // A cold start reads it from the store.
    const again = await mount(<Stage open={false} />);
    expect(drawnIn(again.root)).toBe('₿2,000');
    await act(async () => again.update(<Stage open />));
    expect(toggle(again).props.value).toBe(true);
    // And turned off, it is drawn in sats again, and stays so.
    await act(async () => toggle(again).props.onValueChange(false));
    expect(records.get(SERVICE)).toBe('off');
    await act(async () => again.update(<Stage open={false} />));
    expect(drawnIn(again.root)).toBe('2,000sats');
    await act(async () => again.unmount());
  });

  test('a choice that could not be saved leaves the switch where it was and says why', async () => {
    jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
    const tree = await mount(<Stage open />);
    await act(async () => toggle(tree).props.onValueChange(true));
    expect(toggle(tree).props.value).toBe(false);
    expect(visibleText(tree)).toContain(copy.settings.phone.symbolFailed);
    expect(records.has(SERVICE)).toBe(false);
    await act(async () => tree.update(<Stage open={false} />));
    expect(drawnIn(tree.root)).toBe('2,000sats');
    await act(async () => tree.unmount());
  });

  test('is not drawn where no view is handed in', async () => {
    const tree = await mount(
      <SettingsScreen
        snapshot={snapshotOf()}
        client={client}
        switchError=""
        onDisconnect={noop}
        onChooseWallet={noop}
        onRefresh={noop}
        onNetwork={async () => {}}
      />,
    );
    expect(toggle(tree)).toBeUndefined();
    await act(async () => tree.unmount());
  });
});

describe('the hero', () => {
  /** Home, its tap rolling the unit as the canvas's view does. */
  function Home({ symbol }: { symbol: boolean }) {
    const [unit, setUnit] = useState<Unit>('sats');
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
          onToggleUnit={() =>
            setUnit(value => (value === 'sats' ? 'btc' : 'sats'))
          }
        />
      </GestureHandlerRootView>
    );
  }
  const total = (tree: ReactTestRenderer) => drawnIn(byId(tree, 'home-total'));
  const sats = copy.home.totalBalance(261_500, 'sats');
  const btc = copy.home.totalBalance(261_500, 'btc');

  test('draws ₿ before the figures, and is still heard in sats', async () => {
    const tree = await mount(<Home symbol />);
    expect(total(tree)).toBe('₿261,500');
    const [balance] = byId(tree, 'home-hero').findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button',
    );
    expect(balance.props.accessibilityLabel).toBe(sats);
    expect(balance.props.accessibilityLabel).toContain(
      copy.amount.spoken(261_500),
    );
    expect(drawnIn(balance)).toContain('₿261,500');
    await act(async () => tree.unmount());
  });

  test('a tap rolls only between ₿ and BTC, and BTC is as it was', async () => {
    const off = await mount(<Home symbol={false} />);
    expect(total(off)).toBe('261,500sats');
    await act(async () => find(off, sats)!.props.onPress());
    const inBtc = total(off);
    await act(async () => off.unmount());

    const tree = await mount(<Home symbol />);
    await act(async () => find(tree, sats)!.props.onPress());
    expect(total(tree)).toBe(inBtc);
    expect(total(tree)).toBe('0.00261500BTC');
    expect(find(tree, btc)).toBeDefined();
    await act(async () => find(tree, btc)!.props.onPress());
    expect(total(tree)).toBe('₿261,500');
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

  /** Keys 4,200 on the keypad and reviews it, with the switch as given. */
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
    expect(visibleText(tree)).toEqual(
      expect.arrayContaining(['₿20', '₿4,220']),
    );
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
    const quoted = visibleText(tree);
    await press(tree, copy.receive.create);
    await settle();
    const made = visibleText(tree);
    await act(async () => tree.unmount());
    return { client, quoted, made };
  }

  test('draws the quote and the request in ₿', async () => {
    const { quoted, made } = await requested(true);
    expect(quoted).toEqual(
      expect.arrayContaining(['₿10,000', '₿100', '₿9,900']),
    );
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
