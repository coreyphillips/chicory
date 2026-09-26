import React, { createRef } from 'react';
import { AccessibilityInfo, TextInput } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { ExpiryRing } from '../../../glyphs/ExpiryRing';
import { SendScreen } from '../../../screens/Send';
import type { SendHandle } from '../../../screens/Send';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import {
  clearHeldRequests,
  heldRequest,
  holdRequest,
} from '../../../stage/heldRequests';
import { activityOf } from '../../../../test-support/fixtures';
import { enterAmount } from '../../../../test-support/keypad';
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
import { SEND_GRACE_MS } from '../model';
import { ResultMark } from '../ResultMark';
import { ReviewLines } from '../ReviewLines';
import { stepInMs } from '../useLanding';
import { FOCUS_SETTLE_MS, forgetSafety } from '../../../motion/speech';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * Send's safety states (REDESIGN.md rules 4 and 6): a held request never
 * reaches a review however it is entered, a prepare that pays nothing holds
 * nothing, and an expired quote or a stale balance is felt, said aloud and
 * logged as it starts. After each step a screen reader moves to the step's
 * primary element once the step has risen into view, ahead of anything said
 * aloud.
 */

/**
 * A request the parser reads as a payment, named `label`, so it is taken as
 * a chip and can be held. A string it cannot read is refused as it enters.
 */
const payable = (label: string) =>
  `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?label=${label}`;

/** A payable request, named `label`, that fixes the 4,200 sats sent here. */
const priced = (label: string) =>
  `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.000042&label=${label}`;

/**
 * A request for the same 4,200 sats to another address. A label does not
 * make another request: the held set knows a Bitcoin request by its address
 * and amount.
 */
const pricedElsewhere = (label: string) =>
  `bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.000042&label=${label}`;

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

/**
 * Lets a step rise into view, so a screen reader lands on it and what waited
 * for the landing is said. Under fake timers the clock is moved on instead.
 */
const arrive = (fake = false) =>
  act(async () => {
    const ms = stepInMs() + 50;
    if (fake) jest.advanceTimersByTime(ms);
    else await new Promise<void>(resolve => setTimeout(resolve, ms));
  });

/**
 * Lets a step arrive and a safety message be heard: announceSafety holds one
 * until the landing is made and has had FOCUS_SETTLE_MS to settle
 * (REDESIGN.md 9).
 */
const heard = async (fake = false) => {
  await arrive(fake);
  await act(async () => {
    const ms = FOCUS_SETTLE_MS + 50;
    if (fake) jest.advanceTimersByTime(ms);
    else await new Promise<void>(resolve => setTimeout(resolve, ms));
  });
};

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
  // A safety message one test left unheard is not said in the next, and a
  // request one test held does not hold the next test's.
  forgetSafety();
  clearHeldRequests();
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
    holdRequest(priced('typed-held'), { status: 'uncertain' });
    const prepareSend = jest.fn();
    const tree = await draw({ prepareSend });
    await type(tree, priced('typed-held').replace('bitcoin:', 'BITCOIN:'));
    // Still being typed: the well stays, so a slip can be corrected.
    expect(meaning(tree)).not.toContain(copy.send.held);
    await press(tree, copy.send.review);
    expect(prepareSend).not.toHaveBeenCalled();
    expect(meaning(tree)).toContain(copy.send.held);
    expect(pressableLabels(tree)).not.toContain(copy.send.review);
    expect(logged()).toContain('HELD');
    // Landed on its mark, and said once the landing has settled, so the
    // move does not cut it short.
    await arrive();
    expect(focused().at(-1)).toBe(copy.send.unknown);
    expect(said).not.toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
    await heard();
    expect(said).toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
    await act(async () => tree.unmount());
  });

  test('left before it is heard, is not said as it goes', async () => {
    holdRequest(payable('left-held'), { status: 'uncertain' });
    const tree = await draw({}, { initialRequest: payable('left-held') });
    expect(meaning(tree)).toContain(copy.send.held);
    expect(logged()).toContain('HELD');
    await act(async () => tree.unmount());
    await heard();
    expect(said).not.toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
  });

  test('opens from its chip to take another request, and stays held', async () => {
    holdRequest(payable('chip-held'), { status: 'pending' });
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const tree = await draw(
      { prepareSend },
      { initialRequest: payable('chip-held') },
    );
    expect(meaning(tree)).toContain(copy.send.onItsWay);
    await press(tree, copy.send.request);
    await type(tree, pricedElsewhere('another'));
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledWith({
      request: pricedElsewhere('another'),
      amountSats: undefined,
    });
    expect(heldRequest(payable('chip-held'))).toEqual({ status: 'pending' });
    await act(async () => tree.unmount());
  });

  test('held since its review never pays: the hold lands on the held ring', async () => {
    const send = jest.fn();
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()), send },
      { initialRequest: priced('held-late') },
    );
    await press(tree, copy.send.review);
    // Paid from elsewhere meanwhile, with its outcome unknown.
    await act(async () =>
      holdRequest(priced('held-late'), { status: 'uncertain' }),
    );
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
    const tree = await draw(
      { prepareSend },
      { initialRequest: priced('flaky') },
    );
    await press(tree, copy.send.review);
    expect(alerts(tree)).toEqual(['No answer came.']);
    expect(heldRequest(priced('flaky'))).toBeNull();
    expect(meaning(tree)).not.toContain(copy.send.held);
    await press(tree, copy.send.review);
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('that the engine says is already out holds the request', async () => {
    const prepareSend = jest
      .fn()
      .mockRejectedValue(coded('ALREADY_SUBMITTED', 'Already submitted.'));
    const tree = await draw(
      { prepareSend },
      { initialRequest: priced('twice') },
    );
    await press(tree, copy.send.review);
    expect(heldRequest(priced('twice'))).toEqual({ status: 'uncertain' });
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
      { initialRequest: priced('clock') },
    );
    await press(tree, copy.send.review);
    // The ring says nothing; the hold carries the time left, last.
    const left = () => holds(tree, HOLD)[0].props.accessibilityValue.text;
    expect(left()).toMatch(new RegExp(`${copy.send.quoteExpires(15)}$`));
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(left()).toMatch(new RegExp(`${copy.send.quoteExpires(10)}$`));
    expect(said).toHaveBeenLastCalledWith(copy.send.quoteExpires(10));
    expect(find(tree, copy.send.refreshQuote)).toBeUndefined();
    await act(async () => jest.advanceTimersByTime(10_000));
    await heard(true);
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
      { initialRequest: priced('late-hold') },
    );
    await press(tree, copy.send.review);
    jest.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
    await activate(tree, HOLD);
    expect(send).not.toHaveBeenCalled();
    expect(find(tree, copy.send.refreshQuote)).toBeDefined();
    expect(logged()).toContain('QUOTE_EXPIRED');
    await act(async () => tree.unmount());
  });

  test('is spent once the hold commits: it never runs out, offers a refresh or asks for a review again', async () => {
    jest.useFakeTimers();
    const send = jest.fn(() => new Promise<SendResult>(() => {}));
    const client = {
      prepareSend: jest
        .fn()
        .mockResolvedValue(quote({ expiresAt: Date.now() + 15_000 })),
      send,
    };
    const props = { initialRequest: priced('spent') };
    const tree = await draw(client, props);
    await press(tree, copy.send.review);
    expect(tree.root.findAllByType(ExpiryRing)).toHaveLength(1);
    await activate(tree, HOLD);
    expect(send).toHaveBeenCalledTimes(1);
    // The quote's ring goes as the hold commits, and the sum dims back.
    expect(tree.root.findAllByType(ExpiryRing)).toEqual([]);
    expect(tree.root.findByType(ReviewLines).props.spent).toBe(true);
    // Past the moment the quote would have run out, and past a balance
    // going stale, the hold is still what shows, going out.
    await act(async () => jest.advanceTimersByTime(5_000));
    await act(async () => {
      tree.update(screen(client, { ...props, disabled: true }));
    });
    await act(async () => jest.advanceTimersByTime(2_000));
    await heard(true);
    expect(find(tree, copy.send.refreshQuote)).toBeUndefined();
    expect(tree.root.findAllByType(ExpiryRing)).toEqual([]);
    const [hold] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === HOLD &&
        node.props.accessibilityState?.busy === true,
    );
    expect(hold).toBeDefined();
    // Its words no longer count a quote down.
    expect(hold.props.accessibilityValue.text).not.toMatch(
      copy.send.quoteExpires(0),
    );
    expect(logged()).not.toContain('QUOTE_EXPIRED');
    expect(said).not.toHaveBeenCalledWith(copy.send.quoteExpired, {
      assertive: true,
    });
    expect(said).not.toHaveBeenCalledWith(copy.send.quoteExpires(10));
    await act(async () => tree.unmount());
  });

  test('refused as it is sent is not spent: the review comes back to try again', async () => {
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockRejectedValue(coded('QUOTE_EXPIRED')),
      },
      { initialRequest: priced('refused-spent') },
    );
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    expect(find(tree, copy.send.refreshQuote)).toBeDefined();
    expect(tree.root.findByType(ReviewLines).props.spent).toBe(false);
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
    const tree = await draw(
      { prepareSend },
      { initialRequest: priced('again') },
    );
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

describe('a payment whose call does not answer', () => {
  /**
   * `request` reviewed and held to send, under fake timers, with a call to
   * pay it that answers only when the test says.
   */
  async function hanging(request: string, props: Props = {}) {
    jest.useFakeTimers();
    let answer!: (result: SendResult) => void;
    let refuse!: (error: Error) => void;
    const send = jest.fn(
      () =>
        new Promise<SendResult>((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    );
    const onBusy = jest.fn();
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const tree = await draw(
      { prepareSend, send },
      { initialRequest: request, onBusy, ...props },
    );
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    expect(send).toHaveBeenCalledTimes(1);
    return {
      tree,
      onBusy,
      prepareSend,
      answer: (result: SendResult) => act(async () => answer(result)),
      refuse: (error: Error) => act(async () => refuse(error)),
    };
  }
  const past = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

  test('holds its request from the moment the hold commits, so it lands on the held ring from anywhere', async () => {
    const request = priced('out-now');
    const { tree, prepareSend } = await hanging(request);
    expect(heldRequest(request)).toEqual({ status: 'pending' });
    // Entered again meanwhile, from a link or a paste, it is never reviewed.
    const again = await draw({ prepareSend }, { initialRequest: request });
    expect(meaning(again)).toContain(copy.send.onItsWay);
    expect(meaning(again)).toContain(copy.send.held);
    expect(pressableLabels(again)).not.toContain(copy.send.review);
    expect(prepareSend).toHaveBeenCalledTimes(1);
    await act(async () => again.unmount());
    await act(async () => tree.unmount());
  });

  test('keeps the stage busy only for its grace, then moves to the held ring, with the way out free', async () => {
    const { tree, onBusy } = await hanging(priced('grace'));
    jest.mocked(HapticFeedback.trigger).mockClear();
    expect(onBusy).toHaveBeenLastCalledWith(true);
    onBusy.mockClear();
    await past(SEND_GRACE_MS - 1);
    // Still the review going out: most payments answer inside the grace.
    expect(onBusy).not.toHaveBeenCalledWith(false);
    expect(tree.root.findAllByType(ReviewLines)).toHaveLength(1);
    expect(logged()).not.toContain('HELD');
    await past(1);
    expect(onBusy).toHaveBeenLastCalledWith(false);
    expect(tree.root.findAllByType(ReviewLines)).toEqual([]);
    // The held ring, honey, with an orbit round it: still under way.
    const [mark] = tree.root.findAllByType(ResultMark);
    expect(mark.props.visual).toMatchObject({
      shape: 'held',
      tone: 'honey',
      orbit: true,
    });
    expect(meaning(tree)).toContain(copy.send.onItsWay);
    expect(meaning(tree)).toContain(copy.send.held);
    // Felt twice as a held payment is, logged, and said once it has landed.
    await past(300);
    expect(felt()).toEqual(['notificationWarning', 'notificationWarning']);
    expect(logged()).toContain('HELD');
    await heard(true);
    expect(said).toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
    // The history is a tap away, and nothing on the screen pays.
    expect(find(tree, copy.send.viewActivity)).toBeDefined();
    expect(holds(tree, HOLD)).toEqual([]);
    await act(async () => tree.unmount());
  });

  test.each([
    ['completed', copy.send.sent],
    ['uncertain', copy.send.unknown],
    ['failed', copy.send.failed],
  ] as const)(
    'answered %s after its grace, moves the held ring on to how it went',
    async (status, title) => {
      const { tree, answer } = await hanging(priced(`late-${status}`));
      await past(SEND_GRACE_MS);
      expect(meaning(tree)).toContain(copy.send.onItsWay);
      await answer(outcome(status));
      expect(meaning(tree)).toContain(title);
      expect(meaning(tree)).not.toContain(copy.send.held);
      await act(async () => tree.unmount());
    },
  );

  test('refused after its grace, shows the payment failed and lets the request go', async () => {
    const request = priced('late-refused');
    const { tree, refuse } = await hanging(request);
    await past(SEND_GRACE_MS);
    await refuse(coded('NO_ROUTE', 'No route was found.'));
    expect(meaning(tree)).toContain(copy.send.failed);
    expect(heldRequest(request)).toBeNull();
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({
        code: 'NO_ROUTE',
        message: 'No route was found.',
      }),
    );
    await act(async () => tree.unmount());
  });

  test('completing while its held ring shows in a Send entered again, resolves the ring into the paid mark it watched, heard as sent and felt as nothing new', async () => {
    // It cut in one frame to the mark a request paid before rests on,
    // "Already paid." (P12, 06k).
    const request = priced('resolves');
    const first = await hanging(request);
    await past(SEND_GRACE_MS);
    await act(async () => first.tree.unmount());
    const onDone = jest.fn();
    const again = await draw(
      { prepareSend: first.prepareSend },
      { initialRequest: request, onDone },
    );
    expect(meaning(again)).toContain(copy.send.onItsWay);
    await heard(true);
    jest.mocked(HapticFeedback.trigger).mockClear();
    said.mockClear();
    await first.answer(outcome('completed'));
    const [mark] = again.root.findAllByType(ResultMark);
    expect(mark.props.visual).toMatchObject({
      shape: 'disc',
      resolves: true,
      returnsHome: false,
    });
    expect(mark.props.visual.resting).toBeFalsy();
    expect(meaning(again)).toContain(copy.send.sent);
    expect(meaning(again)).not.toContain(copy.send.paidAlready);
    await arrive(true);
    expect(said).toHaveBeenCalledWith(copy.send.sent);
    expect(said).not.toHaveBeenCalledWith(copy.send.paidAlready);
    // No celebration for a payment felt as it was held, and no way home on
    // its own.
    await past(10_000);
    expect(felt()).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => again.unmount());
  });

  test('answered after Send has gone, is recorded all the same and draws nothing', async () => {
    const errors = jest.spyOn(console, 'error');
    const unknown = priced('gone-unknown');
    const first = await hanging(unknown);
    await past(SEND_GRACE_MS);
    await act(async () => first.tree.unmount());
    await first.answer(outcome('uncertain'));
    expect(heldRequest(unknown)).toEqual({ status: 'uncertain' });
    expect(logged()).toContain('UNCERTAIN');

    const refused = pricedElsewhere('gone-refused');
    const second = await hanging(refused);
    await act(async () => second.tree.unmount());
    await second.refuse(coded('NO_ROUTE'));
    expect(heldRequest(refused)).toBeNull();
    expect(logged()).toContain('NO_ROUTE');
    expect(errors).not.toHaveBeenCalled();
  });

  test('answered once the screen has moved on to another request, is recorded without taking it back', async () => {
    const request = priced('moved-on');
    const { tree, answer } = await hanging(request);
    await past(SEND_GRACE_MS);
    // Opened from its chip, to take another request.
    await press(tree, copy.send.request);
    await type(tree, pricedElsewhere('another'));
    await answer(outcome('uncertain'));
    expect(heldRequest(request)).toEqual({ status: 'uncertain' });
    expect(meaning(tree)).not.toContain(copy.send.unknown);
    expect(field(tree, copy.send.request).props.value).toBe(
      pricedElsewhere('another'),
    );
    await act(async () => tree.unmount());
  });
});

describe('a paid request', () => {
  /**
   * The BOLT 11 example invoice for 250,000 sats, which reads as a payment
   * and carries a payment hash the history can be matched by.
   */
  const INVOICE =
    'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';
  const HASH =
    '0001020304050607080900010203040506070809000102030405060708090102';

  /** Whether the tree shows a request paid: its mark at rest, no review. */
  function restsOnPaid(tree: ReactTestRenderer) {
    expect(meaning(tree)).toContain(copy.send.paidAlready);
    expect(pressableLabels(tree)).not.toContain(copy.send.review);
    expect(holds(tree, HOLD)).toEqual([]);
    const [mark] = tree.root.findAllByType(ResultMark);
    expect(mark.props.visual).toMatchObject({
      shape: 'disc',
      resting: true,
      returnsHome: false,
    });
  }

  test('paid here, entered again, rests on its paid mark and is never reviewed', async () => {
    jest.useFakeTimers();
    const request = priced('paid-here');
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const client = {
      prepareSend,
      send: jest.fn().mockResolvedValue(outcome('completed')),
    };
    const first = await draw(client, { initialRequest: request });
    await press(first, copy.send.review);
    await activate(first, HOLD);
    expect(meaning(first)).toContain(copy.send.sent);
    await act(async () => first.unmount());
    // The history has not been read since, so only this app knows.
    jest.mocked(HapticFeedback.trigger).mockClear();
    clearDiagnostics();
    const onDone = jest.fn();
    const again = await draw(client, {
      initialRequest: request,
      activity: [],
      onDone,
    });
    restsOnPaid(again);
    expect(prepareSend).toHaveBeenCalledTimes(1);
    // Nothing is played or felt for a payment seen before, nothing is
    // logged, the ground is not held, and it never goes home on its own.
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(felt()).toEqual([]);
    expect(logged()).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    expect(said).toHaveBeenCalledWith(copy.send.paidAlready);
    await act(async () => again.unmount());
  });

  test('known paid by the history alone, rests on its mark with the way to that payment', async () => {
    const paid = activityOf('sent', 'completed', { paymentHash: HASH });
    const onDetail = jest.fn();
    const onActivity = jest.fn();
    const tree = await draw(
      {},
      {
        initialRequest: `lightning:${INVOICE}`,
        activity: [paid],
        onDetail,
        onActivity,
      },
    );
    restsOnPaid(tree);
    await press(tree, copy.send.viewActivity);
    expect(onDetail).toHaveBeenCalledWith(paid);
    expect(onActivity).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('rests on its paid mark however it arrives: pasted, scanned, linked or typed', async () => {
    const request = priced('paid-arrives');
    holdRequest(request, { status: 'completed' });
    // Brought by a link.
    const linked = await draw({}, { initialRequest: request });
    restsOnPaid(linked);
    await act(async () => linked.unmount());
    // Pasted.
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(request);
    const pasted = await draw({});
    await press(pasted, copy.send.paste);
    restsOnPaid(pasted);
    await act(async () => pasted.unmount());
    // Scanned into an open Send.
    const handle = createRef<SendHandle>();
    const scanned = await draw({}, { ref: handle });
    await act(async () => {
      handle.current!.receive(request);
    });
    restsOnPaid(scanned);
    await act(async () => scanned.unmount());
    // Typed and left.
    const typed = await draw({});
    await type(typed, request);
    await act(async () => typed.root.findByType(TextInput).props.onBlur());
    restsOnPaid(typed);
    await act(async () => typed.unmount());
  });

  test('paid elsewhere while its review is up, the hold rests on the paid mark and pays nothing', async () => {
    const request = priced('paid-meanwhile');
    const send = jest.fn();
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()), send },
      { initialRequest: request },
    );
    await press(tree, copy.send.review);
    await act(async () => holdRequest(request, { status: 'completed' }));
    await activate(tree, HOLD);
    expect(send).not.toHaveBeenCalled();
    restsOnPaid(tree);
    await act(async () => tree.unmount());
  });

  test('a payment that failed moved no money, so its request is offered again', async () => {
    const request = priced('failed-again');
    const client = {
      prepareSend: jest.fn().mockResolvedValue(quote()),
      send: jest.fn().mockResolvedValue(outcome('failed')),
    };
    const first = await draw(client, { initialRequest: request });
    await press(first, copy.send.review);
    await activate(first, HOLD);
    await act(async () => first.unmount());
    const again = await draw(client, { initialRequest: request });
    expect(meaning(again)).not.toContain(copy.send.paidAlready);
    await press(again, copy.send.review);
    expect(holds(again, HOLD)).toHaveLength(1);
    await act(async () => again.unmount());
  });

  test('a bare address may be paid again once its payment completes', async () => {
    const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const client = {
      prepareSend: jest.fn().mockResolvedValue(quote()),
      send: jest.fn().mockResolvedValue(outcome('completed')),
    };
    const first = await draw(client, { initialRequest: address });
    await enterAmount(first, '4200');
    await press(first, copy.send.review);
    await activate(first, HOLD);
    await act(async () => first.unmount());
    const again = await draw(client, { initialRequest: address });
    expect(meaning(again)).not.toContain(copy.send.paidAlready);
    await enterAmount(again, '4200');
    await press(again, copy.send.review);
    expect(holds(again, HOLD)).toHaveLength(1);
    await act(async () => again.unmount());
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
      { initialRequest: priced('busy-review'), onBusy },
    );
    onBusy.mockClear();
    // The review never lands, so the press is not waited on.
    await act(async () => {
      find(tree, copy.send.review)?.props.onPress();
    });
    expect(busyBefore(onBusy, prepareSend)).toBe(true);
    await act(async () => tree.unmount());
  });

  test('is let go once a slow quote outlasts its grace, and the quote still lands', async () => {
    jest.useFakeTimers();
    const onBusy = jest.fn();
    let fresh!: (value: SendReview) => void;
    const prepareSend = jest.fn(
      () =>
        new Promise<SendReview>(resolve => {
          fresh = resolve;
        }),
    );
    const tree = await draw(
      { prepareSend },
      { initialRequest: priced('slow-quote'), onBusy },
    );
    await act(async () => {
      find(tree, copy.send.review)?.props.onPress();
    });
    expect(onBusy).toHaveBeenLastCalledWith(true);
    await act(async () => jest.advanceTimersByTime(SEND_GRACE_MS));
    expect(onBusy).toHaveBeenLastCalledWith(false);
    await act(async () => fresh(quote()));
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('is held busy the moment the hold commits, before the payment goes out', async () => {
    const onBusy = jest.fn();
    const send = jest.fn(() => new Promise<SendResult>(() => {}));
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()), send },
      { initialRequest: priced('busy-send'), onBusy },
    );
    await press(tree, copy.send.review);
    onBusy.mockClear();
    await activate(tree, HOLD);
    expect(busyBefore(onBusy, send)).toBe(true);
    // Released as its grace runs out or as Send goes, never on the way into
    // busy.
    expect(onBusy).not.toHaveBeenCalledWith(false);
    await act(async () => tree.unmount());
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });
});

test('a balance going stale closes the gate, felt, said and logged, and a tap refreshes', async () => {
  const send = jest.fn();
  const onRefresh = jest.fn();
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()), send };
  const props = { initialRequest: priced('aging'), onRefresh };
  const tree = await draw(client, props);
  await press(tree, copy.send.review);
  expect(logged()).not.toContain('STALE');
  await arrive();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  await act(async () => {
    tree.update(screen(client, { ...props, disabled: true }));
  });
  expect(felt()).toContain('notificationWarning');
  expect(logged()).toContain('STALE');
  // The hold is gone; what is left under its label only refreshes, and a
  // screen reader lands on it before it hears why.
  expect(holds(tree, HOLD)).toEqual([]);
  await arrive();
  expect(focused()).toEqual([HOLD]);
  expect(said).not.toHaveBeenCalledWith(copy.send.stale, { assertive: true });
  await heard();
  expect(said).toHaveBeenCalledWith(copy.send.stale, { assertive: true });
  await press(tree, copy.send.sendSats(4_200));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  // Fresh again, the hold is back, and a screen reader lands on the amount
  // above it rather than on the hold itself.
  await act(async () => {
    tree.update(screen(client, { ...props, disabled: false }));
  });
  await arrive();
  expect(holds(tree, HOLD)).toHaveLength(1);
  expect(focused().at(-1)).toBe(copy.amount.spoken(4_200));
  await act(async () => tree.unmount());
});

test('a balance fresh again before its staleness is heard is not said stale', async () => {
  const client = { prepareSend: jest.fn().mockResolvedValue(quote()) };
  const props = { initialRequest: priced('blip') };
  const tree = await draw(client, props);
  await press(tree, copy.send.review);
  await arrive();
  await act(async () => {
    tree.update(screen(client, { ...props, disabled: true }));
  });
  // Felt and logged at once, as the gate closes.
  expect(felt()).toContain('notificationWarning');
  expect(logged()).toContain('STALE');
  await act(async () => {
    tree.update(screen(client, { ...props, disabled: false }));
  });
  await heard();
  expect(said).not.toHaveBeenCalledWith(copy.send.stale, { assertive: true });
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

  test('lands on the amount a review is for as it arrives, never on the hold, once in view', async () => {
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote()) },
      { initialRequest: priced('focus') },
    );
    await press(tree, copy.send.review);
    // Still rising into view: nothing is moved yet.
    expect(focused()).toEqual([]);
    await arrive();
    expect(focused()).toEqual([copy.amount.spoken(4_200)]);
    await act(async () => tree.unmount());
  });

  test('hears the whole review from the hold, warnings included, before one action pays', async () => {
    const warning = 'Paid as direct funding. Completes after one confirmation.';
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(
          quote({
            feeSats: 900,
            totalSats: 5_100,
            estimatedFeeSats: 300,
            warnings: [warning],
          }),
        ),
      },
      { initialRequest: priced('words') },
    );
    await press(tree, copy.send.review);
    const [hold] = holds(tree, HOLD);
    expect(hold.props.accessibilityValue.text).toBe(
      [
        `${copy.send.totalAtMost} ${copy.amount.spoken(5_100)}.`,
        `Maximum fee ${copy.amount.spoken(900)}.`,
        `${copy.send.expectedFee} ${copy.send.about(300)}.`,
        warning,
        copy.send.quoteExpires(60),
      ].join(' '),
    );
    // A double tap commits it on iOS as the action does on Android.
    expect(typeof hold.props.onAccessibilityTap).toBe('function');
    await act(async () => tree.unmount());
  });

  test('lands on the refresh as a quote runs out, then hears it has', async () => {
    jest.useFakeTimers();
    const expiresAt = Date.now() + 5_000;
    const tree = await draw(
      { prepareSend: jest.fn().mockResolvedValue(quote({ expiresAt })) },
      { initialRequest: priced('focus-expiry') },
    );
    await press(tree, copy.send.review);
    await arrive(true);
    // To the moment it runs out, and not past it.
    await act(async () => jest.advanceTimersByTime(expiresAt - Date.now()));
    expect(find(tree, copy.send.refreshQuote)).toBeDefined();
    expect(said).not.toHaveBeenCalledWith(copy.send.quoteExpired, {
      assertive: true,
    });
    await arrive(true);
    expect(focused().at(-1)).toBe(copy.send.refreshQuote);
    expect(said).not.toHaveBeenCalledWith(copy.send.quoteExpired, {
      assertive: true,
    });
    await heard(true);
    expect(said).toHaveBeenLastCalledWith(copy.send.quoteExpired, {
      assertive: true,
    });
    await act(async () => tree.unmount());
  });

  test('lands on the amount back in compose, from an edit and from a retry', async () => {
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockResolvedValue(outcome('failed')),
      },
      { initialRequest: priced('focus-back') },
    );
    await press(tree, copy.send.review);
    await press(tree, copy.send.edit);
    await arrive();
    expect(focused().at(-1)).toBe(copy.amount.field);
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    await arrive();
    expect(focused().at(-1)).toBe(copy.send.failed);
    await press(tree, copy.send.failed);
    await arrive();
    expect(focused().at(-1)).toBe(copy.amount.field);
    await act(async () => tree.unmount());
  });

  test('moves to an unknown result before it is told, so the telling is heard whole', async () => {
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockResolvedValue(outcome('uncertain')),
      },
      { initialRequest: priced('focus-unknown') },
    );
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    await arrive();
    expect(focused().at(-1)).toBe(copy.send.unknown);
    expect(said).not.toHaveBeenCalledWith(copy.send.heldAnnouncement, {
      assertive: true,
    });
    await heard();
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

describe('a completed payment', () => {
  /** A payment that completes, under fake timers, with `onDone` to watch. */
  async function completed(props: Props = {}) {
    jest.useFakeTimers();
    const onDone = jest.fn();
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockResolvedValue(outcome('completed')),
      },
      { initialRequest: priced('home'), onDone, ...props },
    );
    await press(tree, copy.send.review);
    await activate(tree, HOLD);
    expect(meaning(tree)).toContain(copy.send.sent);
    return { tree, onDone };
  }
  const later = () => act(async () => jest.advanceTimersByTime(10_000));

  test('stays while a screen reader is running, which reaches it a swipe at a time', async () => {
    jest
      .mocked(AccessibilityInfo.isScreenReaderEnabled)
      .mockResolvedValueOnce(true);
    const { tree, onDone } = await completed();
    await later();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('stays once a screen reader is turned on while it waits', async () => {
    const { tree, onDone } = await completed();
    const [turned] = jest
      .mocked(AccessibilityInfo.addEventListener)
      .mock.calls.filter(([event]) => event === 'screenReaderChanged')
      .map(([, listener]) => listener as (on: boolean) => void)
      .slice(-1);
    await act(async () => turned(true));
    await later();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('stays once anything in it takes focus', async () => {
    const { tree, onDone } = await completed();
    await act(async () => {
      tree.root
        .findAll(node => typeof node.props.onFocus === 'function')[0]
        .props.onFocus();
    });
    await later();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('otherwise goes home on its own', async () => {
    const { tree, onDone } = await completed();
    await later();
    expect(onDone).toHaveBeenCalledTimes(1);
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
    { initialRequest: priced('second-go'), onDone },
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
