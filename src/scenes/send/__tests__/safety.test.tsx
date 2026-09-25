import React from 'react';
import { AccessibilityInfo, TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { SendScreen } from '../../../screens/Send';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import { heldRequest, holdRequest } from '../../../stage/heldRequests';
import {
  activate,
  alerts,
  field,
  find,
  holds,
  meaning,
  press,
  pressableLabels,
} from '../../../../test-support/query';
import { ReviewLines } from '../ReviewLines';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * Send's safety states (REDESIGN.md rules 4 and 6): a held request never
 * reaches a review however it is entered, a prepare that pays nothing holds
 * nothing, and an expired quote or a stale balance is felt, said aloud and
 * logged as it starts. After each step a screen reader moves to the step's
 * primary element, ahead of anything said aloud.
 */
const said = jest.mocked(announce);
const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);
const logged = () => recentDiagnostics().map(entry => entry.code);

const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-safety',
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
  id: 'p-safety',
  status,
  amountSats: 4_200,
  feeSats: 20,
  message: `The payment is ${status}.`,
});

const coded = (code: string, message = `${code} said.`) =>
  Object.assign(new Error(message), { code });

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

function screen(client: object, props: Props = {}) {
  return (
    <GestureHandlerRootView>
      <SendScreen
        client={client as WalletAdapter}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={jest.fn()}
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
  return tree;
}

/** The hold for the 4,200 sats every test here sends. */
const HOLD = copy.send.sendSats(4_200);

const type = (tree: ReactTestRenderer, text: string) =>
  act(async () => {
    field(tree, copy.send.request).props.onChangeText(text);
  });

/** The labels of the elements a screen reader was moved to, in turn. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(
      ([node]) =>
        (node as unknown as ReactTestInstance).props.accessibilityLabel,
    );

beforeEach(() => {
  said.mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  clearDiagnostics();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('a held request', () => {
  test('typed into the well, is held as it is reviewed, and nothing is prepared', async () => {
    holdRequest('lnbc-typed-held', { status: 'uncertain' });
    const prepareSend = jest.fn();
    const tree = await draw({ prepareSend });
    await type(tree, 'LIGHTNING:lnbc-typed-held');
    // Still being typed: the well stays, so a slip can be corrected.
    expect(meaning(tree)).not.toContain(copy.send.held);
    await press(tree, copy.send.review);
    expect(prepareSend).not.toHaveBeenCalled();
    expect(meaning(tree)).toContain(copy.send.held);
    expect(pressableLabels(tree)).not.toContain(copy.send.review);
    expect(said).toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
    expect(logged()).toContain('HELD');
    await act(async () => tree.unmount());
  });

  test('opens from its chip to take another request, and stays held', async () => {
    holdRequest('lnbc-chip-held', { status: 'pending' });
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const tree = await draw(
      { prepareSend },
      { initialRequest: 'lnbc-chip-held' },
    );
    expect(meaning(tree)).toContain(copy.send.onItsWay);
    await press(tree, copy.send.request);
    await type(tree, 'lnbc-another');
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledWith({
      request: 'lnbc-another',
      amountSats: undefined,
    });
    expect(heldRequest('lnbc-chip-held')).toEqual({ status: 'pending' });
    await act(async () => tree.unmount());
  });

  test('held since its review never pays: the hold lands on the held ring', async () => {
    const send = jest.fn();
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()), send },
      { initialRequest: 'lnbc-held-late' },
    );
    await press(tree, copy.send.review);
    // Paid from elsewhere meanwhile, with its outcome unknown.
    holdRequest('lnbc-held-late', { status: 'uncertain' });
    await activate(tree, HOLD);
    expect(send).not.toHaveBeenCalled();
    expect(meaning(tree)).toContain(copy.send.held);
    await act(async () => tree.unmount());
  });
});

describe('preparing', () => {
  test('without an answer pays nothing, so it is an error to retry and holds nothing', async () => {
    const prepareSend = jest
      .fn()
      .mockRejectedValueOnce(coded('RESULT_UNCERTAIN', 'No answer came.'))
      .mockResolvedValueOnce(quote());
    const tree = await draw({ prepareSend }, { initialRequest: 'lnbc-flaky' });
    await press(tree, copy.send.review);
    expect(alerts(tree)).toEqual(['No answer came.']);
    expect(heldRequest('lnbc-flaky')).toBeNull();
    expect(meaning(tree)).not.toContain(copy.send.held);
    await press(tree, copy.send.review);
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('that the engine says is already out holds the request', async () => {
    const prepareSend = jest
      .fn()
      .mockRejectedValue(coded('ALREADY_SUBMITTED', 'Already submitted.'));
    const tree = await draw({ prepareSend }, { initialRequest: 'lnbc-twice' });
    await press(tree, copy.send.review);
    expect(heldRequest('lnbc-twice')).toEqual({ status: 'uncertain' });
    expect(meaning(tree)).toContain(copy.send.held);
    expect(pressableLabels(tree)).not.toContain(copy.send.review);
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({
        phase: 'ui',
        code: 'ALREADY_SUBMITTED',
        message: 'Already submitted.',
      }),
    );
    await act(async () => tree.unmount());
  });
});

describe('a quote', () => {
  test('running out is said as it nears, then felt, said and logged as it goes', async () => {
    jest.useFakeTimers();
    const tree = await draw(
      {
        prepareSend: jest
          .fn()
          .mockResolvedValue(quote({ expiresAt: Date.now() + 15_000 })),
      },
      { initialRequest: 'lnbc-clock' },
    );
    await press(tree, copy.send.review);
    // The ring says nothing; the hold carries the time left.
    const left = () => holds(tree, HOLD)[0].props.accessibilityValue.text;
    expect(left()).toBe(copy.send.quoteExpires(15));
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(left()).toBe(copy.send.quoteExpires(10));
    expect(said).toHaveBeenLastCalledWith(copy.send.quoteExpires(10));
    expect(find(tree, copy.send.refreshQuote)).toBeUndefined();
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(find(tree, copy.send.refreshQuote)).toBeDefined();
    expect(holds(tree, HOLD)).toEqual([]);
    expect(said).toHaveBeenLastCalledWith(copy.send.quoteExpired, {
      assertive: true,
    });
    expect(felt()).toContain('notificationWarning');
    expect(logged()).toContain('QUOTE_EXPIRED');
    // The ring stays, to retract round the refresh.
    expect(tree.root.findAllByType(ExpiryRing)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('past its time when the hold completes is never sent', async () => {
    const send = jest.fn();
    const expiresAt = Date.now() + 60_000;
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote({ expiresAt })),
        send,
      },
      { initialRequest: 'lnbc-late-hold' },
    );
    await press(tree, copy.send.review);
    jest.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
    await activate(tree, HOLD);
    expect(send).not.toHaveBeenCalled();
    expect(find(tree, copy.send.refreshQuote)).toBeDefined();
    expect(logged()).toContain('QUOTE_EXPIRED');
    await act(async () => tree.unmount());
  });

  test('refreshed keeps the review on screen until the new one lands', async () => {
    let fresh!: (value: SendReview) => void;
    const prepareSend = jest
      .fn()
      .mockResolvedValueOnce(quote({ expiresAt: Date.now() - 1 }))
      .mockReturnValueOnce(
        new Promise<SendReview>(resolve => {
          fresh = resolve;
        }),
      );
    const tree = await draw({ prepareSend }, { initialRequest: 'lnbc-again' });
    await press(tree, copy.send.review);
    await press(tree, copy.send.refreshQuote);
    expect(tree.root.findAllByType(ReviewLines)).toHaveLength(1);
    expect(tree.root.findAllByType(ExpiryRing)).toHaveLength(1);
    await act(async () => fresh(quote()));
    expect(holds(tree, HOLD)).toHaveLength(1);
    expect(prepareSend).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
  });
});

describe('the stage', () => {
  /** When the stage was first told busy, against when `call` was made. */
  const busyBefore = (onBusy: jest.Mock, call: jest.Mock) => {
    const told = onBusy.mock.calls.findIndex(([busy]) => busy === true);
    expect(told).toBeGreaterThanOrEqual(0);
    expect(call).toHaveBeenCalled();
    return (
      onBusy.mock.invocationCallOrder[told] < call.mock.invocationCallOrder[0]
    );
  };

  test('is held busy as a review is asked for, before it goes out', async () => {
    const onBusy = jest.fn();
    const prepareSend = jest.fn(() => new Promise<SendReview>(() => {}));
    const tree = await draw(
      { prepareSend },
      { initialRequest: 'lnbc-busy-review', onBusy },
    );
    onBusy.mockClear();
    // The review never lands, so the press is not waited on.
    await act(async () => {
      find(tree, copy.send.review)?.props.onPress();
    });
    expect(busyBefore(onBusy, prepareSend)).toBe(true);
    await act(async () => tree.unmount());
  });

  test('is held busy the moment the hold commits, before the payment goes out', async () => {
    const onBusy = jest.fn();
    const send = jest.fn(() => new Promise<SendResult>(() => {}));
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()), send },
      { initialRequest: 'lnbc-busy-send', onBusy },
    );
    await press(tree, copy.send.review);
    onBusy.mockClear();
    await activate(tree, HOLD);
    expect(busyBefore(onBusy, send)).toBe(true);
    // Released only as Send goes, never on the way into busy.
    expect(onBusy).not.toHaveBeenCalledWith(false);
    await act(async () => tree.unmount());
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });
});

test('a balance going stale closes the gate, felt, said and logged, and a tap refreshes', async () => {
  const send = jest.fn();
  const onRefresh = jest.fn();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const props = { initialRequest: 'lnbc-aging', onRefresh };
  const tree = await draw(client, props);
  await press(tree, copy.send.review);
  expect(logged()).not.toContain('STALE');
  await act(async () => {
    tree.update(screen(client, { ...props, disabled: true }));
  });
  expect(said).toHaveBeenCalledWith(copy.send.stale, { assertive: true });
  expect(felt()).toContain('notificationWarning');
  expect(logged()).toContain('STALE');
  // The hold is gone; what is left under its label only refreshes.
  expect(holds(tree, HOLD)).toEqual([]);
  await press(tree, copy.send.sendSats(4_200));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

describe('a screen reader', () => {
  test('hears what the empty well takes, which it once showed', async () => {
    const tree = await draw({});
    const well = () => tree.root.findByType(TextInput);
    expect(well().props.accessibilityHint).toBe(copy.send.requestEmpty);
    expect(well().props.placeholder).toBeUndefined();
    await type(tree, 'lnbc-typing');
    expect(well().props.accessibilityHint).toBeUndefined();
    await act(async () => tree.unmount());
  });

  test('moves to the hold as the review arrives', async () => {
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()) },
      { initialRequest: 'lnbc-focus' },
    );
    await press(tree, copy.send.review);
    expect(focused()).toEqual([copy.send.sendSats(4_200)]);
    await act(async () => tree.unmount());
  });

  test('moves to an unknown result before it is told, so the telling is heard whole', async () => {
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockResolvedValue(outcome('uncertain')),
      },
      { initialRequest: 'lnbc-focus-unknown' },
    );
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    expect(focused().at(-1)).toBe(copy.send.unknown);
    const [moved] = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.invocationCallOrder.slice(-1);
    const told = said.mock.calls.findIndex(
      ([text]) => text === copy.send.heldAnnouncement,
    );
    expect(said.mock.calls[told][1]).toEqual({ assertive: true });
    expect(said.mock.invocationCallOrder[told]).toBeGreaterThan(moved);
    await act(async () => tree.unmount());
  });
});

test('a failed payment touched and paid again still goes home once it completes', async () => {
  jest.useFakeTimers();
  const onDone = jest.fn();
  const send = jest
    .fn()
    .mockResolvedValueOnce(outcome('failed'))
    .mockResolvedValueOnce(outcome('completed'));
  const tree = await draw(
    { prepareSend: jest.fn().mockResolvedValue(quote()), send },
    { initialRequest: 'lnbc-second-go', onDone },
  );
  await press(tree, copy.send.review);
  await activate(tree, HOLD);
  await act(async () => {
    tree.root
      .findAll(node => typeof node.props.onTouchStart === 'function')[0]
      .props.onTouchStart();
  });
  await press(tree, copy.send.failed);
  await press(tree, copy.send.review);
  await activate(tree, HOLD);
  expect(meaning(tree)).toContain(copy.send.sent);
  await act(async () => jest.advanceTimersByTime(2_200));
  expect(onDone).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
