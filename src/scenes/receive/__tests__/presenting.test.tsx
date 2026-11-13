import React from 'react';
import { AppState, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type {
  ReceiveQuote,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { ReceiveScreen } from '../../../screens/Receive';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import { setTapPresenter } from '../../../services/tapPresenter';
import type { WalletAdapter } from '../../../services/wallet';
import { Pane } from '../../../stage/panes/Pane';
import { mount } from '../../../../test-support/guard';
import { enterAmount } from '../../../../test-support/keypad';
import { find } from '../../../../test-support/query';
import { fakeTapPresenter } from '../../../../test-support/tap';
import type { FakeTapPresenter } from '../../../../test-support/tap';
import { PRESENT_CHECK_MS } from '../presenting';

/**
 * Receive presents its request over NFC on Android, so a phone held to this
 * one reads it (docs/TAP-TO-PAY.md). The tag follows the code: it is there
 * for exactly as long as the request can be shared and Receive is in front,
 * and it says what the code says. These drive the screen as a person would,
 * over a stand-in for the phone.
 */

const MINUTE = 60_000;
const noop = () => {};

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
const completed: ReceiveStatus = {
  phase: 'completed',
  receivedSats: 1000,
  confirmedSats: 1000,
  pendingSats: 0,
  txids: [],
  method: 'lightning',
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

const receive = (client: WalletAdapter, live = true) => (
  <Pane active={live}>
    <ReceiveScreen
      client={client}
      receivableSats={10_000}
      onActivity={noop}
      onBusy={noop}
    />
  </Pane>
);

const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => {
    await find(tree, label)!.props.onPress();
  });

async function toRequest(tree: ReactTestRenderer) {
  await enterAmount(tree, '1000');
  await press(tree, copy.receive.continue);
  await press(tree, copy.receive.create);
}

const past = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** The app leaves the front, or comes back to it. */
async function appGoes(state: 'background' | 'active') {
  const changed = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([event]) => event === 'change')
    .map(([, handler]) => handler);
  await act(async () => changed.forEach(handler => handler(state)));
}

/** The tap mark, drawn and reachable, by what it says. */
const mark = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  )[0];
const marks = (tree: ReactTestRenderer) =>
  [copy.receive.tapPresenting, copy.receive.tapOff].filter(label =>
    mark(tree, label),
  );

const URI = requestOf().uri;
let phone: FakeTapPresenter;

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockClear();
  jest.replaceProperty(Platform, 'OS', 'android');
  phone = fakeTapPresenter();
  setTapPresenter(phone);
  clearDiagnostics();
});
afterEach(() => {
  setTapPresenter(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('a request on screen', () => {
  test('is presented as its code says it, until it expires, and the mark says so', async () => {
    const request = requestOf();
    const tree = await mount(
      receive(clientOf({ receive: jest.fn().mockResolvedValue(request) })),
    );
    // Nothing is asked of the phone, let alone presented, before a request.
    await enterAmount(tree, '1000');
    await press(tree, copy.receive.continue);
    expect(phone.asked).toMatchObject({ status: 0, present: 0 });
    expect(marks(tree)).toEqual([]);

    await press(tree, copy.receive.create);
    expect(phone.presented).toEqual({
      request: request.uri,
      expiresAt: request.expiresAt,
    });
    // Heard and whispered, in a place a finger can hold. Nothing is drawn of
    // it but the glyph.
    const drawn = mark(tree, copy.receive.tapPresenting);
    expect(drawn.props.accessibilityRole).toBe('image');
    expect(drawn.props.onPress).toBeUndefined();
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    await act(async () => tree.unmount());
  });

  test('is still presented while its code is lifted, and copies and shares as before', async () => {
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    const copied = jest.spyOn(Clipboard, 'setString');
    await press(tree, copy.receive.copy);
    expect(copied).toHaveBeenCalledWith(URI);
    await press(tree, copy.receive.qr);
    expect(phone.presented?.request).toBe(URI);
    await press(tree, copy.receive.closeQr);
    expect(phone.log).toEqual([URI]);
    await act(async () => tree.unmount());
  });

  test('that is a bare invoice is handed over as it is, for the seam to give its scheme', async () => {
    const bare = requestOf({
      uri: 'lnbcrt1invoice',
      address: undefined,
      bitcoinTracking: 'lightning-only',
    });
    const tree = await mount(
      receive(clientOf({ receive: jest.fn().mockResolvedValue(bare) })),
    );
    await toRequest(tree);
    expect(phone.presented?.request).toBe('lnbcrt1invoice');
    await act(async () => tree.unmount());
  });
});

describe('the tag is withdrawn', () => {
  test('the moment the request is paid', async () => {
    const status = jest.fn().mockResolvedValue(waiting);
    const tree = await mount(receive(clientOf({ getReceiveStatus: status })));
    await toRequest(tree);
    expect(phone.presented).not.toBeNull();
    status.mockResolvedValue(completed);
    await past(2_000);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    // And nothing presents it again.
    await past(5 * PRESENT_CHECK_MS);
    expect(phone.log).toEqual([URI, 'withdrawn']);
    await act(async () => tree.unmount());
  });

  test('as the request runs out', async () => {
    const soon = requestOf({ expiresAt: Date.now() + 5_000 });
    const tree = await mount(
      receive(clientOf({ receive: jest.fn().mockResolvedValue(soon) })),
    );
    await toRequest(tree);
    expect(phone.presented).toEqual({
      request: soon.uri,
      expiresAt: soon.expiresAt,
    });
    await past(4_000);
    expect(phone.presented).not.toBeNull();
    await past(2_000);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test('as its address turns out to be reused', async () => {
    const status = jest.fn().mockResolvedValue(waiting);
    const tree = await mount(receive(clientOf({ getReceiveStatus: status })));
    await toRequest(tree);
    expect(phone.presented).not.toBeNull();
    status.mockRejectedValue(
      Object.assign(new Error('Reused.'), {
        code: 'AMBIGUOUS_RECEIVE_ADDRESS',
      }),
    );
    await past(2_000);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test('as plus replaces the request, and the next one is presented in its place', async () => {
    const second = requestOf({
      id: 'r2',
      uri: 'bitcoin:bcrt1other?lightning=lnbcrt1second',
    });
    const made = jest
      .fn()
      .mockResolvedValueOnce(requestOf())
      .mockResolvedValue(second);
    const tree = await mount(receive(clientOf({ receive: made })));
    await toRequest(tree);
    await press(tree, copy.receive.createAnother);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    await toRequest(tree);
    expect(phone.presented?.request).toBe(second.uri);
    // The old one went before the new one came, and never came back.
    expect(phone.log).toEqual([URI, 'withdrawn', second.uri]);
    await act(async () => tree.unmount());
  });

  test('as Receive is closed', async () => {
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    await act(async () => tree.unmount());
    expect(phone.presented).toBeNull();
    expect(phone.log).toEqual([URI, 'withdrawn']);
  });

  test('while Receive is not the pane in use, and presented again when it is', async () => {
    const client = clientOf();
    const tree = await mount(receive(client));
    await toRequest(tree);
    await act(async () => tree.update(receive(client, false)));
    expect(phone.presented).toBeNull();
    await act(async () => tree.update(receive(client)));
    expect(phone.presented?.request).toBe(URI);
    await act(async () => tree.unmount());
  });

  test('as the app leaves the front, and presented again as it comes back', async () => {
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    await appGoes('background');
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    // Nothing is asked of the phone from the background.
    const asked = phone.asked.status;
    await past(5 * PRESENT_CHECK_MS);
    expect(phone.asked.status).toBe(asked);
    await appGoes('active');
    expect(phone.presented?.request).toBe(URI);
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    await act(async () => tree.unmount());
  });

  test('and presented again after a pause too brief to be drawn', async () => {
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.asked.present).toBe(1);
    // The phone withdraws by itself as the app leaves the front, and the app
    // is back before anything was drawn of its leaving.
    Object.assign(phone, { presented: null });
    const changed = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, handler]) => handler);
    await act(async () => {
      changed.forEach(handler => handler('background'));
      changed.forEach(handler => handler('active'));
    });
    expect(phone.asked.present).toBe(2);
    expect(phone.presented?.request).toBe(URI);
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    await act(async () => tree.unmount());
  });
});

describe('a phone with NFC switched off', () => {
  test('presents nothing, and its mark is the way to switch NFC on', async () => {
    phone.answer = 'off';
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.asked.present).toBe(0);
    expect(marks(tree)).toEqual([copy.receive.tapOff]);
    const off = find(tree, copy.receive.tapOff)!;
    expect(off.props.accessibilityRole).toBe('button');
    expect(off.props.accessibilityHint).toBe(copy.receive.tapOffHint);
    const tick = jest.spyOn(haptics, 'tick');
    await press(tree, copy.receive.tapOff);
    expect(phone.asked.settings).toBe(1);
    expect(tick).toHaveBeenCalledTimes(1);

    // Back from the settings with it on: the request is presented.
    await appGoes('background');
    phone.answer = 'ready';
    await appGoes('active');
    expect(phone.presented?.request).toBe(URI);
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    await act(async () => tree.unmount());
  });

  test('switched off under a presented request, stops saying it is presented', async () => {
    // From the shade, which never takes the app from the front.
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    phone.answer = 'off';
    await past(PRESENT_CHECK_MS);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([copy.receive.tapOff]);
    // And switched on again the same way, it is presented again.
    phone.answer = 'ready';
    await past(PRESENT_CHECK_MS);
    expect(phone.presented?.request).toBe(URI);
    expect(marks(tree)).toEqual([copy.receive.tapPresenting]);
    await act(async () => tree.unmount());
  });
});

describe('a phone that cannot act as a tag', () => {
  test('draws no mark and is asked to present nothing', async () => {
    phone.answer = 'missing';
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.asked.present).toBe(0);
    expect(marks(tree)).toEqual([]);
    // Share and copy are where they were.
    expect(find(tree, copy.receive.share)).toBeDefined();
    expect(find(tree, copy.receive.copy)).toBeDefined();
    await act(async () => tree.unmount());
  });

  test('that refuses the request draws no mark for it, and the log keeps why and nothing of the request', async () => {
    phone.refuses = 'TAP_REFUSED';
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.asked.present).toBe(1);
    expect(phone.presented).toBeNull();
    expect(marks(tree)).toEqual([]);
    const logged = recentDiagnostics().filter(
      entry => entry.code === 'TAP_REFUSED',
    );
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toBe(copy.receive.tapNotPresented);
    expect(JSON.stringify(recentDiagnostics())).not.toContain('lnbcrt1invoice');
    // It is not asked again every time the phone is asked how its NFC is.
    await past(5 * PRESENT_CHECK_MS);
    expect(phone.asked.present).toBe(1);
    await act(async () => tree.unmount());
  });

  test('a request presented logs nothing', async () => {
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.presented).not.toBeNull();
    expect(
      recentDiagnostics().filter(entry => entry.code?.startsWith('TAP_')),
    ).toEqual([]);
    await act(async () => tree.unmount());
  });

  test('with no presenter at all, as on every iPhone and under Jest, nothing is asked or drawn', async () => {
    setTapPresenter(null);
    const tree = await mount(receive(clientOf()));
    await toRequest(tree);
    expect(phone.asked).toEqual({
      status: 0,
      present: 0,
      withdraw: 0,
      settings: 0,
    });
    expect(marks(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });
});
