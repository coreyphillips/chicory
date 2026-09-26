import React from 'react';
import { Text, View } from 'react-native';
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
import { Odometer } from '../../../glyphs/Odometer';
import { durations } from '../../../motion/tokens';
import { SendScreen } from '../../../screens/Send';
import { isTestNetwork } from '../../home/visual';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import type { CanvasView } from '../../../stage/Canvas';
import { clearHeldRequests, holdRequest } from '../../../stage/heldRequests';
import { ScanReveal } from '../../../stage/layers/ScanReveal';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { activityOf, hex } from '../../../../test-support/fixtures';
import { SEND_GRACE_MS } from '../model';
import { mount } from '../../../../test-support/guard';
import { activate, field, find, press } from '../../../../test-support/query';
import { MASK } from '../../../theme';

/**
 * Send on the canvas (REDESIGN.md 2.3 and 6): a scan it starts comes back to
 * it, Android back steps out of its review first, a payment that completed
 * goes home on its own, and a held one opens the payment it waits on.
 */
const SCANNED = 'lnbcrt1scanned';

/** A request the parser reads that fixes the 4,200 sats paid here. */
const priced = (label: string) =>
  `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.000042&label=${label}`;

/**
 * A request for the same 4,200 sats to another address. A label does not
 * make another request: the held set knows a Bitcoin request by its address
 * and amount.
 */
const pricedElsewhere = (label: string) =>
  `bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.000042&label=${label}`;

let stage!: StageStore;
let view!: CanvasView;
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
  view = useCanvasView();
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

// The held set lives as long as the process, so each test starts with nothing
// held, and a request one test held never holds another test's.
beforeEach(() => clearHeldRequests());
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

test("Send's scan grows from its own button, measured as it is pressed", async () => {
  const tree = await openSend();
  const button = find(tree, copy.send.scan)!;
  // The view around the button, whose place in the window the reveal takes.
  let well = button.parent;
  while (well && !(well.type === View && well.props.collapsable === false)) {
    well = well.parent;
  }
  jest
    .mocked(well!.instance.measureInWindow)
    .mockImplementationOnce(
      (done: (x: number, y: number, w: number, h: number) => void) =>
        done(300, 158, 44, 44),
    );
  await press(tree, copy.send.scan);
  expect(stage.state.overlay).toMatchObject({
    name: 'scan',
    target: 'send',
    origin: { x: 322, y: 180 },
  });
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
    field(tree, copy.send.request).props.onChangeText(priced('review'));
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
      field(tree, copy.send.request).props.onChangeText(priced('home'));
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

test('amounts follow the balance, hidden and in its unit, except on a review', async () => {
  jest.spyOn(client, 'prepareSend').mockResolvedValue(quote);
  jest.spyOn(client, 'send').mockResolvedValue({
    id: 'p-masked',
    status: 'completed',
    amountSats: 4200,
    feeSats: 20,
    message: 'Payment sent.',
  });
  const tree = await openSend();
  await act(async () => {
    view.setHidden(true);
    view.setUnit('btc');
  });
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText(priced('masked'));
  });
  await press(tree, copy.send.review);
  // Send's own, not the balance's in the mini strip.
  const send = () => tree.root.findByType(SendScreen);
  const amount = () => send().findByType(Odometer).props;
  const drawn = () =>
    send()
      .findAllByType(Text)
      .map(text => [text.props.children].flat().join(''));
  const labels = () =>
    send()
      .findAll(node => typeof node.props.accessibilityLabel === 'string')
      .map(node => node.props.accessibilityLabel);
  // A review is where the payment is checked, so it is never hidden.
  expect(amount()).toMatchObject({ sats: 4200, unit: 'btc', masked: false });
  expect(drawn()).toContain('0.0000422 BTC');
  expect(labels()).toContain(copy.amount.spoken(4200));
  await activate(tree, copy.send.sendSats(4200));
  expect(amount()).toMatchObject({ sats: 4200, unit: 'btc', masked: true });
  expect(labels()).toContain(copy.amount.hidden);
  expect(labels()).not.toContain(copy.amount.spoken(4200));
  expect(drawn()).toContain(MASK);
  expect(drawn()).not.toContain('0.0000002 BTC');
  // A screen reader still hears the fee paid, in sats.
  const [fee] = send().findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityLabel === copy.send.feePaid,
  );
  expect(fee.props.accessibilityValue.text).toBe(copy.amount.spoken(20));
  await act(async () => tree.unmount());
});

test("draws in slate on a test network, as the wallet's network says", async () => {
  const tree = await openSend();
  const drawn = () => tree.root.findByType(SendScreen).props.test;
  expect(drawn()).toBe(isTestNetwork(snapshot.wallet.network));
  await act(async () => tree.unmount());
  const network = snapshot.wallet.network;
  for (const each of ['mainnet', 'regtest']) {
    snapshot.wallet.network = each as typeof network;
    const again = await openSend();
    expect(again.root.findByType(SendScreen).props.test).toBe(
      each !== 'mainnet',
    );
    await act(async () => again.unmount());
  }
  snapshot.wallet.network = network;
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
    field(tree, copy.send.request).props.onChangeText(priced('tint-unknown'));
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
    field(tree, copy.send.request).props.onChangeText(
      pricedElsewhere('tint-failed'),
    );
  });
  await press(tree, copy.send.review);
  const before = stage.tint.read().flash?.key ?? 0;
  await activate(tree, copy.send.sendSats(4200));
  expect(stage.tint.read().flash).toEqual({ tint: 'radish', key: before + 1 });
  expect(stage.tint.read().held).toBeNull();
  await act(async () => tree.unmount());
});

test('a payment that does not answer lets the stage go after its grace, and its request comes back held', async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(client, 'prepareSend').mockResolvedValue(quote);
    jest.spyOn(client, 'send').mockReturnValue(new Promise(() => {}));
    const hung =
      'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.000042&label=scene-hung';
    const other =
      'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00001&label=scene-other';
    const tree = await mount(<OnCanvas />);
    await act(async () => stage.actions.openSend(hung));
    await press(tree, copy.send.review);
    await activate(tree, copy.send.sendSats(4200));
    const key = stage.state.scene.key;
    expect(stage.state.busy).toBe(true);
    // A link that lands mid-payment is dropped, and Close does nothing.
    await act(async () => stage.dispatch({ type: 'link', request: other }));
    await act(async () => stage.actions.home());
    expect(stage.state.scene).toMatchObject({ name: 'send', key });
    await act(async () => jest.advanceTimersByTime(SEND_GRACE_MS));
    // The payment is still out: the held ring, honey on the ground, and the
    // way out free.
    const heldRing = () =>
      tree.root
        .findByType(SendScreen)
        .findAll(
          node =>
            typeof node.type === 'string' &&
            node.props.accessibilityLabel === copy.send.onItsWay,
        );
    expect(stage.state.busy).toBe(false);
    expect(stage.tint.read().held).toBe('honey');
    expect(heldRing()).not.toEqual([]);
    await act(async () => stage.actions.home());
    expect(stage.state.scene.name).toBe('home');
    // The Send that went fades out where it was, and is let go.
    await act(async () => jest.advanceTimersByTime(durations.exit));
    // Brought back by a link, the same request lands on its held ring.
    await act(async () => stage.dispatch({ type: 'link', request: hung }));
    expect(stage.state.scene).toMatchObject({ name: 'send', prefill: hung });
    expect(heldRing()).not.toEqual([]);
    expect(find(tree, copy.send.review)).toBeUndefined();
    await act(async () => tree.unmount());
  } finally {
    jest.useRealTimers();
  }
});

test('a held payment opens its detail by way of Activity, which back returns to', async () => {
  const txid = hex(77);
  const payment = activityOf('sent', 'uncertain', { rail: 'chain', txid });
  history = [payment];
  // A request the parser reads, so it is taken as a chip and can be held.
  const held = 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?label=held';
  holdRequest(held, { status: 'uncertain', txid });
  const tree = await mount(<OnCanvas />);
  await act(async () => stage.actions.openSend(held));
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
