import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type {
  Activity,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import { holdRequest } from '../../../stage/heldRequests';
import { ScanReveal } from '../../../stage/layers/ScanReveal';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { activityOf, hex } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { activate, field, find, press } from '../../../../test-support/query';

/**
 * Send on the canvas (REDESIGN.md 2.3 and 6): a scan it starts comes back to
 * it, Android back steps out of its review first, a payment that completed
 * goes home on its own, and a held one opens the payment it waits on.
 */
const SCANNED = 'lnbcrt1scanned';

let stage!: StageStore;
let snapshot: WalletSnapshot;
/** The history the canvas is drawn with, when a test sets one. */
let history: Activity[] | null = null;
const client = new DemoWalletClient();
const quote: SendReview = {
  id: 'review-scene',
  destination: 'recipient',
  description: '',
  amountSats: 4200,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  totalSats: 4220,
  route: 'lightning',
  expiresAt: Date.now() + 600_000,
  warnings: [],
};

beforeAll(async () => {
  snapshot = await client.snapshot();
});

function OnCanvas() {
  stage = useStageStore();
  const view = useCanvasView();
  return (
    <GestureHandlerRootView>
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={client}
          snapshot={history ? { ...snapshot, activity: history } : snapshot}
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

const request = (tree: ReactTestRenderer) =>
  field(tree, copy.send.request).props.value;

const back = () => newestFirst(stage.responders.sceneBack).some(ask => ask());

async function openSend() {
  const tree = await mount(<OnCanvas />);
  await act(async () => stage.actions.openSend());
  return tree;
}

afterEach(() => {
  jest.restoreAllMocks();
  history = null;
});

test('a scan Send starts brings its code back to the same Send', async () => {
  const tree = await openSend();
  const key = stage.state.scene.key;
  await press(tree, copy.send.scan);
  expect(stage.state.overlay).toMatchObject({ name: 'scan', target: 'send' });
  await act(async () => {
    tree.root.findByType(ScanReveal).props.onDetected(SCANNED);
  });
  expect(stage.state.overlay).toBeNull();
  expect(stage.state.scene).toMatchObject({ name: 'send', key });
  expect(request(tree)).toBe(SCANNED);
  await act(async () => tree.unmount());
});

test('a cancelled scan leaves the request as it was, and asks for no more codes', async () => {
  const tree = await openSend();
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText('lnbc-typed');
  });
  await press(tree, copy.send.scan);
  await act(async () => {
    tree.root.findByType(ScanReveal).props.onCancel();
  });
  expect(stage.state.overlay).toBeNull();
  expect(request(tree)).toBe('lnbc-typed');
  // A scan this Send did not start fills nothing in.
  await act(async () => stage.actions.openScan());
  await act(async () => {
    tree.root.findByType(ScanReveal).props.onDetected(SCANNED);
  });
  expect(request(tree)).toBe('lnbc-typed');
  await act(async () => tree.unmount());
});

test('back steps from the review to compose before Send closes', async () => {
  jest.spyOn(client, 'prepareSend').mockResolvedValue(quote);
  const tree = await openSend();
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText('lnbc-review');
  });
  await press(tree, copy.send.review);
  expect(find(tree, copy.send.edit)).toBeDefined();
  let took = false;
  await act(async () => {
    took = back();
  });
  expect(took).toBe(true);
  expect(stage.state.scene.name).toBe('send');
  expect(find(tree, copy.send.review)).toBeDefined();
  // Nothing of its own is left to step back from.
  expect(back()).toBe(false);
  await act(async () => tree.unmount());
});

test('a completed payment goes home on its own', async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(client, 'prepareSend').mockResolvedValue(quote);
    jest.spyOn(client, 'send').mockResolvedValue({
      id: 'p-scene',
      status: 'completed',
      amountSats: 4200,
      feeSats: 20,
      message: 'Payment sent.',
    });
    const tree = await openSend();
    await act(async () => {
      field(tree, copy.send.request).props.onChangeText('lnbc-home');
    });
    await press(tree, copy.send.review);
    await activate(tree, copy.send.sendSats(4200));
    expect(stage.state.scene.name).toBe('send');
    await act(async () => jest.advanceTimersByTime(2200));
    expect(stage.state.scene.name).toBe('home');
    await act(async () => tree.unmount());
  } finally {
    jest.useRealTimers();
  }
});

test('an unknown outcome holds honey on the ground, and a failure flashes radish', async () => {
  jest.spyOn(client, 'prepareSend').mockResolvedValue(quote);
  const send = jest.spyOn(client, 'send').mockResolvedValue({
    id: 'p-unknown',
    status: 'uncertain',
    amountSats: 4200,
    feeSats: 20,
    message: 'The node stopped answering.',
  });
  const tree = await openSend();
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText('lnbc-tint-unknown');
  });
  await press(tree, copy.send.review);
  expect(stage.tint.read().held).toBeNull();
  await activate(tree, copy.send.sendSats(4200));
  expect(stage.tint.read().held).toBe('honey');
  // Leaving the outcome lets the ground go; the wallet's own read of the
  // payment holds honey from then on.
  await act(async () => stage.actions.back());
  expect(stage.tint.read().held).toBeNull();

  send.mockResolvedValue({
    id: 'p-failed',
    status: 'failed',
    amountSats: 4200,
    feeSats: 0,
    message: 'No route.',
  });
  await act(async () => stage.actions.openSend());
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText('lnbc-tint-failed');
  });
  await press(tree, copy.send.review);
  const before = stage.tint.read().flash?.key ?? 0;
  await activate(tree, copy.send.sendSats(4200));
  expect(stage.tint.read().flash).toEqual({ tint: 'radish', key: before + 1 });
  expect(stage.tint.read().held).toBeNull();
  await act(async () => tree.unmount());
});

test('a held payment opens its detail by way of Activity, which back returns to', async () => {
  const txid = hex(77);
  const payment = activityOf('sent', 'uncertain', { rail: 'chain', txid });
  history = [payment];
  holdRequest('lnbc-scene-held', { status: 'uncertain', txid });
  const tree = await mount(<OnCanvas />);
  await act(async () => stage.actions.openSend('lnbc-scene-held'));
  await press(tree, copy.send.unknown);
  expect(stage.state.scene).toMatchObject({
    name: 'detail',
    item: { id: payment.id },
  });
  expect(stage.state.stack.map(scene => scene.name)).toEqual([
    'home',
    'activity',
  ]);
  await act(async () => stage.actions.back());
  expect(stage.state.scene.name).toBe('activity');
  await act(async () => tree.unmount());
});
