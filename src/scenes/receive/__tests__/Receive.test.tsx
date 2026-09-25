import React, { useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type {
  Activity,
  ReceiveQuote,
  ReceiveRequest,
  ReceiveStatus,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { AmountField } from '../../../components/AmountField';
import { ReceiveRequestDetails } from '../../../components/ReceiveRequestDetails';
import { copy } from '../../../design/copy';
import { Glyph } from '../../../design/glyphs';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import * as tokens from '../../../motion/tokens';
import { ReceiveScreen } from '../../../screens/Receive';
import type { WalletAdapter } from '../../../services/wallet';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { mount } from '../../../../test-support/guard';
import { enterAmount } from '../../../../test-support/keypad';
import {
  alerts,
  componentPath,
  find,
  meaning,
} from '../../../../test-support/query';
import { CONTROL as SEND_CONTROL } from '../../send/Controls';
import { BANG, DrawnGlyph } from '../../send/DrawnGlyph';
import { Unplugged } from '../../send/LoopingGlyphs';
import { Spin } from '../loops';

/**
 * Receive's accessibility, feedback and look (REDESIGN.md 6 and 9), driven
 * through the screen as a person would: an amount, its quote, the request.
 */
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const noop = () => {};
const MINUTE = 60_000;

const quoteOf = (over: Partial<ReceiveQuote> = {}): ReceiveQuote => ({
  id: 'q1',
  amountSats: 1000,
  description: '',
  feeSats: 0,
  netSats: 1000,
  expiresAt: Date.now() + MINUTE,
  warnings: [],
  ...over,
});

const requestOf = (over: Partial<ReceiveRequest> = {}): ReceiveRequest => ({
  id: 'r1',
  uri: 'bitcoin:bcrt1address?lightning=lnbcrt1invoice',
  address: 'bcrt1address',
  bolt11: 'lnbcrt1invoice',
  paymentHash: 'ab'.repeat(32),
  amountSats: 1000,
  description: '',
  feeSats: 0,
  expiresAt: Date.now() + 10 * MINUTE,
  warnings: [],
  demo: false,
  bitcoinTracking: 'unique',
  ...over,
});

const waiting: ReceiveStatus = {
  phase: 'waiting',
  receivedSats: 0,
  confirmedSats: 0,
  pendingSats: 0,
  txids: [],
};

function clientOf(
  over: Partial<Record<keyof WalletAdapter, unknown>> = {},
): WalletAdapter {
  return {
    quoteReceive: jest.fn().mockResolvedValue(quoteOf()),
    receive: jest.fn().mockResolvedValue(requestOf()),
    getReceiveStatus: jest.fn().mockResolvedValue(waiting),
    ...over,
  } as unknown as WalletAdapter;
}

async function screen(
  client: WalletAdapter,
  props: Partial<React.ComponentProps<typeof ReceiveScreen>> = {},
) {
  return mount(
    <ReceiveScreen
      client={client}
      receivableSats={10_000}
      onActivity={noop}
      onBusy={noop}
      {...props}
    />,
  );
}

const tap = (tree: ReactTestRenderer, label: string) =>
  act(async () => {
    await find(tree, label)!.props.onPress();
  });

/** Lets focus that waits for an idle moment move. */
const idle = () =>
  act(async () => {
    jest.advanceTimersByTime(0);
  });

async function toQuote(tree: ReactTestRenderer) {
  await enterAmount(tree, '1000');
  await tap(tree, copy.receive.continue);
}

async function toRequest(tree: ReactTestRenderer) {
  await toQuote(tree);
  await tap(tree, copy.receive.create);
}

/** The labels of the elements a screen reader was moved to, in turn. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(
      ([node]) =>
        (node as unknown as ReactTestInstance).props.accessibilityLabel,
    );

/** Whether a screen reader skips `node`: it, or something round it, is hidden. */
function unreachable(node: ReactTestInstance | null): boolean {
  for (let at = node; at; at = at.parent) {
    if (
      at.props.accessibilityElementsHidden === true ||
      at.props.importantForAccessibility === 'no-hide-descendants'
    ) {
      return true;
    }
  }
  return false;
}

/** The labelled controls a screen reader can reach. */
const reachable = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        typeof node.props.accessibilityLabel === 'string',
    )
    .filter(node => !unreachable(node))
    .map(node => node.props.accessibilityLabel as string);

describe('a lifted code', () => {
  test('holds a screen reader: what it covers is hidden, and focus goes to it and back', async () => {
    const tree = await screen(clientOf());
    await toRequest(tree);
    await tap(tree, copy.receive.qr);
    await idle();

    // What the scrim covers is out of reach; the lifted code is not.
    const heard = reachable(tree);
    expect(heard).toContain(copy.receive.closeQr);
    for (const covered of [
      copy.receive.share,
      copy.receive.copy,
      copy.receive.createAnother,
    ]) {
      expect(heard).not.toContain(covered);
    }
    const modal = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityViewIsModal === true,
    );
    expect(modal).toHaveLength(1);
    expect(focused().at(-1)).toBe(copy.receive.closeQr);

    // The escape gesture sets it down, and focus goes back to the code.
    await act(async () => modal[0].props.onAccessibilityEscape());
    await idle();
    expect(find(tree, copy.receive.closeQr)).toBeUndefined();
    expect(reachable(tree)).toContain(copy.receive.share);
    expect(focused().at(-1)).toBe(copy.receive.qr);
    await act(async () => tree.unmount());
  });
});

describe('focus', () => {
  test('a quote running out sends a screen reader to the refresh that replaced create', async () => {
    const tree = await screen(clientOf());
    await toQuote(tree);
    await idle();
    expect(focused().at(-1)).toBe(copy.receive.create);
    await act(async () => {
      jest.advanceTimersByTime(MINUTE + 1000);
    });
    await idle();
    expect(find(tree, copy.receive.create)).toBeUndefined();
    expect(focused().at(-1)).toBe(copy.receive.refreshQuote);
    await act(async () => tree.unmount());
  });
});

describe('what a screen reader hears', () => {
  test('the plus on a partly paid request says what is still owed', async () => {
    const partial: ReceiveStatus = {
      phase: 'partial',
      receivedSats: 400,
      confirmedSats: 0,
      pendingSats: 400,
      txids: ['tx-one'],
      method: 'bitcoin',
    };
    for (const hidden of [false, true]) {
      const tree = await screen(
        clientOf({ getReceiveStatus: jest.fn().mockResolvedValue(partial) }),
        { hidden },
      );
      await toRequest(tree);
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      const plus = find(tree, copy.receive.requestRemaining)!;
      expect(plus.props.accessibilityValue).toEqual({
        text: hidden ? copy.amount.hidden : copy.amount.spoken(600),
      });
      await act(async () => tree.unmount());
    }
  });

  test('the orbit round a busy control is drawing, not a thing to reach', async () => {
    let answer!: (quote: ReceiveQuote) => void;
    const quoteReceive = jest.fn(
      () =>
        new Promise<ReceiveQuote>(resolve => {
          answer = resolve;
        }),
    );
    const tree = await screen(clientOf({ quoteReceive }));
    await enterAmount(tree, '1000');
    await act(async () => {
      find(tree, copy.receive.continue)!.props.onPress();
    });
    const orbits = tree.root.findAllByType(Spin);
    expect(orbits).toHaveLength(1);
    expect(unreachable(orbits[0])).toBe(true);
    await act(async () => answer(quoteOf()));
    await act(async () => tree.unmount());
  });
});

describe('the primary node away', () => {
  const DOWN =
    'Your primary node needs to reconnect before creating this request.';
  const down = () => Object.assign(new Error(DOWN), { code: 'PRIMARY_DOWN' });

  /** Where `memo` component `drawing` is drawn: the function inside it. */
  const drawn = (tree: ReactTestRenderer, drawing: object) =>
    tree.root.findAll(
      node => node.type === (drawing as { type: unknown }).type,
    );

  /**
   * The bangs drawn, still or drawing themselves in, and the unplugs with
   * their colours.
   */
  const marks = (tree: ReactTestRenderer) => ({
    bangs: [...drawn(tree, Glyph), ...drawn(tree, DrawnGlyph)].filter(
      glyph => glyph.props.name === 'bang',
    ).length,
    unplugs: drawn(tree, Unplugged).map(unplug => unplug.props.color),
  });

  test.each([
    ['quoted', { quoteReceive: jest.fn(() => Promise.reject(down())) }],
    ['created', { receive: jest.fn(() => Promise.reject(down())) }],
  ])(
    'refused as a request is %s, it is a honey unplug felt as a warning and not shaken',
    async (_at, refusing) => {
      const warning = jest.spyOn(haptics, 'warning');
      const error = jest.spyOn(haptics, 'error');
      const shakes = jest.spyOn(tokens, 'shake');
      const tree = await screen(clientOf(refusing));
      if ('quoteReceive' in refusing) await toQuote(tree);
      else await toRequest(tree);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(shakes).not.toHaveBeenCalled();
      expect(marks(tree)).toEqual({ bangs: 0, unplugs: [palette.honey] });
      expect(alerts(tree)).toEqual([DOWN]);
      await act(async () => tree.unmount());
    },
  );

  test('anything the map does not name is still a radish bang, an error and a shake', async () => {
    const warning = jest.spyOn(haptics, 'warning');
    const error = jest.spyOn(haptics, 'error');
    const shakes = jest.spyOn(tokens, 'shake');
    const tree = await screen(
      clientOf({
        quoteReceive: jest.fn(() =>
          Promise.reject(new Error('No route to the primary.')),
        ),
      }),
    );
    await toQuote(tree);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    expect(shakes).toHaveBeenCalledTimes(1);
    expect(marks(tree)).toEqual({ bangs: 1, unplugs: [] });
    // The bang draws in as Send's does, its line and then its dot.
    const bangs = drawn(tree, DrawnGlyph).filter(
      glyph => glyph.props.name === 'bang',
    );
    expect(bangs.map(bang => [bang.props.color, bang.props.strokes])).toEqual([
      [palette.radish, BANG],
    ]);
    await act(async () => tree.unmount());
  });
});

describe('money arriving with Receive open on the canvas', () => {
  const HASH = 'ab'.repeat(32);
  /** The request as the wallet's history lists it until it is paid. */
  const asked: Activity = {
    id: `payment:${HASH}`,
    kind: 'request',
    title: 'Payment request',
    description: '',
    amountSats: 1000,
    feeSats: 0,
    status: 'pending',
    timestamp: Date.now(),
    reference: HASH,
    paymentHash: HASH,
  };
  /** The same payment, paid over Lightning. */
  const paidAsked: Activity = {
    ...asked,
    kind: 'received',
    status: 'completed',
  };
  /** A Bitcoin payment to the request's address, seen or confirmed. */
  const onChain = (status: Activity['status']): Activity => ({
    id: 'transaction:tx-one',
    kind: 'received',
    title: 'Bitcoin received',
    description: '',
    amountSats: 1000,
    feeSats: 0,
    status,
    timestamp: Date.now(),
    reference: 'tx-one',
    txid: 'tx-one',
  });
  const base: WalletSnapshot = {
    wallet: {
      id: 'w',
      name: 'Everyday',
      network: 'mainnet',
      status: 'running',
    },
    balance: {
      totalSats: 261_500,
      availableSats: 250_000,
      pendingSats: 0,
      receivableSats: 100_000,
    },
    activity: [asked],
    primary: { uri: 'node', connected: true, setup: 'ready' },
    notes: [],
    updatedAt: Date.now(),
    demo: false,
  };

  let stage!: StageStore;

  /**
   * The canvas on a wallet whose every read lists `read()`: a refresh is a
   * new read, as the session makes one.
   */
  function OnCanvas({
    client,
    read,
  }: {
    client: WalletAdapter;
    read: () => Activity[];
  }) {
    stage = useStageStore();
    const view = useCanvasView();
    const [snapshot, setSnapshot] = useState(base);
    const session = useMemo<React.ComponentProps<typeof Canvas>['session']>(
      () => ({
        error: '',
        switchError: '',
        refreshing: false,
        connecting: false,
        refresh: async () =>
          setSnapshot(last => ({
            ...last,
            updatedAt: last.updatedAt + 1,
            activity: read(),
          })),
        manualRefresh: jest.fn(),
        disconnect: jest.fn(),
        chooseWallet: jest.fn(),
        switchNetwork: jest.fn(),
        eraseDevice: jest.fn(),
      }),
      [read],
    );
    return (
      <GestureHandlerRootView>
        <StageProvider value={stage}>
          <Canvas
            scene={stage.state.scene}
            overlay={stage.state.overlay}
            client={client}
            snapshot={snapshot}
            session={session}
            stale={false}
            backup={null}
            view={view}
          />
        </StageProvider>
      </GestureHandlerRootView>
    );
  }

  /** A wallet that answers Receive from `status` and the rest as a demo. */
  const walletOf = (status: () => ReceiveStatus) =>
    Object.assign(Object.create(new DemoWalletClient()), {
      quoteReceive: jest.fn().mockResolvedValue(quoteOf()),
      receive: jest.fn().mockResolvedValue(requestOf()),
      getReceiveStatus: jest.fn(async () => status()),
    }) as WalletAdapter;

  /** Receive open on the canvas, with a request made. */
  async function requested(client: WalletAdapter, read: () => Activity[]) {
    const tree = await mount(<OnCanvas client={client} read={read} />);
    await act(async () => stage.actions.openReceive());
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await toRequest(tree);
    return tree;
  }

  /** Two polls of the request's status, and the reads they ask for. */
  const polls = async () => {
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        jest.advanceTimersByTime(2100);
      });
    }
  };

  test('a Lightning payment is felt once, as the wallet reads it', async () => {
    let paid = false;
    const client = walletOf(() =>
      paid
        ? {
            phase: 'completed',
            receivedSats: 1000,
            confirmedSats: 1000,
            pendingSats: 0,
            txids: [],
            method: 'lightning',
          }
        : waiting,
    );
    const incoming = jest.spyOn(haptics, 'incoming');
    const success = jest.spyOn(haptics, 'success');
    const tree = await requested(client, () => [paid ? paidAsked : asked]);
    expect(incoming).not.toHaveBeenCalled();
    paid = true;
    await polls();
    expect(meaning(tree)).toContain(copy.receive.received);
    expect(incoming).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('on chain, money seen is felt as it is seen, and once more as it confirms', async () => {
    let now: 'waiting' | 'seen' | 'confirmed' = 'waiting';
    const client = walletOf(() =>
      now === 'waiting'
        ? waiting
        : {
            phase: now === 'seen' ? 'pending' : 'completed',
            receivedSats: 1000,
            confirmedSats: now === 'seen' ? 0 : 1000,
            pendingSats: now === 'seen' ? 1000 : 0,
            txids: ['tx-one'],
            method: 'bitcoin',
          },
    );
    const incoming = jest.spyOn(haptics, 'incoming');
    const success = jest.spyOn(haptics, 'success');
    const tree = await requested(client, () =>
      now === 'waiting'
        ? [asked]
        : [asked, onChain(now === 'seen' ? 'pending' : 'completed')],
    );
    now = 'seen';
    await polls();
    expect(meaning(tree)).toContain(copy.receive.detected);
    expect(incoming).toHaveBeenCalledTimes(1);
    now = 'confirmed';
    await polls();
    expect(meaning(tree)).toContain(copy.receive.received);
    expect(incoming).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('the way on', () => {
  /** How wide the control labelled `label` is drawn. */
  const width = (tree: ReactTestRenderer, label: string) =>
    StyleSheet.flatten(find(tree, label)!.props.style).width;

  test("is the size the home circle grows to as Receive opens, as Send's is", async () => {
    const tree = await screen(clientOf());
    expect(width(tree, copy.receive.continue)).toBe(SEND_CONTROL);
    await toQuote(tree);
    expect(width(tree, copy.receive.create)).toBe(SEND_CONTROL);
    await act(async () => tree.unmount());
  });
});

describe('type', () => {
  /** Every run of text and every field drawn, outside the amount keypad. */
  const texts = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(node => node.type === Text || node.type === TextInput)
      .filter(node => {
        for (let at = node.parent; at; at = at.parent) {
          if (at.type === AmountField) return false;
        }
        return true;
      });

  /** What would grow past a row's 1.4 with Dynamic Type, by what it shows. */
  const uncapped = (tree: ReactTestRenderer) =>
    texts(tree)
      .filter(node => !(node.props.maxFontSizeMultiplier <= 1.4))
      .map(node => node.props.children ?? node.props.accessibilityLabel);

  test('grows with Dynamic Type no further than a row does, in every step', async () => {
    const client = clientOf({
      getConfig: jest.fn().mockResolvedValue({ offlineReceiveAvailable: true }),
    });
    const tree = await screen(client, { offlineReceivableSats: 50_000 });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: copy.receive.offline })
        .props.onPress();
    });
    await tap(tree, copy.receive.addNote);
    expect(uncapped(tree)).toEqual([]);
    // The offline cap is meta as the scale has it, 12 on 16.
    const cap = texts(tree).find(node => node.props.children === '≤')!;
    expect(StyleSheet.flatten(cap.props.style)).toMatchObject({
      fontSize: 12,
      lineHeight: 16,
    });
    await enterAmount(tree, '1000');
    await tap(tree, copy.receive.continue);
    expect(find(tree, copy.receive.create)).toBeDefined();
    expect(uncapped(tree)).toEqual([]);
    await tap(tree, copy.receive.create);
    expect(uncapped(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test("a payment's detail sets its request string in mono, 12 on 18", async () => {
    const request = requestOf();
    const item: Activity = {
      id: `payment:${request.paymentHash}`,
      kind: 'request',
      title: 'Payment request',
      description: '',
      amountSats: 1000,
      feeSats: 0,
      status: 'pending',
      timestamp: Date.now(),
      reference: request.bolt11,
      paymentHash: request.paymentHash,
      receiveRequest: request,
    };
    const tree = await mount(<ReceiveRequestDetails item={item} />);
    const shown = texts(tree).find(
      node => node.props.children === request.uri,
    )!;
    expect(StyleSheet.flatten(shown.props.style)).toMatchObject({
      fontSize: 12,
      lineHeight: 18,
    });
    expect(shown.props.maxFontSizeMultiplier).toBe(1.4);
    await act(async () => tree.unmount());
  });
});

describe('a test network', () => {
  const BLOOMS = [
    palette.bloom,
    palette.bloomHi,
    palette.bloomDeep,
    palette.bloomNight,
  ].map(hex => hex.toLowerCase());

  /** Whether `value`, or anything in it, is one of bloom's colours. */
  const blooms = (value: unknown): boolean =>
    typeof value === 'string'
      ? BLOOMS.includes(value.toLowerCase())
      : Array.isArray(value)
      ? value.some(blooms)
      : !!value && typeof value === 'object'
      ? Object.values(value).some(blooms)
      : false;

  /**
   * Where something is drawn in bloom, as the path of components to it. The
   * expiry rings count too: on a test network their calm stroke is slate
   * (REDESIGN.md 10.2).
   */
  const inBloom = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(node => {
        const { stroke, fill, color, selectionColor, style } = node.props;
        return blooms([
          stroke,
          fill,
          color,
          selectionColor,
          StyleSheet.flatten(style),
        ]);
      })
      .map(node => componentPath(node));

  /** Receive through each step with slate for bloom, or not: what it drew. */
  async function drawn(test: boolean) {
    let answer!: (quote: ReceiveQuote) => void;
    const client = clientOf({
      getConfig: jest.fn().mockResolvedValue({ offlineReceiveAvailable: true }),
      quoteReceive: jest.fn(
        () =>
          new Promise<ReceiveQuote>(resolve => {
            answer = resolve;
          }),
      ),
      receive: jest
        .fn()
        .mockResolvedValue(requestOf({ offlineReceive: true } as object)),
    });
    const seen: string[] = [];
    const tree = await screen(client, {
      test,
      receivableSats: 0,
      offlineReceivableSats: 50_000,
    });
    // The sprout and the caret while an amount is needed.
    seen.push(...inBloom(tree));
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: copy.receive.offline })
        .props.onPress();
    });
    await tap(tree, copy.receive.addNote);
    await enterAmount(tree, '1000');
    // The moon and its switch on, the note, the way on.
    seen.push(...inBloom(tree));
    await act(async () => {
      find(tree, copy.receive.continue)!.props.onPress();
    });
    // The orbit round the busy control.
    seen.push(...inBloom(tree));
    await act(async () => answer(quoteOf()));
    // The fee's moon and the create control.
    seen.push(...inBloom(tree));
    // The quote's expiry ring.
    expect(tree.root.findAllByType(ExpiryRing).length).toBeGreaterThan(0);
    await tap(tree, copy.receive.create);
    // The rocking moon of an offline request, and its code's expiry ring.
    expect(tree.root.findAllByType(ExpiryRing).length).toBeGreaterThan(0);
    seen.push(...inBloom(tree));
    await act(async () => tree.unmount());
    return seen;
  }

  test('draws every glyph, ring and primary control of Receive in slate, not bloom', async () => {
    // The same walk on mainnet draws each of them in bloom.
    const live = await drawn(false);
    expect(live.length).toBeGreaterThan(0);
    expect(await drawn(true)).toEqual([]);
  });

  test("links an old request back from a payment's detail in slate", async () => {
    const request = requestOf();
    const item: Activity = {
      id: `payment:${request.paymentHash}`,
      kind: 'request',
      title: 'Payment request',
      description: '',
      amountSats: 1000,
      feeSats: 0,
      status: 'pending',
      timestamp: Date.now(),
      reference: request.bolt11,
      paymentHash: request.paymentHash,
      receiveRequest: { ...request, legacy: true },
    };
    const client = {
      importReceiveRequest: jest.fn(),
    } as unknown as WalletAdapter;
    for (const test of [false, true]) {
      const tree = await mount(
        <ReceiveRequestDetails item={item} client={client} test={test} />,
      );
      await tap(tree, copy.receive.linkOriginal);
      await act(async () => {
        tree.root
          .findAll(
            node => node.props.onChangeText && node.type === TextInput,
          )[0]
          .props.onChangeText(request.uri);
      });
      expect(inBloom(tree).length > 0).toBe(!test);
      await act(async () => tree.unmount());
    }
  });

  test('bursts a paid request into slate petals', async () => {
    const completed: ReceiveStatus = {
      phase: 'completed',
      receivedSats: 1000,
      confirmedSats: 1000,
      pendingSats: 0,
      txids: [],
      method: 'lightning',
    };
    const client = clientOf({
      getReceiveStatus: jest.fn().mockResolvedValue(completed),
    });
    for (const test of [false, true]) {
      const tree = await screen(client, { test });
      await toRequest(tree);
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(meaning(tree)).toContain(copy.receive.received);
      expect(inBloom(tree).length > 0).toBe(!test);
      await act(async () => tree.unmount());
    }
  });
});
