import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { chipText } from '../../src/glyphs/CopyChip';
import { FeeSlider } from '../../src/scenes/send/FeeSlider';
import {
  REQUOTE_BEAT_MS,
  fixedAmount,
  shortRequest,
} from '../../src/scenes/send/model';
import { SendScreen } from '../../src/screens/Send';
import {
  AUTO_PAY_OFF,
  setAutoPayPreference,
} from '../../src/services/autoPayPreference';
import type { WalletAdapter } from '../../src/services/wallet';
import { clearHeldRequests, holdRequest } from '../../src/stage/heldRequests';
import {
  activityOf,
  guardData,
  hex,
  snapshotOf,
} from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import { enterAmount } from '../../test-support/keypad';
import { activate } from '../../test-support/query';

// The held set lives as long as the process, so each test starts with nothing
// held, and a request one test held never holds another test's.
beforeEach(() => clearHeldRequests());

/**
 * Send under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): compose, the keypad, review with the hold, every result and
 * engine error, and the held ring, drawn from test-support/fixtures.ts with
 * `guardData` as their data.
 */
const snapshot = snapshotOf();
const { balance } = snapshot;

/** An on-chain address, which names no amount. */
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
/** An invoice for 24,425 sats, which fixes the amount. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const REFERENCE = hex(40);
const NOTE = 'Coffee';

const quote = (over: Partial<SendReview> = {}): SendReview => ({
  id: 'review-guard',
  destination: ADDRESS,
  description: NOTE,
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
  id: 'p-guard',
  status,
  amountSats: 4_200,
  feeSats: 20,
  paymentHash: REFERENCE,
  message: 'The engine had its say.',
});

/** The transaction a payment to an address went out in. */
const TXID = 'c'.repeat(64);

const refusal = (code: string) =>
  Object.assign(new Error('The engine said no.'), { code });

const never = () => new Promise<never>(() => {});

/**
 * A request for ADDRESS with a label of its own, so a paying state never
 * finds its request held by another. It shows as the address.
 */
let paid = 0;
const fresh = (label = `paid-${(paid += 1)}`) =>
  `bitcoin:${ADDRESS}?label=${label}`;

type Drawn = Omit<Partial<React.ComponentProps<typeof SendScreen>>, 'client'>;

async function draw(
  props: Drawn & { client?: object } = {},
): Promise<ReactTestRenderer> {
  const { client = {}, ...rest } = props;
  return mount(
    <GestureHandlerRootView>
      <SendScreen
        client={client as WalletAdapter}
        onActivity={jest.fn()}
        onRefresh={jest.fn()}
        onBusy={jest.fn()}
        balance={balance}
        activity={snapshot.activity}
        {...rest}
      />
    </GestureHandlerRootView>,
  );
}

const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

/**
 * The request and client given, with the 4,200 sats every state here pays
 * keyed in when the request names no amount, so it can be reviewed.
 */
async function composed(client: object, request = ADDRESS, props: Drawn = {}) {
  const tree = await draw({ client, initialRequest: request, ...props });
  if (fixedAmount(request) === null) await enterAmount(tree, '4200');
  return tree;
}

/** Compose, then review, for the request and client given. */
async function reviewed(client: object, request = ADDRESS, props: Drawn = {}) {
  const tree = await composed(client, request, props);
  await act(async () => {
    await control(tree, 'Review payment').props.onPress();
  });
  return tree;
}

/** Reviewed and committed with the hold, as a screen reader commits it. */
async function sent(client: object, request = fresh(), props: Drawn = {}) {
  const tree = await reviewed(client, request, props);
  await activate(tree, 'Send 4,200 sats');
  return tree;
}

const reviewing = (over: Partial<SendReview> = {}) => ({
  prepareSend: jest.fn().mockResolvedValue(quote(over)),
});

/** A review priced as a splice at the engine's normal rate, with its slider. */
const RATED: Partial<SendReview> = {
  route: 'bitcoin',
  feeLabel: 'Estimated network fee',
  feeSats: 500,
  totalSats: 4_700,
  feeRate: 2,
  feeRates: { fast: 8, normal: 2, slow: 1, minimum: 1 },
};
/** The same payment priced again at 6 sat/vB. */
const RERATED: Partial<SendReview> = {
  ...RATED,
  id: 'review-guard-6',
  feeRate: 6,
  feeSats: 1_500,
  totalSats: 5_700,
};
const slider = (tree: ReactTestRenderer) => tree.root.findByType(FeeSlider);
const paying = (result: Promise<SendResult>) => ({
  prepareSend: jest.fn().mockResolvedValue(quote()),
  send: jest.fn().mockReturnValue(result),
});

const onChip = guardData(snapshot, [shortRequest(ADDRESS)]);
const onReview = guardData(snapshot, [shortRequest(ADDRESS), NOTE]);
const onResult = guardData(snapshot, [chipText(REFERENCE)]);

const GUARDED: GuardedState[] = [
  { name: 'compose, empty', render: () => draw(), data: guardData(snapshot) },
  {
    name: 'compose, a request being typed',
    render: async () => {
      const tree = await draw();
      await act(async () => {
        tree.root
          .find(
            node =>
              node.props.accessibilityLabel === 'Payment request or address' &&
              typeof node.props.onChangeText === 'function',
          )
          .props.onChangeText('bc1qar0s');
      });
      return tree;
    },
    data: guardData(snapshot),
  },
  {
    name: 'compose, a request taken as a chip',
    render: () => draw({ initialRequest: ADDRESS }),
    data: onChip,
  },
  {
    name: 'compose, an amount keyed in',
    render: async () => {
      const tree = await draw({ initialRequest: ADDRESS });
      await enterAmount(tree, '4200');
      return tree;
    },
    data: onChip,
  },
  {
    name: 'compose, an amount the request fixes',
    render: () => draw({ initialRequest: INVOICE }),
    data: guardData(snapshot, [shortRequest(INVOICE)]),
  },
  {
    name: 'compose, more than can be sent now',
    render: async () => {
      const tree = await draw({ initialRequest: ADDRESS });
      await enterAmount(tree, String(balance.availableSats + 1_000));
      return tree;
    },
    data: onChip,
  },
  {
    name: 'compose, more than the wallet holds',
    render: async () => {
      const tree = await draw({ initialRequest: ADDRESS });
      await enterAmount(tree, String(balance.totalSats + 1_000));
      return tree;
    },
    data: onChip,
  },
  {
    name: 'compose, a stale balance',
    render: () => draw({ initialRequest: ADDRESS, disabled: true }),
    data: onChip,
  },
  {
    name: 'preparing',
    render: async () => {
      const tree = await composed({ prepareSend: jest.fn(never) });
      // Preparing never finishes here, so the press is not waited on.
      await act(async () => {
        control(tree, 'Review payment').props.onPress();
      });
      return tree;
    },
    data: onChip,
  },
  {
    name: 'review',
    render: () => reviewed(reviewing()),
    data: onReview,
  },
  {
    name: 'review, with the fee the route should cost',
    render: () =>
      reviewed(
        reviewing({
          feeSats: 11,
          estimatedFeeSats: 1,
          feeLabel: 'Maximum routing fee',
          totalSats: 4_211,
        }),
      ),
    data: onReview,
  },
  {
    name: 'review, with engine warnings',
    render: () =>
      reviewed(reviewing({ warnings: ['This invoice expires soon.'] })),
    data: onReview,
  },
  {
    name: 'review, over Bitcoin, with its fee rate',
    render: () => reviewed(reviewing(RATED)),
    data: onReview,
  },
  {
    name: 'review, over Bitcoin, in BTC',
    render: () => reviewed(reviewing(RATED), ADDRESS, { unit: 'btc' }),
    data: onReview,
  },
  {
    name: 'review, a fee rate being dragged',
    render: async () => {
      const tree = await reviewed(reviewing(RATED));
      await act(async () => slider(tree).props.onPreview(6));
      return tree;
    },
    data: onReview,
  },
  {
    name: 'review, a fee rate being priced',
    render: async () => {
      const tree = await reviewed({
        prepareSend: jest
          .fn()
          .mockResolvedValueOnce(quote(RATED))
          .mockImplementationOnce(never),
      });
      // The engine never answers here, so the choice is not waited on, and
      // the hold has turned busy for it.
      await act(async () => {
        slider(tree).props.onChoose(6);
      });
      await act(async () => {
        await new Promise<void>(resolve =>
          setTimeout(resolve, REQUOTE_BEAT_MS + 50),
        );
      });
      return tree;
    },
    data: onReview,
  },
  {
    name: 'review, a fee rate refused',
    render: async () => {
      const tree = await reviewed({
        prepareSend: jest
          .fn()
          .mockResolvedValueOnce(quote(RATED))
          .mockRejectedValueOnce(refusal('INSUFFICIENT_FUNDS')),
      });
      await act(async () => {
        await slider(tree).props.onChoose(6);
      });
      return tree;
    },
    data: onReview,
  },
  {
    name: 'review, a fee rate chosen',
    render: async () => {
      const tree = await reviewed({
        prepareSend: jest
          .fn()
          .mockResolvedValueOnce(quote(RATED))
          .mockResolvedValueOnce(quote(RERATED)),
      });
      await act(async () => {
        await slider(tree).props.onChoose(6);
      });
      return tree;
    },
    data: onReview,
  },
  {
    name: 'review, by direct funding',
    render: () =>
      reviewed(
        reviewing({
          route: 'bitcoin',
          method: 'direct-funding',
          feeSats: 1_000,
          feeLabel: 'Maximum network fee',
          totalSats: 5_200,
        }),
      ),
    data: onReview,
  },
  {
    name: 'review, the quote nearly out',
    render: () => reviewed(reviewing({ expiresAt: Date.now() + 5_000 })),
    data: onReview,
  },
  {
    name: 'review, the quote expired',
    render: () => reviewed(reviewing({ expiresAt: Date.now() - 1 })),
    data: onReview,
  },
  {
    name: 'review, the quote being refreshed',
    render: async () => {
      const tree = await reviewed({
        prepareSend: jest
          .fn()
          .mockResolvedValueOnce(quote({ expiresAt: Date.now() - 1 }))
          .mockImplementationOnce(never),
      });
      // The new quote never comes here, so the press is not waited on.
      await act(async () => {
        control(tree, 'Refresh quote').props.onPress();
      });
      return tree;
    },
    data: onReview,
  },
  {
    name: 'review, a stale balance',
    render: async () => {
      const client = reviewing();
      const tree = await reviewed(client);
      // The balance ages past the gate while the review is open.
      await act(async () => {
        tree.update(
          <GestureHandlerRootView>
            <SendScreen
              client={client as unknown as WalletAdapter}
              initialRequest={ADDRESS}
              disabled
              onActivity={jest.fn()}
              onRefresh={jest.fn()}
              onBusy={jest.fn()}
              balance={balance}
              activity={snapshot.activity}
            />
          </GestureHandlerRootView>,
        );
      });
      return tree;
    },
    data: onReview,
  },
  {
    name: 'sending',
    render: () => sent(paying(never()), ADDRESS),
    data: onReview,
  },
  {
    // A scanned invoice within Settings > Auto-pay's share, gone out with
    // no hold: the review spent under the comet.
    name: 'sending, by Auto-pay',
    render: async () => {
      await setAutoPayPreference({ on: true, share: 50 });
      return draw({
        initialRequest: INVOICE,
        scanned: true,
        client: {
          prepareSend: jest.fn().mockResolvedValue(
            quote({ amountSats: 24_425, totalSats: 24_445 }),
          ),
          send: jest.fn().mockReturnValue(never()),
        },
      });
    },
    data: guardData(snapshot, [
      shortRequest(INVOICE),
      shortRequest(ADDRESS),
      NOTE,
    ]),
  },
  {
    name: 'completed',
    render: () => sent(paying(Promise.resolve(outcome('completed')))),
    data: onResult,
  },
  {
    name: 'pending',
    render: () => sent(paying(Promise.resolve(outcome('pending')))),
    data: onResult,
  },
  {
    // A splice-out the engine took before naming its transaction: the orbit
    // round the chain glyph, the Reference chip's place kept, unseen.
    name: 'sending to Bitcoin',
    render: () =>
      sent({
        prepareSend: jest.fn().mockResolvedValue(quote(RATED)),
        send: jest
          .fn()
          .mockResolvedValue({ ...outcome('pending'), paymentHash: undefined }),
      }),
    data: guardData(snapshot),
  },
  {
    name: 'sent, confirming on Bitcoin',
    render: () =>
      sent({
        prepareSend: jest.fn().mockResolvedValue(quote(RATED)),
        send: jest.fn().mockResolvedValue({
          ...outcome('pending'),
          paymentHash: undefined,
          txid: TXID,
        }),
      }),
    data: guardData(snapshot, [chipText(TXID)]),
  },
  {
    name: 'uncertain',
    render: () => sent(paying(Promise.resolve(outcome('uncertain')))),
    data: onResult,
  },
  {
    name: 'uncertain, the connection ended mid-send',
    render: () =>
      sent({
        prepareSend: jest.fn().mockResolvedValue(quote()),
        send: jest.fn().mockRejectedValue(refusal('RESULT_UNCERTAIN')),
      }),
    data: guardData(snapshot),
  },
  {
    name: 'failed',
    render: () => sent(paying(Promise.resolve(outcome('failed')))),
    data: onResult,
  },
  {
    name: 'a held request, entered again',
    render: () => {
      const request = fresh('held');
      holdRequest(request, { status: 'uncertain' });
      return draw({ initialRequest: request });
    },
    data: onChip,
  },
  {
    name: 'a held request, the engine says already out',
    render: () =>
      reviewed(
        {
          prepareSend: jest
            .fn()
            .mockRejectedValue(refusal('ALREADY_SUBMITTED')),
        },
        fresh(),
      ),
    data: onChip,
  },
  {
    name: 'a held request, with its payment in the history',
    render: () => {
      const request = fresh('held-in-history');
      const txid = hex(41);
      holdRequest(request, { status: 'pending', txid });
      return draw({
        initialRequest: request,
        activity: [activityOf('sent', 'pending', { rail: 'chain', txid })],
        onDetail: jest.fn(),
      });
    },
    data: onChip,
  },
  ...(
    [
      ['a refused request', 'BOLT11_CHECKSUM'],
      ['the primary node away', 'PRIMARY_DOWN'],
      ['no route', 'NO_ROUTE'],
      ['funding unconfirmed', 'FUNDING_UNCONFIRMED'],
      ['an amount it will not take', 'AMOUNT_REQUIRED'],
      ['an error it does not name', 'SOMETHING_NEW'],
    ] as const
  ).map(([name, code]) => ({
    name: `engine error: ${name}`,
    render: () =>
      reviewed({ prepareSend: jest.fn().mockRejectedValue(refusal(code)) }),
    data: onChip,
  })),
  {
    name: 'engine error: short of funds, within what is held',
    render: async () => {
      const tree = await draw({
        client: {
          prepareSend: jest
            .fn()
            .mockRejectedValue(refusal('INSUFFICIENT_FUNDS')),
        },
        initialRequest: ADDRESS,
      });
      await enterAmount(tree, String(balance.availableSats + 1_000));
      await act(async () => {
        await control(tree, 'Review payment').props.onPress();
      });
      return tree;
    },
    data: onChip,
  },
  {
    name: 'engine error: short of funds, past what is held',
    render: async () => {
      const tree = await draw({
        client: {
          prepareSend: jest
            .fn()
            .mockRejectedValue(refusal('INSUFFICIENT_FUNDS')),
        },
        initialRequest: ADDRESS,
      });
      await enterAmount(tree, String(balance.totalSats + 1_000));
      await act(async () => {
        await control(tree, 'Review payment').props.onPress();
      });
      return tree;
    },
    data: onChip,
  },
  {
    name: 'engine error: the quote ran out as it was sent',
    render: () =>
      sent(
        {
          prepareSend: jest.fn().mockResolvedValue(quote()),
          send: jest.fn().mockRejectedValue(refusal('QUOTE_EXPIRED')),
        },
        ADDRESS,
      ),
    data: onReview,
  },
  {
    name: 'sats as ₿: compose, empty',
    render: () => draw({ initialRequest: ADDRESS, symbol: true }),
    data: onChip,
  },
  {
    name: 'sats as ₿: compose, an amount keyed in',
    render: async () => {
      const tree = await draw({ initialRequest: ADDRESS, symbol: true });
      await enterAmount(tree, '4200');
      return tree;
    },
    data: onChip,
  },
  {
    name: 'sats as ₿: compose, an amount the request fixes',
    render: () => draw({ initialRequest: INVOICE, symbol: true }),
    data: guardData(snapshot, [shortRequest(INVOICE)]),
  },
  {
    name: 'sats as ₿: review',
    render: () =>
      reviewed(
        reviewing({
          feeSats: 11,
          estimatedFeeSats: 1,
          feeLabel: 'Maximum routing fee',
          totalSats: 4_211,
        }),
        ADDRESS,
        { symbol: true },
      ),
    data: onReview,
  },
  {
    name: 'sats as ₿: completed',
    render: () =>
      sent(paying(Promise.resolve(outcome('completed'))), fresh(), {
        symbol: true,
      }),
    data: onResult,
  },
  {
    name: 'sats as ₿: completed, hidden',
    render: () =>
      sent(paying(Promise.resolve(outcome('completed'))), fresh(), {
        symbol: true,
        masked: true,
      }),
    data: onResult,
  },
];

// Auto-pay is one value the whole app shares, so a state that turns it on
// leaves it off for the next.
afterEach(() => setAutoPayPreference(AUTO_PAY_OFF));

guard('send', GUARDED);
