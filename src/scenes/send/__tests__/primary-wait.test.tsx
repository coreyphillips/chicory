import React, { createRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import type { SendReview, WalletSnapshot } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { forgetPendingHaptics } from '../../../design/haptics';
import { forgetSafety } from '../../../motion/speech';
import { SendScreen } from '../../../screens/Send';
import type { SendHandle } from '../../../screens/Send';
import {
  AUTO_PAY_OFF,
  setAutoPayPreference,
} from '../../../services/autoPayPreference';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { Pane } from '../../../stage/panes/Pane';
import { find, holds, meaning, press } from '../../../../test-support/query';
import { usePrimaryExpected } from '../../home/signals';
import { PRIMARY_RETRY_MS, PRIMARY_WAIT_MS } from '../model';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * A review asked for while the primary is on its way back (REDESIGN.md 6,
 * Engine errors): the wallet reconnects by itself as it opens or returns to
 * the front, and a payer who has just tapped a terminal should not be told
 * to try again for a wait of seconds. The review waits, busy, and is asked
 * for again until the primary is back or its wait is up. Nothing is paid by
 * the wait.
 */

/** 24,425 sats. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const OTHER =
  'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00024425';
const HOLD = copy.send.sendSats(24_425);
/** What the engine says of a primary that is away. */
const AWAY =
  'Your primary node needs to reconnect before this wallet can send over Lightning. It retries by itself, so try again in a minute.';

const said = jest.mocked(announce);
const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const away = () => coded('PRIMARY_DOWN', AWAY);

const quote: SendReview = {
  id: 'review-waited',
  destination: 'recipient',
  description: '',
  amountSats: 24_425,
  feeSats: 35,
  feeLabel: 'Maximum fee',
  totalSats: 24_460,
  route: 'lightning',
  expiresAt: Date.now() + 600_000,
  warnings: [],
};

const balance = {
  totalSats: 100_000,
  availableSats: 100_000,
  pendingSats: 0,
  receivableSats: 0,
} as WalletSnapshot['balance'];

/** A wallet whose primary is away for the first `refusals` asks. */
function client(refusals: number, then: () => Promise<SendReview>) {
  const prepareSend = jest.fn();
  for (let i = 0; i < refusals; i += 1)
    prepareSend.mockRejectedValueOnce(away());
  prepareSend.mockImplementation(then);
  return {
    prepareSend,
    send: jest.fn().mockResolvedValue({
      id: 'p-waited',
      status: 'completed',
      amountSats: 24_425,
      feeSats: 12,
      message: 'The payment completed.',
    }),
    quoteMax: jest.fn().mockRejectedValue(new Error('No max here.')),
  };
}

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

function screen(wallet: object, props: Props = {}) {
  return (
    <GestureHandlerRootView>
      <Pane active>
        <SendScreen
          client={wallet as WalletAdapter}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={jest.fn()}
          balance={balance}
          initialRequest={INVOICE}
          primaryExpected
          {...props}
        />
      </Pane>
    </GestureHandlerRootView>
  );
}

async function draw(wallet: object, props: Props = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screen(wallet, props));
  });
  return tree;
}

/** The review control, whether or not it can be pressed. */
const control = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityLabel === copy.send.review,
  )[0];

/** Whether the review control is drawn and told busy. */
const busy = (tree: ReactTestRenderer) =>
  control(tree).props.accessibilityState?.busy === true;

const past = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/**
 * Lets `asks` more asks go out and come back, one at a time: each is made
 * only once the one before it has answered.
 */
async function asksGoBy(asks: number) {
  for (let i = 0; i < asks; i += 1) await past(PRIMARY_RETRY_MS);
}

beforeEach(async () => {
  jest.useFakeTimers();
  forgetSafety();
  forgetPendingHaptics();
  clearHeldRequests();
  clearDiagnostics();
  said.mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
  await setAutoPayPreference(AUTO_PAY_OFF);
});
afterEach(async () => {
  jest.useRealTimers();
  await setAutoPayPreference(AUTO_PAY_OFF);
});

describe('a review asked for while the primary is on its way back', () => {
  test('waits, busy, says so once, and is made as the primary returns', async () => {
    const wallet = client(2, async () => quote);
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    // No refusal: nothing is felt, nothing is drawn of one, and the control
    // is busy and says what it waits for.
    expect(meaning(tree)).not.toContain(AWAY);
    expect(felt()).toEqual([]);
    expect(busy(tree)).toBe(true);
    expect(control(tree).props.accessibilityHint).toBe(
      copy.send.awaitingPrimary,
    );
    expect(find(tree, copy.send.review)).toBeUndefined();
    expect(said.mock.calls.map(([words]) => words)).toEqual([
      copy.send.awaitingPrimary,
    ]);
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({ code: 'PRIMARY_AWAITED' }),
    );

    // Asked again, and refused again: it goes on waiting, and says no more.
    await past(PRIMARY_RETRY_MS);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(2);
    expect(busy(tree)).toBe(true);
    expect(meaning(tree)).not.toContain(AWAY);
    expect(said).toHaveBeenCalledTimes(1);

    // The primary is back: the review is made, and waits for its hold.
    await past(PRIMARY_RETRY_MS);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(3);
    expect(holds(tree, HOLD)).toHaveLength(1);
    expect(wallet.send).not.toHaveBeenCalled();
    // Nothing more is asked once it is made.
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(3);
    await act(async () => tree.unmount());
  });

  test('is refused as before once its wait is up, and can be asked for again', async () => {
    const wallet = client(0, async () => {
      throw away();
    });
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    const asks = PRIMARY_WAIT_MS / PRIMARY_RETRY_MS;
    await asksGoBy(asks - 1);
    expect(busy(tree)).toBe(true);
    expect(meaning(tree)).not.toContain(AWAY);
    expect(felt()).toEqual([]);

    await asksGoBy(1);
    // The refusal the engine gave, where it has always been shown.
    expect(meaning(tree)).toContain(AWAY);
    expect(felt()).toHaveLength(1);
    expect(busy(tree)).toBe(false);
    expect(find(tree, copy.send.review)).toBeDefined();
    expect(recentDiagnostics()).toContainEqual(
      expect.objectContaining({ code: 'PRIMARY_DOWN', message: AWAY }),
    );
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1 + asks);
    // And nothing goes on asking behind it.
    await asksGoBy(asks);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1 + asks);
    await act(async () => tree.unmount());
  });

  test('shows another refusal as it comes', async () => {
    const wallet = client(1, async () => {
      throw coded('NO_ROUTE', 'No route was found.');
    });
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    expect(busy(tree)).toBe(true);
    await past(PRIMARY_RETRY_MS);
    expect(meaning(tree)).toContain('No route was found.');
    expect(busy(tree)).toBe(false);
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
  });

  test('stops waiting once the primary is no longer expected', async () => {
    const wallet = client(0, async () => {
      throw away();
    });
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    expect(busy(tree)).toBe(true);
    // The canvas has now seen the primary away for as long as it gives it.
    await act(async () =>
      tree.update(screen(wallet, { primaryExpected: false })),
    );
    await past(PRIMARY_RETRY_MS);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(2);
    expect(meaning(tree)).toContain(AWAY);
    expect(busy(tree)).toBe(false);
    await act(async () => tree.unmount());
  });

  test('is still the request Send is on, so its tag read again changes nothing', async () => {
    const wallet = client(0, async () => {
      throw away();
    });
    const ref = createRef<SendHandle>();
    const tree = await draw(wallet, { ref });
    await press(tree, copy.send.review);
    expect(ref.current?.holds(`lightning:${INVOICE.toUpperCase()}`)).toBe(true);
    await act(async () => tree.unmount());
  });
});

describe('the wait for the primary ends', () => {
  const never = () =>
    client(0, async () => {
      throw away();
    });

  test('as another request is taken', async () => {
    const wallet = never();
    const ref = createRef<SendHandle>();
    const tree = await draw(wallet, { ref });
    await press(tree, copy.send.review);
    expect(busy(tree)).toBe(true);
    await act(async () => {
      ref.current?.receive(OTHER, false);
    });
    expect(busy(tree)).toBe(false);
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(meaning(tree)).not.toContain(AWAY);
    await act(async () => tree.unmount());
  });

  test('as Send leaves, and is not waiting if the stage comes back to it', async () => {
    const wallet = never();
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    await act(async () => tree.update(screen(wallet, { leaving: true })));
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(screen(wallet, { leaving: false })));
    expect(busy(tree)).toBe(false);
    expect(meaning(tree)).not.toContain(AWAY);
    await act(async () => tree.unmount());
  });

  test('as the balance goes too old to spend against, with the refresh the gated control asks for', async () => {
    const wallet = never();
    const onRefresh = jest.fn();
    const tree = await draw(wallet, { onRefresh });
    await press(tree, copy.send.review);
    expect(busy(tree)).toBe(true);
    await act(async () =>
      tree.update(screen(wallet, { onRefresh, disabled: true })),
    );
    expect(onRefresh).not.toHaveBeenCalled();
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(busy(tree)).toBe(false);
    expect(control(tree).props.accessibilityHint).toBe(copy.send.stale);
    expect(meaning(tree)).not.toContain(AWAY);
    await act(async () => tree.unmount());
  });

  test('as Send is closed', async () => {
    const wallet = never();
    const tree = await draw(wallet);
    await press(tree, copy.send.review);
    await act(async () => tree.unmount());
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
  });
});

describe('a primary that is not expected back', () => {
  test('refuses the review at once, as it always has', async () => {
    const wallet = client(0, async () => {
      throw away();
    });
    const tree = await draw(wallet, { primaryExpected: false });
    await press(tree, copy.send.review);
    expect(meaning(tree)).toContain(AWAY);
    expect(felt()).toHaveLength(1);
    expect(busy(tree)).toBe(false);
    await asksGoBy(3);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
});

describe('Auto-pay', () => {
  test('pays nothing by itself after a wait: the review that comes is held', async () => {
    await setAutoPayPreference({ on: true, share: 100 });
    const wallet = client(1, async () => quote);
    // The camera read it, so the review is asked for with no press.
    const tree = await draw(wallet, { scanned: true });
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(busy(tree)).toBe(true);
    await past(PRIMARY_RETRY_MS);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(2);
    await asksGoBy(3);
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});

describe('whether a primary that is away is expected back', () => {
  let expected = false;
  const Probe = ({
    connected,
    coming,
  }: {
    connected: boolean;
    coming: boolean;
  }) => {
    expected = usePrimaryExpected(connected, coming);
    return null;
  };
  const show = (connected: boolean, coming = false) =>
    React.createElement(Probe, { connected, coming });

  test('it is for PRIMARY_WAIT_MS from when it was seen away, with the wallet up', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(show(true));
    });
    expect(expected).toBe(true);
    await past(PRIMARY_WAIT_MS * 2);
    expect(expected).toBe(true);

    // It goes: expected back for a while, then not.
    await act(async () => tree.update(show(false)));
    expect(expected).toBe(true);
    await past(PRIMARY_WAIT_MS - 1);
    expect(expected).toBe(true);
    await past(1);
    expect(expected).toBe(false);

    // Back, and gone again: the count starts over.
    await act(async () => tree.update(show(true)));
    expect(expected).toBe(true);
    await act(async () => tree.update(show(false)));
    await past(PRIMARY_WAIT_MS - 1);
    expect(expected).toBe(true);
    await act(async () => tree.unmount());
  });

  test('a wallet still opening has seen nothing of it yet, however long that takes', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(show(false, true));
    });
    await past(PRIMARY_WAIT_MS * 3);
    expect(expected).toBe(true);
    // The wallet is up: the count starts from here.
    await act(async () => tree.update(show(false, false)));
    await past(PRIMARY_WAIT_MS - 1);
    expect(expected).toBe(true);
    await past(1);
    expect(expected).toBe(false);
    await act(async () => tree.unmount());
  });
});
