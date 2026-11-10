import React from 'react';
import { TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type { SendReview } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { SendScreen } from '../../../screens/Send';
import { Commit } from '../Commit';
import { setAutoPayPreference } from '../../../services/autoPayPreference';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import {
  LOOKUP_DEADLINE_MS,
  LookupError,
  setPaymentListLookup,
} from '../../../services/paykit';
import type { PaymentEndpoint } from '../../../services/paykit';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests, holdRequest } from '../../../stage/heldRequests';
import { enterAmount } from '../../../../test-support/keypad';
import {
  activate,
  alerts,
  find,
  holds,
  press,
  pressableLabels,
} from '../../../../test-support/query';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * A pubky in Send (REDESIGN.md 6, Send), with the lookup stubbed at its
 * interface: it is taken as a chip, looked up, and paid through the request
 * of the endpoint chosen, by the same review, hold and held set as any other.
 */
const KEY = '5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
/** 24,425 sats, and one naming no amount; both stamped at zero, for an hour. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const OPEN_INVOICE =
  'lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqlvhfca';
/** BOLT 11's 2500u vector, which ran out in 2017. */
const EXPIRED =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';
/** Inside the hour the zero-stamped invoices run for. */
const NOW = 1_000_000;

const endpoint = (identifier: string, payload: string): PaymentEndpoint => ({
  appId: 'bitkit',
  identifier,
  payload,
});
const LIGHTNING = endpoint('btc-lightning-bolt11', INVOICE);
const OPEN = endpoint('btc-lightning-bolt11', OPEN_INVOICE);
const ONCHAIN = endpoint('btc-bitcoin-p2wpkh', ADDRESS);

const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-pubky',
  destination: 'recipient',
  description: '',
  amountSats: 24_425,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  totalSats: 24_445,
  route: 'lightning',
  expiresAt: NOW + 600_000,
  warnings: [],
  ...over,
});

const said = jest.mocked(announce);
const logged = () => recentDiagnostics().map(entry => entry.code);
const coded = (code: string) => Object.assign(new Error(code), { code });

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

async function draw(client: object = {}, props: Props = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <SendScreen
          client={client as WalletAdapter}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={jest.fn()}
          {...props}
        />
      </GestureHandlerRootView>,
    );
  });
  return tree;
}

const well = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(TextInput)
    .find(node => node.props.accessibilityLabel === copy.send.request);
const chip = (tree: ReactTestRenderer) =>
  well(tree) ? undefined : find(tree, copy.send.request);
const chipSays = (tree: ReactTestRenderer) =>
  chip(tree)?.props.accessibilityValue?.text as string | undefined;

/** A lookup the test answers when it chooses to. */
function deferred() {
  let resolve!: (list: PaymentEndpoint[]) => void;
  let reject!: (error: unknown) => void;
  const lookup = jest.fn(
    () =>
      new Promise<PaymentEndpoint[]>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  setPaymentListLookup(lookup);
  return {
    lookup,
    resolve: (list: PaymentEndpoint[]) => act(async () => resolve(list)),
    reject: (error: unknown) => act(async () => reject(error)),
  };
}

const answers = (list: PaymentEndpoint[]) => {
  const lookup = jest.fn().mockResolvedValue(list);
  setPaymentListLookup(lookup);
  return lookup;
};

let now: jest.SpyInstance;
beforeEach(() => {
  now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  clearHeldRequests();
  clearDiagnostics();
  said.mockClear();
});
afterEach(async () => {
  now.mockRestore();
  setPaymentListLookup(null);
  await setAutoPayPreference({ on: false, share: 50 });
});

describe('a pubky as it enters Send', () => {
  test.each([KEY, `pubky${KEY}`, `pubky://${KEY}`])(
    'pasted as %s it is a chip, looked up by its key',
    async text => {
      const { lookup, resolve } = deferred();
      jest.mocked(Clipboard.getString).mockResolvedValueOnce(` ${text}\n`);
      const tree = await draw();
      await press(tree, copy.send.paste);
      expect(chip(tree)).toBeDefined();
      expect(alerts(tree)).toEqual([]);
      expect(lookup).toHaveBeenCalledWith(KEY);
      expect(chipSays(tree)).toBe(copy.send.pubkyLooking);
      expect(logged()).toContain('PUBKY_LOOKUP');
      await resolve([LIGHTNING]);
      expect(chipSays(tree)).toContain('Lightning');
      expect(logged()).toContain('PUBKY_RESOLVED');
      await act(async () => tree.unmount());
    },
  );

  test('typed and left, and brought as a prefill by a scan from home, it is looked up', async () => {
    const lookup = answers([LIGHTNING]);
    const typed = await draw();
    await act(async () => well(typed)!.props.onChangeText(KEY));
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => well(typed)!.props.onBlur());
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(chip(typed)).toBeDefined();
    await act(async () => typed.unmount());

    const scanned = await draw({}, { initialRequest: KEY, scanned: true });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(chip(scanned)).toBeDefined();
    expect(alerts(scanned)).toEqual([]);
    await act(async () => scanned.unmount());
  });

  test('a request the parser takes is never looked up', async () => {
    const lookup = answers([LIGHTNING]);
    const tree = await draw({}, { initialRequest: ADDRESS });
    expect(chip(tree)).toBeDefined();
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('a pubky that publishes something to pay', () => {
  test('an invoice naming its amount locks it, is reviewed with the pubky said, and is paid through the hold', async () => {
    answers([ONCHAIN, LIGHTNING]);
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const send = jest.fn().mockResolvedValue({
      id: 'review-pubky',
      status: 'completed',
      amountSats: 24_425,
      feeSats: 3,
    });
    const tree = await draw({ prepareSend, send }, { initialRequest: KEY });
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledWith(
      expect.objectContaining({ request: INVOICE, amountSats: undefined }),
    );
    // Nothing is paid before the hold, which says the pubky and what is paid.
    expect(send).not.toHaveBeenCalled();
    expect(holds(tree, copy.send.sendSats(24_425))).toHaveLength(1);
    const words = tree.root.findByType(Commit).props.summary as string;
    expect(chipSays(tree)).toContain('Pubky');
    expect(chipSays(tree)).toContain('Lightning');
    expect(chipSays(tree)).toContain('cannot verify');
    expect(words).toContain(chipSays(tree));
    await activate(tree, copy.send.sendSats(24_425));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('an invoice naming no amount takes the keyed one', async () => {
    answers([OPEN]);
    const prepareSend = jest
      .fn()
      .mockResolvedValue(quote({ amountSats: 4_200 }));
    const tree = await draw({ prepareSend }, { initialRequest: KEY });
    await enterAmount(tree, '4200');
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledWith(
      expect.objectContaining({ request: OPEN_INVOICE, amountSats: 4_200 }),
    );
    await act(async () => tree.unmount());
  });

  test('when Lightning cannot carry the amount the address is reviewed instead', async () => {
    answers([OPEN, ONCHAIN]);
    const prepareSend = jest
      .fn()
      .mockRejectedValueOnce(coded('NO_ROUTE'))
      .mockResolvedValueOnce(quote({ amountSats: 4_200, route: 'bitcoin' }));
    const tree = await draw({ prepareSend }, { initialRequest: KEY });
    await enterAmount(tree, '4200');
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenLastCalledWith({
      request: ADDRESS,
      amountSats: 4_200,
    });
    expect(holds(tree, copy.send.sendSats(4_200))).toHaveLength(1);
    expect(chipSays(tree)).toContain('Bitcoin');
    expect(logged()).toContain('PUBKY_FELL_BACK');
    await act(async () => tree.unmount());
  });

  test('an expired invoice beside an address resolves to the address', async () => {
    now.mockReturnValue(1_700_000_000_000);
    answers([endpoint('btc-lightning-bolt11', EXPIRED), ONCHAIN]);
    const prepareSend = jest
      .fn()
      .mockResolvedValue(
        quote({
          amountSats: 4_200,
          route: 'bitcoin',
          expiresAt: 1_700_000_600_000,
        }),
      );
    const tree = await draw({ prepareSend }, { initialRequest: KEY });
    expect(chipSays(tree)).toContain('Bitcoin');
    await enterAmount(tree, '4200');
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledTimes(1);
    expect(prepareSend).toHaveBeenCalledWith(
      expect.objectContaining({ request: ADDRESS }),
    );
    await act(async () => tree.unmount());
  });

  test('rule 6: one whose resolved request is held lands on the held ring, with no review', async () => {
    holdRequest(INVOICE, { status: 'uncertain' });
    answers([LIGHTNING]);
    const prepareSend = jest.fn();
    const tree = await draw({ prepareSend }, { initialRequest: KEY });
    expect(holds(tree, copy.send.sendSats(24_425))).toHaveLength(0);
    expect(logged()).toContain('HELD');
    expect(find(tree, copy.send.review)).toBeUndefined();
    expect(prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('rule 5: with Auto-pay on, a scanned pubky waits for its hold', async () => {
    await setAutoPayPreference({ on: true, share: 100 });
    answers([LIGHTNING]);
    const prepareSend = jest.fn().mockResolvedValue(quote());
    const send = jest.fn();
    const tree = await draw(
      { prepareSend, send },
      {
        initialRequest: KEY,
        scanned: true,
        balance: {
          availableSats: 1_000_000,
          pendingSats: 0,
          totalSats: 1_000_000,
        } as never,
      },
    );
    // Not reviewed on its own, and not paid once it is reviewed by hand.
    expect(prepareSend).not.toHaveBeenCalled();
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(holds(tree, copy.send.sendSats(24_425))).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});

describe('a lookup that never reaches a review', () => {
  const ends: Array<[string, PaymentEndpoint[] | Error, string, string]> = [
    ['nothing published', [], copy.send.pubkyEmpty, 'PUBKY_NO_ENDPOINTS'],
    [
      'nothing this wallet can pay',
      [
        endpoint('btc-lightning-bolt12', 'lno1qcp4256ypq'),
        endpoint('btc-regtest-p2wpkh', ADDRESS),
      ],
      copy.send.pubkyNotPayable,
      'PUBKY_NOT_PAYABLE',
    ],
    [
      'a failed lookup',
      new LookupError('LOOKUP_FAILED', 'unreachable'),
      copy.send.pubkyLookupFailed,
      'PUBKY_LOOKUP_FAILED',
    ],
  ];

  test.each(ends)('%s has its own state', async (_, answer, words, code) => {
    setPaymentListLookup(
      answer instanceof Error
        ? jest.fn().mockRejectedValue(answer)
        : jest.fn().mockResolvedValue(answer),
    );
    const prepareSend = jest.fn();
    const tree = await draw({ prepareSend }, { initialRequest: KEY });
    expect(well(tree)!.props.value).toBe(KEY);
    expect(alerts(tree)).toEqual([words]);
    expect(said).toHaveBeenCalledWith(words, { assertive: true });
    expect(logged()).toContain(code);
    // With an amount keyed the review still cannot be pressed.
    await enterAmount(tree, '4200');
    expect(pressableLabels(tree).has(copy.send.review)).toBe(false);
    expect(holds(tree, copy.send.sendSats(4_200))).toHaveLength(0);
    expect(prepareSend).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('no answer in time ends as a failed lookup, and leaving the well tries again', async () => {
    jest.useFakeTimers();
    try {
      const lookup = jest.fn(() => new Promise<PaymentEndpoint[]>(() => {}));
      setPaymentListLookup(lookup);
      const tree = await draw({}, { initialRequest: KEY });
      expect(alerts(tree)).toEqual([]);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(LOOKUP_DEADLINE_MS);
      });
      expect(alerts(tree)).toEqual([copy.send.pubkyLookupFailed]);
      expect(logged()).toContain('LOOKUP_TIMEOUT');
      expect(logged()).not.toContain('PUBKY_NO_ENDPOINTS');
      await act(async () => well(tree)!.props.onBlur());
      expect(lookup).toHaveBeenCalledTimes(2);
      await act(async () => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  test('an answer for a request since changed, or for a Send that has left, is dropped', async () => {
    const first = deferred();
    const tree = await draw({}, { initialRequest: KEY });
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(ADDRESS);
    // The chip opens, and another request is pasted over the lookup.
    await act(async () => chip(tree)!.props.onPress());
    await press(tree, copy.send.paste);
    await first.resolve([LIGHTNING]);
    expect(chipSays(tree)).not.toContain('Pubky');
    expect(logged()).not.toContain('PUBKY_RESOLVED');
    await act(async () => tree.unmount());

    const second = deferred();
    const leaving = await draw({}, { initialRequest: KEY });
    await act(async () =>
      leaving.update(
        <GestureHandlerRootView>
          <SendScreen
            client={{} as WalletAdapter}
            onActivity={jest.fn()}
            onRefresh={jest.fn()}
            onBusy={jest.fn()}
            initialRequest={KEY}
            leaving
          />
        </GestureHandlerRootView>,
      ),
    );
    await second.reject(new LookupError('LOOKUP_FAILED', 'late'));
    expect(alerts(leaving)).toEqual([]);
    expect(logged()).not.toContain('PUBKY_LOOKUP_FAILED');
    // Back on the stage, it asks again rather than waiting on that answer.
    await act(async () =>
      leaving.update(
        <GestureHandlerRootView>
          <SendScreen
            client={{} as WalletAdapter}
            onActivity={jest.fn()}
            onRefresh={jest.fn()}
            onBusy={jest.fn()}
            initialRequest={KEY}
          />
        </GestureHandlerRootView>,
      ),
    );
    expect(second.lookup).toHaveBeenCalledTimes(2);
    await act(async () => leaving.unmount());
  });
});
