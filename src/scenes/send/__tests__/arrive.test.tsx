import React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Reanimated from 'react-native-reanimated';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { activate, press } from '../../../../test-support/query';
import { Amount } from '../Amount';
import { Commit } from '../Commit';
import { HOME_AFTER_MS, SEND_GRACE_MS } from '../model';
import { ResultMark } from '../ResultMark';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * Send handing a result the hold it was sent with (REDESIGN.md 7, T7): the
 * hold's centre is read while the payment is out, a result or the overdue
 * held ring grows out of it on the comet's own clock, and what sits under
 * the mark rises in after it. A mark Send cannot place, a request that was
 * held before any hold, a retry, and Reduce Motion all keep the pop-in.
 */
const HOLD = copy.send.sendSats(4_200);
const REQUEST =
  'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.000042&label=arrive';
const AT = { x: 157, y: 708, width: 88, height: 88 };
const CENTRE = { x: 201, y: 752 };

const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-arrive',
  destination: 'recipient',
  description: '',
  amountSats: 4_200,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  totalSats: 4_220,
  route: 'lightning',
  expiresAt: Date.now() + 60_000,
  warnings: [],
  ...over,
});

const outcome = (status: SendResult['status']): SendResult => ({
  id: 'p-arrive',
  status,
  amountSats: 4_200,
  feeSats: 20,
  message: `The payment is ${status}.`,
});

/** A send whose answer the test gives when it chooses. */
function deferred() {
  let answer!: (result: SendResult) => void;
  const send = jest.fn(
    () =>
      new Promise<SendResult>(resolve => {
        answer = resolve;
      }),
  );
  return { send, answer: (result: SendResult) => answer(result) };
}

function screen(client: object) {
  return (
    <GestureHandlerRootView>
      <SendScreen
        client={client as WalletAdapter}
        initialRequest={REQUEST}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={jest.fn()}
        onDone={jest.fn()}
      />
    </GestureHandlerRootView>
  );
}

/** The screen on its review, with the hold measured where a device draws it. */
async function reviewed(client: object, measured = true) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screen(client));
  });
  await press(tree, copy.send.review);
  const circle = tree.root.find(
    node =>
      node.type === View &&
      node.props.collapsable === false &&
      node.props.accessibilityLabel === HOLD,
  );
  if (measured) {
    jest
      .mocked(circle.instance.measureInWindow)
      .mockImplementation(
        (done: (x: number, y: number, w: number, h: number) => void) =>
          done(AT.x, AT.y, AT.width, AT.height),
      );
  }
  return tree;
}

/** The step's view, keyed by the step, which the scene moves. */
const stepOf = (tree: ReactTestRenderer) =>
  tree.root.find(
    node =>
      typeof node.type !== 'string' &&
      node.props.layout !== undefined &&
      node.props.exiting !== undefined &&
      node.props.onTouchStart !== undefined,
  );

beforeEach(() => {
  jest.useFakeTimers();
  clearHeldRequests();
  jest.mocked(HapticFeedback.trigger).mockClear();
  // Shared values live as long as their component, as on a device.
  const made = Reanimated.useSharedValue;
  jest
    .spyOn(Reanimated, 'useSharedValue')
    .mockImplementation(init => React.useState(() => made(init))[0]);
});
afterEach(() => {
  jest.restoreAllMocks();
  // Every view measures through one mock, which keeps what a test taught it.
  (
    View.prototype as unknown as { measureInWindow: jest.Mock }
  ).measureInWindow.mockReset();
  jest.useRealTimers();
});

test('a result grows out of the hold: from its centre, on its comet clock, and nothing else moves the step', async () => {
  const { send, answer } = deferred();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const tree = await reviewed(client);
  const commit = tree.root.findByType(Commit);
  expect(commit.parent?.props.exiting).toBeUndefined();
  await activate(tree, HOLD);
  // Sent, the hold is drawn one frame under what takes its place, then gone.
  expect(tree.root.findByType(Commit).parent?.props.exiting).toEqual(
    expect.any(Function),
  );
  const clock = tree.root.findByType(Commit).props.comet;
  expect(clock).toBeDefined();
  await act(async () => answer(outcome('completed')));
  const mark = tree.root.findByType(ResultMark);
  expect(mark.props.arrival).toEqual({
    from: CENTRE,
    clock,
    warned: false,
  });
  expect(stepOf(tree).props.entering).toBeUndefined();
  // The amount under the mark rises in after it lands, as do the rest.
  expect(tree.root.findByType(Amount).parent?.props.entering).toEqual(
    expect.any(Function),
  );
  expect(felt()).toContain('notificationSuccess');
  await act(async () => tree.unmount());
});

test('a warned hold hands over its honey, and a result goes home as before', async () => {
  const onDone = jest.fn();
  const { send, answer } = deferred();
  const client = {
    prepareSend: jest
      .fn()
      .mockResolvedValue(quote({ warnings: ['This invoice expires soon.'] })),
    send,
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <SendScreen
          client={client as unknown as WalletAdapter}
          initialRequest={REQUEST}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={jest.fn()}
          onDone={onDone}
        />
      </GestureHandlerRootView>,
    );
  });
  await press(tree, copy.send.review);
  const circle = tree.root.find(
    node =>
      node.type === View &&
      node.props.collapsable === false &&
      node.props.accessibilityLabel === HOLD,
  );
  jest
    .mocked(circle.instance.measureInWindow)
    .mockImplementation(
      (done: (x: number, y: number, w: number, h: number) => void) =>
        done(AT.x, AT.y, AT.width, AT.height),
    );
  await activate(tree, HOLD);
  await act(async () => answer(outcome('completed')));
  expect(tree.root.findByType(ResultMark).props.arrival?.warned).toBe(true);
  await act(async () => jest.advanceTimersByTime(HOME_AFTER_MS));
  expect(onDone).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test('the held ring a payment past its grace moves to grows out of the hold too', async () => {
  const { send } = deferred();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const tree = await reviewed(client);
  await activate(tree, HOLD);
  await act(async () => jest.advanceTimersByTime(SEND_GRACE_MS));
  const mark = tree.root.findByType(ResultMark);
  expect(mark.props.visual.shape).toBe('held');
  expect(mark.props.arrival?.from).toEqual(CENTRE);
  await act(async () => tree.unmount());
});

test('a mark Send could not place pops in, and a retry starts clean', async () => {
  const { send, answer } = deferred();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const tree = await reviewed(client, false);
  await activate(tree, HOLD);
  await act(async () => answer(outcome('failed')));
  const mark = tree.root.findByType(ResultMark);
  expect(mark.props.arrival).toBeNull();
  expect(stepOf(tree).props.entering).toEqual(expect.any(Function));
  await act(async () => tree.unmount());
});

test('a retry lets the arrival go', async () => {
  const { send, answer } = deferred();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const tree = await reviewed(client);
  await activate(tree, HOLD);
  await act(async () => answer(outcome('failed')));
  expect(tree.root.findByType(ResultMark).props.arrival).not.toBeNull();
  await act(async () => tree.root.findByType(ResultMark).props.onPress?.());
  expect(tree.root.findAllByType(ResultMark)).toHaveLength(0);
  await act(async () => tree.unmount());
});

// Reduce Motion, once read, holds for the rest of the file.
test('under Reduce Motion nothing is handed over: the mark pops in where it rests', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const { send, answer } = deferred();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const tree = await reviewed(client);
  await activate(tree, HOLD);
  await act(async () => answer(outcome('completed')));
  expect(tree.root.findByType(ResultMark).props.arrival).toBeNull();
  await act(async () => tree.unmount());
});
