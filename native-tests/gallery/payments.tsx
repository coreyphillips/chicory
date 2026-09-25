/**
 * Send and Receive, on the canvas, in every step and outcome. Each is
 * reached the way a person reaches it: the request is keyed in, reviewed and
 * held to send, or the amount keyed in, quoted and made a request, with the
 * gallery's wallet answering each call at once in the way the state needs.
 */
import type { SendReview, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../src/design/copy';
import type { WalletAdapter } from '../../src/services/wallet';
import { holdRequest } from '../../src/stage/heldRequests';
import { hex, receiptOf } from '../../test-support/fixtures';
import {
  ADDRESS,
  INVOICE,
  NOTE,
  configOf,
  fresh,
  never,
  onMainnet,
  quoteOf,
  refusal,
  requestFor,
  resultOf,
  reviewOf,
  stale,
} from './fakes';
import { press } from './shots';
import type { Shot, Step } from './shots';
import { hideBalance, open, wallet } from './staged';

/** Keys `digits` in on the keypad, one key a step. */
const keyed = (digits: string): Step[] =>
  [...digits].map(digit => press(copy.keypad.digits[Number(digit)]));

// Send.

const REVIEW = press(copy.send.review);
const SEND = copy.send.sendSats(4_200);
const COMMIT: Step = drive => drive.activate(SEND);

interface Paying {
  request?: string;
  snapshot?: WalletSnapshot;
  client?: Partial<WalletAdapter>;
  steps?: Step[];
}

function send(name: string, make: () => Paying = () => ({})): Shot {
  return wallet(`send, ${name}`, () => {
    const { request = ADDRESS, snapshot, client, steps } = make();
    return { snapshot, client, open: [open.send(request)], steps };
  });
}

/** Reviewed, with the review as `over` sets it when the wallet is asked. */
const reviewed = (name: string, over: () => Partial<SendReview>) =>
  send(name, () => ({
    client: { prepareSend: async () => reviewOf(over()) },
    steps: [REVIEW],
  }));

/** Reviewed and held to send, with the wallet answering `send`. */
const sent = (
  name: string,
  answer: WalletAdapter['send'],
  before: Step[] = [],
) =>
  send(name, () => ({
    client: { send: answer },
    steps: [...before, REVIEW, COMMIT],
  }));

/** Reviewed, and refused by the engine with `code`. */
const refused = (name: string, code: string, before: Step[] = []) =>
  send(name, () => ({
    client: {
      prepareSend: async () => {
        throw refusal('The engine said no.', code);
      },
    },
    steps: [...before, REVIEW],
  }));

const sends: Shot[] = [
  send('empty', () => ({ request: '' })),
  send('a request taken as a chip'),
  send('an amount the request fixes', () => ({ request: INVOICE })),
  send('an amount keyed in', () => ({ steps: keyed('4200') })),
  send('more than can be sent now', () => ({ steps: keyed('255000') })),
  send('more than the wallet holds', () => ({ steps: keyed('300000') })),
  send('a stale balance', () => ({
    snapshot: stale(onMainnet()),
  })),
  send('on a test network', () => ({ snapshot: fresh(), steps: [REVIEW] })),
  send('preparing', () => ({
    client: { prepareSend: never },
    steps: [REVIEW],
  })),
  reviewed('review', () => ({})),
  reviewed('review, with the fee the route should cost', () => ({
    feeSats: 1_012,
    totalSats: 5_212,
    estimatedFeeSats: 12,
  })),
  reviewed('review, over Bitcoin', () => ({
    route: 'bitcoin',
    feeLabel: 'Network fee',
    feeSats: 1_000,
    totalSats: 5_200,
  })),
  reviewed('review, by direct funding', () => ({
    route: 'bitcoin',
    method: 'direct-funding',
    feeSats: 1_000,
    totalSats: 5_200,
  })),
  reviewed('review, with warnings', () => ({
    warnings: ['This invoice expires soon.'],
  })),
  reviewed('review, the quote nearly out', () => ({
    expiresAt: Date.now() + 5_000,
  })),
  reviewed('review, the quote run out', () => ({
    expiresAt: Date.now() - 1,
  })),
  send('review, held down', () => ({
    steps: [REVIEW, drive => drive.hold(SEND, 'down')],
  })),
  sent('sending', never),
  sent('sent', async () => resultOf('completed')),
  sent('sent, with amounts hidden', async () => resultOf('completed'), [
    hideBalance,
  ]),
  sent('on its way', async () => resultOf('pending')),
  sent('unknown', async () => resultOf('uncertain')),
  sent('unknown, the connection ended mid-send', async () => {
    throw refusal('The connection ended.', 'RESULT_UNCERTAIN');
  }),
  sent('failed', async () =>
    resultOf('failed', { message: 'No route to the recipient.' }),
  ),
  send('a held request', () => {
    holdRequest(ADDRESS, { status: 'uncertain' });
    return {};
  }),
  refused('a held request, the engine says already out', 'ALREADY_SUBMITTED'),
  refused('a request refused', 'INVALID_REQUEST'),
  refused('short of funds, within what is held', 'INSUFFICIENT_FUNDS'),
  refused(
    'short of funds, past what is held',
    'INSUFFICIENT_FUNDS',
    keyed('300000'),
  ),
  refused('the primary node away', 'PRIMARY_DOWN'),
  refused('no route', 'NO_ROUTE'),
  refused('the channel funding unconfirmed', 'FUNDING_UNCONFIRMED'),
  sent('the quote ran out as it was sent', async () => {
    throw refusal('The quote expired.', 'QUOTE_EXPIRED');
  }),
];

// Receive.

const CONTINUE = press(copy.receive.continue);
const CREATE = press(copy.receive.create);
const AMOUNT = keyed('10000');
const TO_QUOTE = [...AMOUNT, CONTINUE];
const TO_REQUEST = [...TO_QUOTE, CREATE];
const OFFLINE = press(copy.receive.offline);
const offering: Partial<WalletAdapter> = {
  getConfig: async () => configOf({ offlineReceiveAvailable: true }),
};

interface Receiving {
  snapshot?: WalletSnapshot;
  client?: Partial<WalletAdapter>;
  steps?: Step[];
}

function receive(name: string, make: () => Receiving = () => ({})): Shot {
  return wallet(`receive, ${name}`, () => ({
    ...make(),
    open: [open.receive()],
  }));
}

/** A request made, and what the wallet says has arrived for it. */
const arrived = (
  name: string,
  status: ReturnType<typeof receiptOf>,
  before: Step[] = [],
) =>
  receive(name, () => ({
    client: { getReceiveStatus: async () => status },
    steps: [...before, ...TO_REQUEST],
  }));

const TXID = hex(400);

const onlyAmount = (receivableSats: number) =>
  onMainnet({ balance: { receivableSats } });

const receives: Shot[] = [
  receive('any amount'),
  receive('an amount keyed in', () => ({ steps: AMOUNT })),
  receive('an amount required', () => ({ snapshot: onlyAmount(0) })),
  receive('a note', () => ({
    steps: [
      press(copy.receive.addNote),
      drive => drive.type(copy.receive.note, NOTE),
    ],
  })),
  receive('offline offered', () => ({ client: offering })),
  receive('offline on', () => ({ client: offering, steps: [OFFLINE] })),
  receive('offline on, over what fits', () => ({
    client: offering,
    steps: [OFFLINE, ...keyed('60000')],
  })),
  receive('a stale balance', () => ({
    snapshot: stale(onMainnet()),
  })),
  receive('on a test network', () => ({
    snapshot: fresh(),
    steps: TO_REQUEST,
  })),
  receive('the quote refused', () => ({
    client: {
      quoteReceive: async () => {
        throw new Error('No route to the primary.');
      },
    },
    steps: [CONTINUE],
  })),
  receive('the amount refused, past what the primary funds', () => ({
    snapshot: onlyAmount(0),
    client: {
      quoteReceive: async () => {
        throw refusal(
          'the provider funds at most 1000000 sats for one receive',
          'RECEIVE_UNAVAILABLE',
        );
      },
    },
    steps: [...keyed('2000000'), CONTINUE],
  })),
  receive('the primary node away', () => ({
    client: {
      quoteReceive: async () => {
        throw refusal('Your primary node needs to reconnect.', 'PRIMARY_DOWN');
      },
    },
    steps: [CONTINUE],
  })),
  receive('the quote', () => ({ steps: TO_QUOTE })),
  receive('the quote, with a fee', () => ({
    client: {
      quoteReceive: async input =>
        quoteOf(input, { feeSats: 100, netSats: 9_900 }),
    },
    steps: TO_QUOTE,
  })),
  receive('the quote, a channel made just in time', () => ({
    snapshot: onlyAmount(0),
    client: {
      quoteReceive: async input =>
        quoteOf(input, { feeSats: 1_000, netSats: 9_000 }),
    },
    steps: TO_QUOTE,
  })),
  receive('the quote, for any amount', () => ({ steps: [CONTINUE] })),
  receive('the quote, offline', () => ({
    client: offering,
    steps: [OFFLINE, ...TO_QUOTE],
  })),
  receive('the quote, run out', () => ({
    client: {
      quoteReceive: async input =>
        quoteOf(input, { expiresAt: Date.now() - 1 }),
    },
    steps: TO_QUOTE,
  })),
  receive('the request', () => ({ steps: TO_REQUEST })),
  receive('the request, for any amount', () => ({
    steps: [CONTINUE, CREATE],
  })),
  receive('the request, over Lightning only', () => ({
    client: {
      receive: async quote =>
        requestFor(quote, {
          address: undefined,
          bitcoinTracking: 'lightning-only',
          warnings: ['Bitcoin fallback is unavailable.'],
        }),
    },
    steps: TO_REQUEST,
  })),
  receive('the request, offline', () => ({
    client: {
      ...offering,
      receive: async quote => requestFor(quote, { offlineReceive: true }),
    },
    steps: [OFFLINE, ...TO_REQUEST],
  })),
  receive('the request, running out', () => ({
    client: {
      receive: async quote =>
        requestFor(quote, {
          createdAt: Date.now() - 50 * 60_000,
          expiresAt: Date.now() + 5 * 60_000,
        }),
    },
    steps: TO_REQUEST,
  })),
  receive('the request, lifted', () => ({
    steps: [...TO_REQUEST, press(copy.receive.qr)],
  })),
  receive('the request, copied', () => ({
    steps: [...TO_REQUEST, press(copy.receive.copy)],
  })),
  receive('the request, expiring', () => ({
    client: {
      receive: async quote =>
        requestFor(quote, { expiresAt: Date.now() + 600 }),
    },
    steps: TO_REQUEST,
  })),
  receive('the request, on a reused address', () => ({
    client: {
      getReceiveStatus: async () => {
        throw refusal(copy.receive.reusedAddress, 'AMBIGUOUS_RECEIVE_ADDRESS');
      },
    },
    steps: TO_REQUEST,
  })),
  arrived('a payment detected, confirming', receiptOf('pending')),
  arrived('part of it here', receiptOf('partial')),
  arrived('received', receiptOf('completed')),
  arrived(
    'received on chain',
    receiptOf('completed', {
      method: 'bitcoin',
      txid: TXID,
      txids: [TXID],
      transactions: [{ txid: TXID, amountSats: 10_000, confirmed: true }],
    }),
  ),
  arrived('received, hidden', receiptOf('completed'), [hideBalance]),
];

export const PAYMENTS: Shot[] = [...sends, ...receives];
