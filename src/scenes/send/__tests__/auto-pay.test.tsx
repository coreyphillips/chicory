import React, { createRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import HapticFeedback from 'react-native-haptic-feedback';
import type {
  SendResult,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
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
import type { WalletAdapter } from '../../../services/wallet';
import {
  clearHeldRequests,
  heldRequest,
  holdRequest,
} from '../../../stage/heldRequests';
import { Pane } from '../../../stage/panes/Pane';
import {
  activate,
  holds,
  meaning,
  press,
} from '../../../../test-support/query';
import { stepInMs } from '../useLanding';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * Settings > Auto-pay on Send (REDESIGN.md rule 5): a Lightning code the
 * camera read, naming its amount, is reviewed on its own and pays as its
 * review lands when its whole debit is within the share of what can be
 * sent. Anything else is reviewed and held as before, and nothing that came
 * by a link, a paste or typing ever pays itself.
 */

/** 24,425 sats. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const OPEN_INVOICE =
  'lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqlvhfca';
const BITCOIN =
  'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00024425';

const said = jest.mocked(announce);
const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);

const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-auto',
  destination: 'recipient',
  description: '',
  amountSats: 24_425,
  feeSats: 35,
  feeLabel: 'Maximum fee',
  totalSats: 24_460,
  route: 'lightning',
  expiresAt: Date.now() + 60_000,
  warnings: [],
  ...over,
});

const completed: SendResult = {
  id: 'p-auto',
  status: 'completed',
  amountSats: 24_425,
  feeSats: 12,
  message: 'The payment completed.',
};

/** What can be sent: 24,460 is under half of it. */
const balance = (availableSats = 100_000) =>
  ({
    totalSats: availableSats,
    availableSats,
    pendingSats: 0,
    receivableSats: 0,
  } as WalletSnapshot['balance']);

/** The hold of the 24,425 sats every review here is for. */
const HOLD = copy.send.sendSats(24_425);

function client(over: Partial<Record<'prepareSend' | 'send', jest.Mock>> = {}) {
  return {
    prepareSend: jest.fn().mockResolvedValue(quote()),
    send: jest.fn().mockResolvedValue(completed),
    quoteMax: jest.fn().mockRejectedValue(new Error('No max here.')),
    ...over,
  };
}

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

function screen(wallet: object, props: Props = {}, live = true) {
  return (
    <GestureHandlerRootView>
      <Pane active={live}>
        <SendScreen
          client={wallet as WalletAdapter}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={jest.fn()}
          balance={balance()}
          {...props}
        />
      </Pane>
    </GestureHandlerRootView>
  );
}

async function draw(wallet: object, props: Props = {}, live = true) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screen(wallet, props, live));
  });
  return tree;
}

/** Lets a step rise into view, and what waits for it play. */
const arrive = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, stepInMs() + 50));
  });

const on = (share = 50) => setAutoPayPreference({ on: true, share });

beforeEach(async () => {
  forgetSafety();
  forgetPendingHaptics();
  clearHeldRequests();
  said.mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
  await setAutoPayPreference(AUTO_PAY_OFF);
});
afterEach(async () => {
  await setAutoPayPreference(AUTO_PAY_OFF);
});

describe('off, as it is until it is switched on', () => {
  test('a scanned invoice is reviewed only when asked, and paid only when held', async () => {
    const wallet = client();
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await press(tree, copy.send.review);
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, HOLD)).toHaveLength(1);
    await activate(tree, HOLD);
    expect(wallet.send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
});

describe('on, at 50%', () => {
  beforeEach(() => on(50));

  test('a scanned invoice within the share is reviewed and paid with no hold', async () => {
    const wallet = client();
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.prepareSend).toHaveBeenCalledWith({
      request: INVOICE,
      amountSats: undefined,
    });
    expect(wallet.send).toHaveBeenCalledTimes(1);
    expect(wallet.send).toHaveBeenCalledWith(
      quote({ expiresAt: expect.any(Number) }),
    );
    // Said once a screen reader has landed on the review's amount.
    await arrive();
    expect(said).toHaveBeenCalledWith(copy.send.autoPaying(24_425));
    // Held as it went out, as a held payment is, so it is never paid twice.
    expect(heldRequest(INVOICE)).toEqual({ status: 'completed' });
    expect(meaning(tree)).toContain(copy.send.sent);
    await act(async () => tree.unmount());
  });

  test('the hold plays its complete for the payer once the review has risen in', async () => {
    const wallet = client({
      send: jest.fn(() => new Promise<SendResult>(() => {})),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.send).toHaveBeenCalledTimes(1);
    expect(felt()).not.toContain('impactMedium');
    await arrive();
    expect(felt()).toContain('impactMedium');
    await act(async () => tree.unmount());
  });

  test('a code the Send scanned for itself pays the same way', async () => {
    const wallet = client();
    const ref = createRef<SendHandle>();
    const tree = await draw(wallet, { ref });
    await act(async () => ref.current?.receive(INVOICE, true));
    expect(wallet.send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('waits for Send to be in front before it pays', async () => {
    const wallet = client();
    const props = { initialRequest: INVOICE, scanned: true };
    const tree = await draw(wallet, props, false);
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.update(screen(wallet, props, true)));
    expect(wallet.send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a debit over the share waits for the hold, counting the fee cap', async () => {
    const wallet = client({
      prepareSend: jest
        .fn()
        .mockResolvedValue(
          quote({ amountSats: 49_990, feeSats: 20, totalSats: 50_010 }),
        ),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, copy.send.sendSats(49_990))).toHaveLength(1);
    await activate(tree, copy.send.sendSats(49_990));
    expect(wallet.send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a warning keeps the hold', async () => {
    const wallet = client({
      prepareSend: jest
        .fn()
        .mockResolvedValue(quote({ warnings: ['The route is costly.'] })),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('a review the engine answers already expired never pays', async () => {
    const wallet = client({
      prepareSend: jest
        .fn()
        .mockResolvedValue(quote({ expiresAt: Date.now() - 1 })),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a review the engine refuses pays nothing, and a later review waits for the hold', async () => {
    const refused = Object.assign(new Error('No route.'), { code: 'NO_ROUTE' });
    const wallet = client({
      prepareSend: jest
        .fn()
        .mockRejectedValueOnce(refused)
        .mockResolvedValue(quote()),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.send).not.toHaveBeenCalled();
    await press(tree, copy.send.review);
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('a review edited back to compose and reviewed again waits for the hold', async () => {
    const wallet = client({
      prepareSend: jest
        .fn()
        .mockResolvedValue(quote({ warnings: ['The route is costly.'] })),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    await press(tree, copy.send.edit);
    wallet.prepareSend.mockResolvedValue(quote());
    await press(tree, copy.send.review);
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a request held already is never prepared or paid', async () => {
    holdRequest(INVOICE, { status: 'pending' });
    const wallet = client();
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    expect(wallet.send).not.toHaveBeenCalled();
    expect(meaning(tree)).toContain(copy.send.onItsWay);
    await act(async () => tree.unmount());
  });

  test('a balance too old to spend against pays nothing, even once it is fresh', async () => {
    const wallet = client();
    const props = { initialRequest: INVOICE, scanned: true };
    const tree = await draw(wallet, { ...props, disabled: true });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.update(screen(wallet, props)));
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('while the wallet opens it waits for the live read, then judges by it', async () => {
    const wallet = client();
    const props = { initialRequest: INVOICE, scanned: true };
    const tree = await draw(wallet, { ...props, opening: true });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    // The live read finds less than the saved figures said: 24,460 is now
    // over half of what can be sent.
    await act(async () =>
      tree.update(screen(wallet, { ...props, balance: balance(40_000) })),
    );
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.send).not.toHaveBeenCalled();
    expect(holds(tree, HOLD)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('a scanned invoice is not paid on a balance it cannot be measured against', async () => {
    const wallet = client();
    const tree = await draw(wallet, {
      initialRequest: INVOICE,
      scanned: true,
      balance: undefined,
    });
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('never paid on its own, whatever the share', () => {
  beforeEach(() => on(100));

  test('an invoice a link brought', async () => {
    const wallet = client();
    const tree = await draw(wallet, { initialRequest: INVOICE });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('an invoice handed to Send without the camera', async () => {
    const wallet = client();
    const ref = createRef<SendHandle>();
    const tree = await draw(wallet, { ref });
    await act(async () => ref.current?.receive(INVOICE));
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('an invoice pasted', async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(INVOICE);
    const wallet = client();
    const tree = await draw(wallet);
    await press(tree, copy.send.paste);
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('an invoice that leaves the amount to the payer', async () => {
    const wallet = client();
    const tree = await draw(wallet, {
      initialRequest: OPEN_INVOICE,
      scanned: true,
    });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a Bitcoin request, though it names its amount', async () => {
    const wallet = client({
      prepareSend: jest.fn().mockResolvedValue(quote({ route: 'bitcoin' })),
    });
    const tree = await draw(wallet, { initialRequest: BITCOIN, scanned: true });
    expect(wallet.prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a scanned invoice the engine routes on chain', async () => {
    const wallet = client({
      prepareSend: jest.fn().mockResolvedValue(quote({ route: 'bitcoin' })),
    });
    const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
    expect(wallet.prepareSend).toHaveBeenCalledTimes(1);
    expect(wallet.send).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

test('at 0% nothing pays itself', async () => {
  await on(0);
  const wallet = client();
  const tree = await draw(wallet, { initialRequest: INVOICE, scanned: true });
  expect(wallet.send).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
