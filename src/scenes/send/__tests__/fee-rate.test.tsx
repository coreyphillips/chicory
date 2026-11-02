import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import type { FeeRates, SendResult, SendReview } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { forgetPendingHaptics } from '../../../design/haptics';
import { SendScreen } from '../../../screens/Send';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { snapshotOf } from '../../../../test-support/fixtures';
import { enterAmount } from '../../../../test-support/keypad';
import {
  activate,
  field,
  find,
  holds,
  press,
} from '../../../../test-support/query';
import { Commit } from '../Commit';
import { FeeSlider } from '../FeeSlider';
import { REQUOTE_BEAT_MS } from '../model';
import { ReviewLines } from '../ReviewLines';
import { stepInMs } from '../useLanding';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * The fee rate slider on a Bitcoin review (REDESIGN.md 6, Send): the sum is
 * its readout and previews the rate under the thumb, letting go asks the
 * engine to price it, the hold never sends figures the engine has not
 * priced, and a rate the engine refuses leaves the review that stood.
 */
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OTHER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RATES: FeeRates = { fast: 8, normal: 2, slow: 1, minimum: 1 };
const HOLD = copy.send.sendSats(4_200);

const said = jest.mocked(announce);
const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);
const logged = () => recentDiagnostics().map(entry => entry.code);

/** A review the engine priced as a splice at its normal rate. */
const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-1',
  destination: ADDRESS,
  description: '',
  amountSats: 4_200,
  feeSats: 500,
  feeLabel: 'Estimated network fee',
  totalSats: 4_700,
  route: 'bitcoin',
  feeRate: 2,
  feeRates: RATES,
  expiresAt: Date.now() + 60_000,
  warnings: [],
  ...over,
});

/** The same payment priced again at 8 sat/vB. */
const requoted = (over: Partial<SendReview> = {}): SendReview =>
  quote({
    id: 'review-2',
    feeRate: 8,
    feeSats: 2_000,
    totalSats: 6_200,
    expiresAt: Date.now() + 90_000,
    ...over,
  });

const outcome = (status: SendResult['status']): SendResult => ({
  id: 'p-rate',
  status,
  amountSats: 4_200,
  feeSats: 500,
  message: `The payment is ${status}.`,
});

const coded = (code: string, message = `${code} said.`) =>
  Object.assign(new Error(message), { code });

/** A call that is answered when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

const { balance } = snapshotOf();

function screen(client: object, props: Props = {}) {
  return (
    <GestureHandlerRootView>
      <SendScreen
        client={client as WalletAdapter}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={jest.fn()}
        balance={balance}
        {...props}
      />
    </GestureHandlerRootView>
  );
}

async function draw(client: object, props: Props = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screen(client, props));
  });
  trees.push(tree);
  return tree;
}

/** Reviewed for 4,200 sats to ADDRESS, with `client` answering. */
async function reviewed(client: object, props: Props = {}) {
  const tree = await draw(client, { initialRequest: ADDRESS, ...props });
  await enterAmount(tree, '4200');
  await press(tree, copy.send.review);
  return tree;
}

const slider = (tree: ReactTestRenderer) => tree.root.findByType(FeeSlider);
const lines = (tree: ReactTestRenderer) =>
  tree.root.findByType(ReviewLines).props;
const commit = (tree: ReactTestRenderer) => tree.root.findByType(Commit).props;
/** The rates the sum draws, leaving out the ghost that holds the column out of sight. */
const drawnRates = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .filter(
      text =>
        /sat\/vB$/.test(String(text.props.children)) &&
        StyleSheet.flatten(text.props.style).opacity !== 0,
    )
    .map(text => text.props.children);

/** Lets a step rise into view, so what waited for a landing is said. */
const arrive = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, stepInMs() + 50));
  });

const settle = (ms: number) =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
  });

const trees: ReactTestRenderer[] = [];
beforeEach(() => {
  clearHeldRequests();
  clearDiagnostics();
  forgetPendingHaptics();
  jest.clearAllMocks();
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
});

test("a Bitcoin review carries its slider at the engine's rate with the engine's marks, and a Lightning review has none", async () => {
  const tree = await reviewed({
    prepareSend: jest.fn().mockResolvedValue(quote()),
  });
  expect(slider(tree).props).toMatchObject({
    rate: 2,
    rates: RATES,
    min: 1,
    max: 18,
    feeSats: 500,
    disabled: false,
    refused: 0,
  });
  const lightning = await reviewed({
    prepareSend: jest.fn().mockResolvedValue(
      quote({ route: 'lightning', feeRate: undefined, feeRates: undefined }),
    ),
  });
  expect(lightning.root.findAllByType(FeeSlider)).toEqual([]);
  const funding = await reviewed({
    prepareSend: jest
      .fn()
      .mockResolvedValue(quote({ method: 'direct-funding', feeRate: undefined })),
  });
  expect(funding.root.findAllByType(FeeSlider)).toEqual([]);
});

test('a drag previews the fee and the total on the sum without asking the engine', async () => {
  const prepareSend = jest.fn().mockResolvedValue(quote());
  const tree = await reviewed({ prepareSend });
  await act(async () => slider(tree).props.onPreview(4));
  expect(lines(tree).review).toMatchObject({
    feeSats: 1_000,
    totalSats: 5_200,
    amountSats: 4_200,
  });
  expect(lines(tree).quick).toBe(true);
  expect(slider(tree).props).toMatchObject({ rate: 4, feeSats: 1_000 });
  expect(prepareSend).toHaveBeenCalledTimes(1);
  // The hold says what the sum shows.
  expect(commit(tree).summary).toContain(copy.amount.spoken(5_200));
});

test('the fee line says the rate it was priced at beside the fee, following the thumb, a refusal and the engine, and a review priced without one says none', async () => {
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockRejectedValueOnce(coded('INSUFFICIENT_FUNDS'))
    .mockResolvedValueOnce(requoted());
  const tree = await reviewed({ prepareSend });
  expect(drawnRates(tree)).toEqual(['2 sat/vB']);
  await act(async () => slider(tree).props.onPreview(4));
  expect(drawnRates(tree)).toEqual(['4 sat/vB']);
  expect(lines(tree).quick).toBe(true);
  // Refused, the rate springs back with the thumb.
  await act(async () => {
    await slider(tree).props.onChoose(4);
  });
  expect(drawnRates(tree)).toEqual(['2 sat/vB']);
  // Priced, it says the rate the engine answered with.
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  expect(drawnRates(tree)).toEqual(['8 sat/vB']);
  expect(lines(tree).quick).toBe(false);
  // A screen reader hears the rate from the slider, never from the sum.
  const [fee] = lines(tree).review.feeLabel
    ? tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          String(node.props.accessibilityLabel).endsWith(
            lines(tree).review.feeLabel,
          ),
      )
    : [];
  expect(fee.props.accessibilityValue).toEqual({
    text: copy.amount.spoken(2_000),
  });
  for (const over of [
    { route: 'lightning' as const, feeRate: undefined, feeRates: undefined },
    { method: 'direct-funding' as const, feeRate: undefined },
  ]) {
    const plain = await reviewed({
      prepareSend: jest.fn().mockResolvedValue(quote(over)),
    });
    expect(
      plain.root
        .findAllByType(Text)
        .some(text => /sat\/vB$/.test(String(text.props.children))),
    ).toBe(false);
  }
});

test("a max review's amount gives way to the fee under the thumb, and its total holds", async () => {
  const tree = await reviewed({
    prepareSend: jest.fn().mockResolvedValue(
      quote({
        max: true,
        keptSats: 1_402,
        keptReason: 'commitment-cost',
        amountSats: 99_500,
        totalSats: 100_000,
      }),
    ),
  });
  await act(async () => slider(tree).props.onPreview(8));
  expect(lines(tree).review).toMatchObject({
    feeSats: 2_000,
    amountSats: 98_000,
    totalSats: 100_000,
  });
  expect(commit(tree).accessibilityLabel).toBe(copy.send.sendMax);
});

test("letting go prices the rate: the review is replaced with a fresh quote, and the rate rides a refresh, an edit and the max chip", async () => {
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockResolvedValue(requoted());
  const quoteMax = jest.fn().mockResolvedValue({
    amountSats: 198_000,
    keptSats: 0,
    keptReason: 'none',
  });
  const tree = await reviewed(
    { prepareSend, quoteMax },
    { primaryConnected: true },
  );
  const before = commit(tree);
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    amountSats: 4_200,
    feeRate: 8,
  });
  expect(lines(tree).review).toMatchObject({ id: 'review-2', feeSats: 2_000 });
  expect(lines(tree).quick).toBe(false);
  expect(slider(tree).props).toMatchObject({ rate: 8, feeSats: 2_000 });
  const after = commit(tree);
  expect(after.expiresAt).not.toBe(before.expiresAt);
  expect(after.createdAt).toBeGreaterThanOrEqual(before.createdAt);
  // Back to compose and reviewed again, the payment is priced as it was,
  // and the max chip is quoted at that rate too.
  await press(tree, copy.send.edit);
  expect(quoteMax).toHaveBeenLastCalledWith({ request: ADDRESS, feeRate: 8 });
  await press(tree, copy.send.review);
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    amountSats: 4_200,
    feeRate: 8,
  });
});

test('the hold cannot send a review the slider has outgrown: it waits, busy, and sends what the engine priced', async () => {
  const second = deferred<SendReview>();
  const send = jest.fn().mockResolvedValue(outcome('completed'));
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockImplementationOnce(() => second.promise);
  const tree = await reviewed({ prepareSend, send });
  await act(async () => {
    slider(tree).props.onChoose(8);
  });
  expect(prepareSend).toHaveBeenCalledTimes(2);
  // Within a beat the hold looks as it did, and refuses to send.
  await activate(tree, HOLD);
  expect(send).not.toHaveBeenCalled();
  // Past the beat it runs its orbit, and takes no action.
  await settle(REQUOTE_BEAT_MS + 50);
  expect(holds(tree, HOLD)).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  // The engine's review lands: the hold is live again, and sends that one.
  await act(async () => {
    second.resolve(requoted());
  });
  expect(holds(tree, HOLD)).toHaveLength(1);
  await activate(tree, HOLD);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'review-2', feeRate: 8 }),
  );
});

test('a slower answer to an earlier rate is dropped once a later rate was chosen', async () => {
  const six = deferred<SendReview>();
  const eight = deferred<SendReview>();
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockImplementationOnce(() => six.promise)
    .mockImplementationOnce(() => eight.promise);
  const tree = await reviewed({ prepareSend });
  await act(async () => {
    slider(tree).props.onChoose(6);
  });
  await act(async () => {
    slider(tree).props.onChoose(8);
  });
  expect(slider(tree).props.rate).toBe(8);
  await act(async () => {
    eight.resolve(requoted());
  });
  await act(async () => {
    six.resolve(requoted({ id: 'review-6', feeRate: 6, feeSats: 1_500 }));
  });
  expect(lines(tree).review).toMatchObject({ id: 'review-2', feeRate: 8 });
  expect(slider(tree).props.rate).toBe(8);
});

test('a refused rate keeps the review that stood: the thumb springs back, the refusal is felt, said and logged, and the hold sends that review', async () => {
  const send = jest.fn().mockResolvedValue(outcome('completed'));
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockRejectedValueOnce(coded('INSUFFICIENT_FUNDS', 'Too much for the fee.'));
  const tree = await reviewed({ prepareSend, send });
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  expect(slider(tree).props).toMatchObject({ rate: 2, refused: 1 });
  expect(lines(tree).review).toMatchObject({ id: 'review-1', feeSats: 500 });
  expect(felt()).toContain('rigid');
  expect(logged()).toContain('INSUFFICIENT_FUNDS');
  await arrive();
  expect(said.mock.calls.map(([text]) => text)).toContain('Too much for the fee.');
  // The refusal is drawn beside the hold, and whispers its words.
  expect(
    tree.root.findAll(node => node.props.label === 'Too much for the fee.'),
  ).not.toEqual([]);
  await activate(tree, HOLD);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'review-1' }));
});

test('a quote that ran out is fresh again once a rate is chosen', async () => {
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote({ expiresAt: Date.now() + 200 }))
    .mockResolvedValueOnce(requoted());
  const tree = await reviewed({ prepareSend });
  await settle(400);
  expect(find(tree, copy.send.refreshQuote)).toBeDefined();
  expect(slider(tree).props.disabled).toBe(true);
  expect(slider(tree).props.hint).toBe(copy.send.quoteExpired);
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  expect(find(tree, copy.send.refreshQuote)).toBeUndefined();
  expect(holds(tree, HOLD)).toHaveLength(1);
  expect(slider(tree).props.disabled).toBe(false);
});

test('the slider is still once the hold commits, and while a quote is being refreshed', async () => {
  const tree = await reviewed({
    prepareSend: jest.fn().mockResolvedValue(quote()),
    send: jest.fn(() => new Promise<SendResult>(() => {})),
  });
  await activate(tree, HOLD);
  expect(slider(tree).props.disabled).toBe(true);
  // Another address: the first screen's payment is still out, so its
  // request is held.
  const refreshing = await reviewed(
    {
      prepareSend: jest
        .fn()
        .mockResolvedValueOnce(quote({ expiresAt: Date.now() - 1 }))
        .mockImplementationOnce(() => new Promise<SendReview>(() => {})),
    },
    { initialRequest: OTHER },
  );
  await act(async () => {
    find(refreshing, copy.send.refreshQuote)!.props.onPress();
  });
  expect(slider(refreshing).props.disabled).toBe(true);
});

test('letting go where the thumb started prices nothing, and frees the hold', async () => {
  const send = jest.fn().mockResolvedValue(outcome('completed'));
  const prepareSend = jest.fn().mockResolvedValue(quote());
  const tree = await reviewed({ prepareSend, send });
  await act(async () => slider(tree).props.onPreview(3));
  await act(async () => slider(tree).props.onPreview(2));
  await act(async () => {
    await slider(tree).props.onChoose(2);
  });
  expect(prepareSend).toHaveBeenCalledTimes(1);
  expect(lines(tree).quick).toBe(false);
  await activate(tree, HOLD);
  expect(send).toHaveBeenCalledTimes(1);
});

test('the rate resets with another request, so a new payment starts on the default', async () => {
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockResolvedValue(requoted());
  const tree = await reviewed({ prepareSend });
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  await press(tree, copy.send.edit);
  await act(async () => {
    field(tree, copy.send.request).props.onChangeText(OTHER);
  });
  await act(async () => {
    field(tree, copy.send.request).props.onBlur?.();
  });
  await enterAmount(tree, '4200');
  await press(tree, copy.send.review);
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: OTHER,
    amountSats: 4_200,
  });
});

test('a late answer after an edit reviews nothing', async () => {
  const second = deferred<SendReview>();
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockImplementationOnce(() => second.promise);
  const tree = await reviewed({ prepareSend });
  await act(async () => {
    slider(tree).props.onChoose(8);
  });
  await press(tree, copy.send.edit);
  await act(async () => {
    second.resolve(requoted());
  });
  expect(tree.root.findAllByType(ReviewLines)).toEqual([]);
  expect(find(tree, copy.send.review)).toBeDefined();
});

test('a screen reader hears the fee at the rate once the engine has priced it', async () => {
  const prepareSend = jest
    .fn()
    .mockResolvedValueOnce(quote())
    .mockResolvedValueOnce(requoted());
  const tree = await reviewed({ prepareSend });
  await arrive();
  const heard = () => said.mock.calls.map(([text]) => text);
  expect(heard()).not.toContain(copy.send.feeRateAt(8, 2_000));
  await act(async () => {
    await slider(tree).props.onChoose(8);
  });
  await arrive();
  expect(heard()).toContain(copy.send.feeRateAt(8, 2_000));
});
