import React, { useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
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
import { ReceiveReceipt } from '../../../components/ReceiveReceipt';
import { ReceiveRequestDetails } from '../../../components/ReceiveRequestDetails';
import { copy } from '../../../design/copy';
import { Glyph, HISTORY_GLYPH } from '../../../design/glyphs';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import { CopyChip, chipText } from '../../../glyphs/CopyChip';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { Odometer } from '../../../glyphs/Odometer';
import { BANDS, QR_CARD_GONE, QR_TIMING } from '../../../glyphs/QrBloom';
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
  visibleText,
} from '../../../../test-support/query';
import { CONTROL as SEND_CONTROL } from '../../send/Controls';
import { BANG, DrawnGlyph } from '../../send/DrawnGlyph';
import { Unplugged } from '../../send/LoopingGlyphs';
import { quietRing } from '../controls';
import { ReceiveHostContext, slotRoom } from '../host';
import { Spin } from '../loops';
import { CELEBRATION, requestFace } from '../model';
import { ReceiveScene } from '../ReceiveScene';
import { ACTIVITY, RequestStep } from '../RequestStep';

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

/** The glyphs drawn inside `node`. `Glyph` is a memo: its function is drawn. */
const glyphsIn = (node: ReactTestInstance) =>
  node.findAll(
    inside => inside.type === (Glyph as unknown as { type: unknown }).type,
  );

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

describe('the amount step', () => {
  const unmapped = () =>
    clientOf({
      quoteReceive: jest.fn(() =>
        Promise.reject(new Error('No route to the primary.')),
      ),
    });

  /** The nearest row round `node` that holds `other` too, if any. */
  const rowWith = (node: ReactTestInstance, other: ReactTestInstance) => {
    for (let at = node.parent; at; at = at.parent) {
      if (
        StyleSheet.flatten(at.props.style)?.flexDirection === 'row' &&
        at.findAll(inside => inside === other).length
      ) {
        return at;
      }
    }
    return null;
  };

  /** Whether `node` sits inside the step's scrolling entry. */
  const scrolls = (node: ReactTestInstance) => {
    for (let at = node.parent; at; at = at.parent) {
      if (at.props.testID === 'receive-entry') return true;
    }
    return false;
  };

  /** The step's pinned height, when it has one. */
  const pinnedHeight = (tree: ReactTestRenderer) => {
    const [entry] = tree.root.findAll(
      node => node.props.testID === 'receive-entry',
    );
    return entry
      ? StyleSheet.flatten(entry.parent!.props.style).height
      : undefined;
  };

  const keypad = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.keypad.label,
    )[0];

  test('keeps what was refused beside the way on, where it is always in view', async () => {
    // It sat under the control, where on a phone it fell past the bottom
    // edge (P7, row 18); Send has its refusal beside its control.
    const tree = await screen(unmapped());
    await toQuote(tree);
    const [pip] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'alert',
    );
    expect(rowWith(pip, find(tree, copy.receive.continue)!)).not.toBeNull();
    // A place a finger can hold to hear it whispered.
    expect(StyleSheet.flatten(pip.props.style)).toMatchObject({
      width: 48,
      height: 48,
    });
    await act(async () => tree.unmount());
  });

  test('is given the room its slot has inside its padding and clear of the bottom inset', () => {
    // A 402 by 874 phone: 62 on top, then the status row and the mini
    // strip, leave the slot 712; its padding and the 34 inset leave 618.
    expect(slotRoom(874 - 62 - 56 - 44, 34)).toBe(618);
    // A 375 by 667 phone with no bottom inset.
    expect(slotRoom(667 - 20 - 56 - 44, 0)).toBe(487);
    expect(slotRoom(40.5, 0)).toBe(0);
  });

  test('given room, pins the way on to the bottom of it and scrolls what is entered above', async () => {
    const tree = await mount(
      <ReceiveHostContext.Provider value={{ useBack: noop, room: 500 }}>
        <ReceiveScreen
          client={unmapped()}
          receivableSats={10_000}
          onActivity={noop}
          onBusy={noop}
        />
      </ReceiveHostContext.Provider>,
    );
    expect(pinnedHeight(tree)).toBe(500);
    expect(scrolls(keypad(tree))).toBe(true);
    expect(scrolls(find(tree, copy.receive.addNote)!)).toBe(true);
    expect(scrolls(find(tree, copy.receive.continue)!)).toBe(false);
    await toQuote(tree);
    // The quote has come back refused: the bang is pinned with the way on.
    const [pip] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'alert',
    );
    expect(scrolls(pip)).toBe(false);
    await act(async () => tree.unmount());
  });

  test('without room, as alone, takes the height it needs', async () => {
    const tree = await screen(clientOf());
    expect(pinnedHeight(tree)).toBeUndefined();
    expect(scrolls(keypad(tree))).toBe(false);
    await act(async () => tree.unmount());
  });

  test('in its scene, fits the slot the scene measures', async () => {
    function InScene() {
      const stage = useStageStore();
      const view = useCanvasView();
      return (
        <StageProvider value={stage}>
          <ReceiveScene
            sceneKey={1}
            client={clientOf()}
            snapshot={
              {
                wallet: { network: 'mainnet' },
                balance: { receivableSats: 10_000 },
              } as WalletSnapshot
            }
            session={
              { refresh: noop } as unknown as React.ComponentProps<
                typeof ReceiveScene
              >['session']
            }
            view={view}
            stale={false}
            backup={null}
            arrived={0}
          />
        </StageProvider>
      );
    }
    const tree = await mount(<InScene />);
    // Until it is measured, the step takes the height it needs.
    expect(pinnedHeight(tree)).toBeUndefined();
    const [slot] = tree.root.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === 'receive-slot',
    );
    await act(async () => {
      slot.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 712 } },
      });
    });
    expect(pinnedHeight(tree)).toBe(slotRoom(712, 0));
    await act(async () => tree.unmount());
  });

  test("a way on held back is a mocha disc in a husk ring with a dust glyph, as Send's is", async () => {
    // Espresso on roast, it all but vanished (P7, 20-receive-amount).
    const tree = await screen(clientOf(), { receivableSats: 0 });
    const way = find(tree, copy.receive.continue)!;
    expect(way.props.accessibilityState).toMatchObject({ disabled: true });
    expect(StyleSheet.flatten(way.props.style)).toMatchObject({
      backgroundColor: palette.mocha,
      borderColor: palette.husk,
      borderWidth: quietRing(SEND_CONTROL),
    });
    expect(quietRing(SEND_CONTROL)).toBe(4);
    expect(glyphsIn(way).map(glyph => glyph.props.color)).toEqual([
      palette.dust,
    ]);
    await act(async () => tree.unmount());
  });

  test('its cue is a place a finger can hold', async () => {
    const tree = await screen(clientOf(), { receivableSats: 0 });
    const [cue] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.amount.required,
    );
    expect(StyleSheet.flatten(cue.props.style)).toMatchObject({
      minWidth: 48,
      minHeight: 48,
    });
    await act(async () => tree.unmount());
  });
});

describe('the quote', () => {
  test("lines up its signs and its values in columns, as Send's review does", async () => {
    const tree = await screen(
      clientOf({
        quoteReceive: jest
          .fn()
          .mockResolvedValue(quoteOf({ feeSats: 0, netSats: 1000 })),
      }),
    );
    await toQuote(tree);
    const lines = [copy.receive.fee(0), copy.receive.net(1000)].map(
      label =>
        tree.root.findAll(
          node =>
            typeof node.type === 'string' &&
            node.props.accessibilityLabel === label,
        )[0],
    );
    // Each is text, not a thing to press.
    expect(lines.map(line => line.props.accessibilityRole)).toEqual([
      'text',
      'text',
    ]);
    // A glyph column, then a sign column, then the value, each line started
    // at the same edge.
    const columns = lines.map(line => {
      const [glyph, sign] = line.children as ReactTestInstance[];
      return [
        StyleSheet.flatten(glyph.props.style).width,
        StyleSheet.flatten(sign.props.style).minWidth,
      ];
    });
    expect(columns).toEqual([
      [24, 16],
      [24, 16],
    ]);
    await act(async () => tree.unmount());
  });

  test('holds each warning in a place a finger can hold', async () => {
    const WARNING = 'The primary charges more than usual.';
    const tree = await screen(
      clientOf({
        quoteReceive: jest
          .fn()
          .mockResolvedValue(quoteOf({ warnings: [WARNING] })),
      }),
    );
    await toQuote(tree);
    const [pip] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === WARNING,
    );
    expect(StyleSheet.flatten(pip.props.style)).toMatchObject({
      width: 48,
      height: 48,
    });
    await act(async () => tree.unmount());
  });
});

describe('a copy chip', () => {
  test("keeps a URI's scheme and an address's or invoice's prefix whole, and groups what follows", () => {
    // Grouped from the first character, a request read "bitc oin: …" and an
    // invoice "lnbc rt30 …" (P10, 22-t4-detail and 23b).
    const address = `bcrt1qy3${'q'.repeat(30)}kw5jn9u6`;
    const invoice = `lnbcrt30u1p4td83kp${'x'.repeat(40)}qpw5f2ku`;
    expect(
      chipText(`bitcoin:${address}?amount=0.0005&lightning=${invoice}`),
    ).toBe('bitcoin: bcrt1 qy3q … qpw5 f2ku');
    expect(chipText(invoice)).toBe('lnbcrt30u1 p4td … qpw5 f2ku');
    expect(chipText(`lightning:${invoice}`)).toBe(
      'lightning: lnbcrt30u1 p4td … qpw5 f2ku',
    );
    expect(chipText(address)).toBe('bcrt1 qy3q … kw5j n9u6');
    expect(chipText('lno1qcp4256ypq')).toBe('lno1 qcp4 256y pq');
    // Whole, the prefix still stands apart and the rest is in fours.
    expect(
      chipText(invoice, true).startsWith('lnbcrt30u1 p4td 83kp xxxx'),
    ).toBe(true);
    // A hash, a legacy address, or hex that happens to hold a 1, has no
    // prefix: it is grouped from its first character as before.
    const hash = 'ab1c'.repeat(16);
    expect(chipText(hash)).toBe('ab1c ab1c … ab1c ab1c');
    expect(chipText('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(
      '1Boa tSLR … 3LET tpyT',
    );
  });

  test('is a mocha pill round its value and glyph, not a bar across its row', async () => {
    // The detail's chip ran the width of the card, its value packed at the
    // left (P7, 59-detail).
    const tree = await mount(
      <CopyChip label={copy.receive.transaction} value={'ab'.repeat(32)} />,
    );
    const chip = find(tree, copy.receive.copyValue(copy.receive.transaction))!;
    const style = StyleSheet.flatten(
      typeof chip.props.style === 'function'
        ? chip.props.style({ pressed: false })
        : chip.props.style,
    );
    expect(style).toMatchObject({
      backgroundColor: palette.mocha,
      minHeight: 48,
      borderRadius: 24,
    });
    expect(StyleSheet.flatten(chip.parent!.props.style)).toMatchObject({
      alignSelf: 'center',
    });
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
    const tree = await mount(
      <ReceiveRequestDetails item={detailOf(request)} />,
    );
    const shown = texts(tree).find(
      node => node.props.children === chipText(request.uri),
    )!;
    expect(StyleSheet.flatten(shown.props.style)).toMatchObject({
      fontSize: 12,
      lineHeight: 18,
    });
    expect(shown.props.maxFontSizeMultiplier).toBe(1.4);
    await act(async () => tree.unmount());
  });
});

/** A request as a payment's detail keeps it. */
function detailOf(
  request: ReceiveRequest,
  over: Partial<Activity> = {},
): Activity {
  return {
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
    ...over,
  };
}

describe("the request a payment's detail keeps", () => {
  /** A unified request, as long as the ones a Pixel drew as a wall of text. */
  const LONG = requestOf({
    uri: `bitcoin:bcrt1qpg0xyjz3p06mkjy8mju437lezq57ad90yq0hq3?amount=0.0006&lightning=lnbcrt600u1p4td83kpp5${'vhpaguzscqxf6mds'.repeat(
      20,
    )}`,
  });
  const chipOf = (tree: ReactTestRenderer) => tree.root.findByType(CopyChip);

  test('is a chip, shortened in the middle, that copies the whole request', async () => {
    const tree = await mount(<ReceiveRequestDetails item={detailOf(LONG)} />);
    expect(chipOf(tree).props).toMatchObject({
      label: copy.receive.original,
      value: LONG.uri,
      glyph: 'qr',
      copyable: true,
    });
    // Never the whole string at once: the chip's two ends, in fours.
    const drawn = visibleText(tree);
    expect(drawn).not.toContain(LONG.uri);
    expect(drawn).toContain(chipText(LONG.uri));
    // The scheme and the address's prefix whole, a group, and two at the end.
    expect(chipText(LONG.uri)).toBe('bitcoin: bcrt1 qpg0 … cqxf 6mds');
    // A tap copies all of it, and there is no second control that does.
    const label = copy.receive.copyValue(copy.receive.original);
    const copiers = tree.root.findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        /^Copy/.test(node.props.accessibilityLabel ?? ''),
    );
    expect(copiers.map(node => node.props.accessibilityLabel)).toEqual([label]);
    await act(async () => find(tree, label)!.props.onPress());
    expect(Clipboard.setString).toHaveBeenCalledWith(LONG.uri);
    // A long press shows it whole.
    await act(async () => find(tree, label)!.props.onLongPress());
    expect(visibleText(tree)).toContain(chipText(LONG.uri, true));
    await act(async () => tree.unmount());
  });

  test('keeps the request that can no longer be paid as a record, which does not copy', async () => {
    jest.mocked(Clipboard.setString).mockClear();
    const expired = requestOf({ ...LONG, expiresAt: Date.now() - MINUTE });
    const tree = await mount(
      <ReceiveRequestDetails item={detailOf(expired, { status: 'expired' })} />,
    );
    expect(chipOf(tree).props.copyable).toBe(false);
    // Named for a screen reader as before, with the whole request as its
    // value, and nothing to press.
    const record = tree.root.findAll(
      node =>
        node.props.accessibilityLabel === copy.receive.original &&
        typeof node.props.onLongPress === 'function',
    );
    expect(record).toHaveLength(1);
    expect(record[0].props.accessibilityValue).toEqual({ text: expired.uri });
    expect(record[0].props.accessibilityRole).toBe('text');
    expect(record[0].props.onPress).toBeUndefined();
    expect(
      find(tree, copy.receive.copyValue(copy.receive.original)),
    ).toBeUndefined();
    const [shown] = tree.root.findAll(
      node =>
        node.type === Text && node.props.children === chipText(expired.uri),
    );
    expect(StyleSheet.flatten(shown.props.style).color).toBe(palette.steam);
    expect(Clipboard.setString).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('names an old Lightning invoice as one, with the bolt', async () => {
    const tree = await mount(
      <ReceiveRequestDetails
        item={detailOf({ ...LONG, legacy: true } as ReceiveRequest)}
      />,
    );
    expect(chipOf(tree).props).toMatchObject({
      label: copy.receive.legacyInvoice,
      glyph: 'bolt',
    });
    await act(async () => tree.unmount());
  });
});

describe('the celebration', () => {
  const paid: ReceiveStatus = {
    phase: 'completed',
    receivedSats: 1000,
    confirmedSats: 1000,
    pendingSats: 0,
    txids: [],
    method: 'lightning',
  };

  test("draws no dark track across the code before the code's card has gone", async () => {
    // The husk track cut across the cream card for 200ms (P7, 50-c3 t5.37).
    // The card goes once the bands have set off and it has faded.
    expect(QR_CARD_GONE).toBe(QR_TIMING.step * BANDS + QR_TIMING.dissolve);
    expect(CELEBRATION.track.delay).toBeGreaterThanOrEqual(QR_CARD_GONE);
    const opacity = async (celebrate: boolean) => {
      const tree = await mount(
        <ReceiveReceipt
          status={paid}
          amountSats={1000}
          celebrate={celebrate}
        />,
      );
      const [track] = tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'receipt-track',
      );
      const shown = StyleSheet.flatten(track.props.style).opacity;
      await act(async () => tree.unmount());
      return shown;
    };
    expect(await opacity(true)).toBe(0);
    // A still receipt, as a payment's detail keeps it, has its track.
    expect(await opacity(false)).toBe(1);
  });

  test('offers the list with a glyph that does not say money is still moving', async () => {
    const request = requestOf();
    const tree = await mount(
      <RequestStep
        request={request}
        createdAt={Date.now()}
        face={requestFace({
          request,
          now: Date.now(),
          paid: true,
          ambiguous: false,
          createdAt: Date.now(),
        })}
        minutesLeft={10}
        receipt={paid}
        hidden={false}
        unit="sats"
        qr={264}
        error={null}
        onLift={noop}
        onCopy={noop}
        copies={0}
        onShare={noop}
        onAgain={noop}
        onActivity={noop}
        focus={{ current: null }}
      />,
    );
    const glyphs = glyphsIn(find(tree, copy.receive.viewActivity)!).map(
      glyph => glyph.props.name,
    );
    // The orbit is money in flight (REDESIGN.md 6); under a done mark it
    // read as still on its way (P7, 51-c3-received).
    expect(glyphs).toEqual([ACTIVITY]);
    expect(ACTIVITY).not.toBe('orbit');
    // The history's glyph, as Send's results draw it.
    expect(ACTIVITY).toBe(HISTORY_GLYPH);
    await act(async () => tree.unmount());
  });

  test('counts what arrived up over 700ms, and a still receipt rolls as any amount does', async () => {
    const completed: ReceiveStatus = {
      phase: 'completed',
      receivedSats: 1000,
      confirmedSats: 1000,
      pendingSats: 0,
      txids: [],
      method: 'lightning',
    };
    const durations = async (celebrate: boolean) => {
      const tree = await mount(
        <ReceiveReceipt
          status={completed}
          amountSats={1000}
          celebrate={celebrate}
        />,
      );
      const found = tree.root
        .findAllByType(Odometer)
        .filter(odometer => odometer.props.sign === '+')
        .map(odometer => odometer.props.duration);
      await act(async () => tree.unmount());
      return found;
    };
    // REDESIGN.md 5, Received celebration: the amount counts up (700ms).
    expect(CELEBRATION.count.duration).toBe(700);
    expect(await durations(true)).toEqual([CELEBRATION.count.duration]);
    expect(await durations(false)).toEqual([undefined]);
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
