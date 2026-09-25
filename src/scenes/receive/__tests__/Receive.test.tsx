import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type {
  ReceiveQuote,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { Glyph } from '../../../design/glyphs';
import { haptics } from '../../../design/haptics';
import { palette } from '../../../design/palette';
import * as tokens from '../../../motion/tokens';
import { ReceiveScreen } from '../../../screens/Receive';
import type { WalletAdapter } from '../../../services/wallet';
import { mount } from '../../../../test-support/guard';
import { enterAmount } from '../../../../test-support/keypad';
import { alerts, find } from '../../../../test-support/query';
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

  /** The bangs drawn, and the unplugs with their colours. */
  const marks = (tree: ReactTestRenderer) => ({
    bangs: drawn(tree, Glyph).filter(glyph => glyph.props.name === 'bang')
      .length,
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
    await act(async () => tree.unmount());
  });
});
