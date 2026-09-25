import React, { useEffect } from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type {
  Activity,
  ReceiveQuote,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { AmountField } from '../../src/components/AmountField';
import { ReceiveReceipt } from '../../src/components/ReceiveReceipt';
import { ReceiveRequestDetails } from '../../src/components/ReceiveRequestDetails';
import { ToastProvider, useToast } from '../../src/components/Toast';
import { copy } from '../../src/design/copy';
import { CopyChip, chipText } from '../../src/glyphs/CopyChip';
import { ReceiveScreen } from '../../src/screens/Receive';
import type { WalletAdapter } from '../../src/services/wallet';
import {
  NOW,
  everyActivity,
  guardData,
  hex,
  receiptOf,
  requestOf,
  snapshotOf,
} from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import { enterAmount } from '../../test-support/keypad';
import { field, press, visibleText } from '../../test-support/query';

/**
 * Receive under the copy guard (REDESIGN.md rule 1) and the accessibility
 * check (section 9): the keypad, offline receive, the quote, the request and
 * its QR, and what arrives for it. The receive track adds each state it
 * redraws, drawn from test-support/fixtures.ts with `guardData` as its data.
 *
 * Time stands still at the fixtures' NOW, so a request made from them is in
 * time, and a state that needs the clock to move moves it itself.
 */
beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

const noop = () => {};
const MINUTE = 60_000;
const NOTE = 'Coffee with Sam';
const TXID = hex(400);

const snapshot = snapshotOf();
const { receivableSats, offlineReceivableSats } = snapshot.balance;

/**
 * The amount field draws its own label while it is the text field; the
 * keypad that replaces it (REDESIGN.md 10.3) belongs to the send track and
 * draws none. Whatever of that label it still draws is its own, so the form
 * states allow exactly that and nothing more.
 */
let fieldLabel: string[] = [];
beforeAll(async () => {
  const tree = await mount(<AmountField value="" onChangeText={noop} />);
  fieldLabel = visibleText(tree).filter(text => text === copy.amount.field);
  await act(async () => tree.unmount());
});

/** What a receive state may show: the wallet's figures, the note, the txid. */
const shown = (extra: string[] = []) =>
  guardData(snapshot, [NOTE, chipText(TXID), chipText(TXID, true), ...extra]);

const quoteOf = (over: Partial<ReceiveQuote> = {}): ReceiveQuote => ({
  id: 'quote',
  amountSats: 10_000,
  description: '',
  feeSats: 0,
  netSats: 10_000,
  expiresAt: NOW + MINUTE,
  warnings: [],
  ...over,
});

const made = (over: Partial<ReceiveRequest> = {}): ReceiveRequest =>
  requestOf({ description: NOTE, createdAt: NOW, ...over }) as ReceiveRequest;

/**
 * A wallet whose every receive call answers from these. `laterError` is what
 * reading the status fails with once it has answered `status` the first time.
 */
function clientOf({
  quote = quoteOf(),
  quoteError,
  request = made(),
  receiveError,
  status = receiptOf('waiting'),
  statusError,
  laterError,
  offline = false,
}: {
  quote?: ReceiveQuote;
  quoteError?: Error;
  request?: ReceiveRequest;
  receiveError?: Error;
  status?: ReceiveStatus;
  statusError?: Error;
  laterError?: Error;
  offline?: boolean;
} = {}): WalletAdapter {
  return {
    getConfig: jest
      .fn()
      .mockResolvedValue({ offlineReceiveAvailable: offline }),
    quoteReceive: quoteError
      ? jest.fn().mockRejectedValue(quoteError)
      : jest.fn().mockResolvedValue(quote),
    receive: receiveError
      ? jest.fn().mockRejectedValue(receiveError)
      : jest.fn().mockResolvedValue(request),
    getReceiveStatus: statusError
      ? jest.fn().mockRejectedValue(statusError)
      : laterError
      ? jest.fn().mockResolvedValueOnce(status).mockRejectedValue(laterError)
      : jest.fn().mockResolvedValue(status),
  } as unknown as WalletAdapter;
}

type ScreenProps = Partial<React.ComponentProps<typeof ReceiveScreen>>;

/** One thing a person does to what is on screen. */
type Step = (tree: ReactTestRenderer) => Promise<void>;

/** One thing a person or the wallet does to the screen: `set` changes its props. */
type Drive = (
  tree: ReactTestRenderer,
  set: (props: ScreenProps) => Promise<void>,
) => Promise<void>;

/** Lets what the last step started resolve, as a person would wait for it. */
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(0);
  });

/** The receive screen on `client`, driven by `steps` in turn. */
function receive(
  client: WalletAdapter,
  steps: Drive[] = [],
  props: ScreenProps = {},
) {
  return async () => {
    const screen = (over: ScreenProps) => (
      <ReceiveScreen
        client={client}
        receivableSats={receivableSats}
        offlineReceivableSats={offlineReceivableSats}
        onActivity={noop}
        onBusy={noop}
        {...props}
        {...over}
      />
    );
    const tree = await mount(screen({}));
    const set = (over: ScreenProps) =>
      act(async () => {
        tree.update(screen(over));
      });
    await settle();
    for (const step of steps) {
      await step(tree, set);
      await settle();
    }
    return tree;
  };
}

const amount =
  (digits: string): Step =>
  tree =>
    enterAmount(tree, digits);
const tap =
  (label: string): Step =>
  tree =>
    press(tree, label);
const note: Step = async tree => {
  await press(tree, copy.receive.addNote);
  await act(async () =>
    field(tree, copy.receive.note).props.onChangeText(NOTE),
  );
};
const wait =
  (ms: number): Step =>
  () =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });
/** The balance grows too old to quote against while the screen is open. */
const stale: Drive = (_tree, set) => set({ disabled: true });
const toQuote = [amount('10000'), tap(copy.receive.continue)];
const toRequest = [...toQuote, tap(copy.receive.create)];

/** A form state: its data, plus the amount field's own label while it draws one. */
function form(name: string, render: GuardedState['render']): GuardedState {
  return {
    name,
    render,
    get data() {
      return shown(fieldLabel);
    },
  };
}

function state(
  name: string,
  render: GuardedState['render'],
  extra: string[] = [],
): GuardedState {
  return { name, render, data: shown(extra) };
}

const receipt = (status: ReceiveStatus, props = {}) =>
  receive(clientOf({ status }), toRequest, props);

const reused = Object.assign(new Error(copy.receive.reusedAddress), {
  code: 'AMBIGUOUS_RECEIVE_ADDRESS',
});

/** Money that arrived over Lightning, which a reused address leaves standing. */
const lightningPart = receiptOf('partial', {
  method: 'lightning',
  txids: [],
  txid: undefined,
  transactions: undefined,
});

/** A payment in each state a history can hold. */
const payments = everyActivity();

/** The original request a legacy invoice is linked back to. */
const ORIGINAL = requestOf({}, 9);

/** The original request pasted into the well. */
const original: Step = tree =>
  act(async () =>
    field(tree, copy.receive.original).props.onChangeText(ORIGINAL.uri),
  );

/**
 * A payment's detail keeps the request it was asked for with. `linking`
 * answers a link to the original request; a linked one shows its string.
 */
function detail(
  name: string,
  item: Activity,
  steps: Step[] = [],
  linking: { answer: jest.Mock; shows?: string[] } = { answer: jest.fn() },
): GuardedState {
  return {
    name,
    data: guardData(snapshotOf({ activity: [item] }), linking.shows),
    render: async () => {
      const tree = await mount(
        <ReceiveRequestDetails
          item={item}
          client={
            { importReceiveRequest: linking.answer } as unknown as WalletAdapter
          }
          onRefresh={noop}
        />,
      );
      for (const step of steps) await step(tree);
      return tree;
    },
  };
}

function Copied({ tone = 'success' }: { tone?: 'success' | 'error' }) {
  const toast = useToast();
  useEffect(() => {
    toast(copy.receive.copied, tone, 'copy');
  }, [toast, tone]);
  return null;
}

const GUARDED: GuardedState[] = [
  // The amount.
  form('any amount', receive(clientOf())),
  form('an amount chosen', receive(clientOf(), [amount('10000')])),
  form('an amount required', receive(clientOf(), [], { receivableSats: 0 })),
  form(
    'an amount required, entered',
    receive(clientOf(), [amount('4200')], {
      receivableSats: 0,
    }),
  ),
  form('a note open', receive(clientOf(), [note])),
  form('offline offered', receive(clientOf({ offline: true }))),
  form(
    'offline on',
    receive(clientOf({ offline: true }), [tap(copy.receive.offline)]),
  ),
  form(
    'offline on, over the cap',
    receive(clientOf({ offline: true }), [
      tap(copy.receive.offline),
      amount('60000'),
    ]),
  ),
  form(
    'offline on, under the floor',
    receive(clientOf({ offline: true }), [
      tap(copy.receive.offline),
      amount('100'),
    ]),
  ),
  form(
    'offline on, no cap given',
    receive(clientOf({ offline: true }), [tap(copy.receive.offline)], {
      offlineReceivableSats: undefined,
    }),
  ),
  form('stale', receive(clientOf(), [], { disabled: true })),
  form(
    'the quote refused',
    receive(clientOf({ quoteError: new Error('No route to the primary.') }), [
      tap(copy.receive.continue),
    ]),
  ),
  form(
    'offline refused, the moon shaken off',
    receive(
      clientOf({
        offline: true,
        quoteError: Object.assign(
          new Error('Your node cannot prepare this payment request right now.'),
          { code: 'RECEIVE_UNAVAILABLE' },
        ),
      }),
      [tap(copy.receive.offline), ...toQuote],
    ),
  ),
  form(
    'an amount needed after all',
    receive(
      clientOf({
        quoteError: Object.assign(new Error('Set an amount.'), {
          code: 'AMOUNT_REQUIRED',
        }),
      }),
      [tap(copy.receive.continue)],
    ),
  ),

  // The quote.
  state('a quote', receive(clientOf(), toQuote)),
  state(
    'a quote with a fee',
    receive(
      clientOf({ quote: quoteOf({ feeSats: 100, netSats: 9_900 }) }),
      toQuote,
    ),
  ),
  state(
    'a quote for a channel made just in time',
    receive(
      clientOf({ quote: quoteOf({ feeSats: 1_000, netSats: 9_000 }) }),
      toQuote,
      { receivableSats: 0 },
    ),
  ),
  state(
    'a quote for any amount',
    receive(clientOf({ quote: quoteOf({ amountSats: null, netSats: null }) }), [
      tap(copy.receive.continue),
    ]),
  ),
  state(
    'an offline quote',
    receive(clientOf({ offline: true }), [
      tap(copy.receive.offline),
      ...toQuote,
    ]),
  ),
  state(
    'a quote with warnings',
    receive(
      clientOf({ quote: quoteOf({ warnings: ['The fee may change.'] }) }),
      toQuote,
    ),
  ),
  state(
    'a quote expired',
    receive(clientOf(), [...toQuote, wait(MINUTE + 1_000)]),
  ),
  state('a quote, stale', receive(clientOf(), [...toQuote, stale])),
  state(
    'a quote expired, stale',
    receive(clientOf(), [...toQuote, wait(MINUTE + 1_000), stale]),
  ),
  state(
    'a quote the engine calls expired',
    receive(
      clientOf({
        receiveError: Object.assign(new Error('The receive quote expired.'), {
          code: 'QUOTE_EXPIRED',
        }),
      }),
      toRequest,
    ),
  ),
  // Refused, the quote gives way to the form, with a bang beside Continue.
  form(
    'a request refused',
    receive(
      clientOf({ receiveError: new Error('The primary node is not ready.') }),
      toRequest,
    ),
  ),

  // The request.
  state('a request', receive(clientOf(), toRequest)),
  state(
    'a request for any amount',
    receive(clientOf({ request: made({ amountSats: null }) }), toRequest),
  ),
  state(
    'a request over Lightning only',
    receive(
      clientOf({
        request: made({
          address: undefined,
          bitcoinTracking: 'lightning-only',
          warnings: ['Bitcoin fallback is unavailable.'],
        }),
      }),
      toRequest,
    ),
  ),
  state(
    'an offline request',
    receive(clientOf({ request: made({ offlineReceive: true }) }), toRequest),
  ),
  state(
    'a request running out',
    receive(
      clientOf({
        request: made({
          createdAt: NOW - 50 * MINUTE,
          expiresAt: NOW + 5 * MINUTE,
        }),
      }),
      toRequest,
    ),
  ),
  state(
    'a request lifted',
    receive(clientOf(), [...toRequest, tap(copy.receive.qr)]),
  ),
  state(
    'a request expired',
    receive(clientOf({ request: made({ expiresAt: NOW + MINUTE }) }), [
      ...toRequest,
      wait(MINUTE + 1_000),
    ]),
  ),
  state(
    'a request on a reused address',
    receive(clientOf({ statusError: reused }), toRequest),
  ),
  state(
    'a request whose status cannot be read',
    receive(clientOf({ statusError: new Error('Timed out.') }), [
      ...toRequest,
      wait(4_000),
    ]),
  ),

  // What arrives.
  state('a payment detected, confirming', receipt(receiptOf('pending'))),
  state('part of it here', receipt(receiptOf('partial'))),
  state(
    'part of it here, hidden',
    receipt(receiptOf('partial'), { hidden: true }),
  ),
  state('a payment received', receipt(receiptOf('completed'))),
  state(
    'part of it here, on a reused address',
    receive(clientOf({ status: lightningPart, laterError: reused }), [
      ...toRequest,
      wait(2_000),
    ]),
  ),
  state(
    'part of it here, its status unreadable',
    receive(
      clientOf({ status: lightningPart, laterError: new Error('Timed out.') }),
      [...toRequest, wait(8_000)],
    ),
  ),
  state(
    'a payment received on chain',
    receipt(
      receiptOf('completed', {
        method: 'bitcoin',
        txids: [TXID],
        transactions: [{ txid: TXID, amountSats: 10_000, confirmed: true }],
      }),
    ),
  ),
  state(
    'a payment received, hidden',
    receipt(receiptOf('completed'), { hidden: true }),
  ),
  state(
    'a payment received, in BTC',
    receipt(receiptOf('completed'), { unit: 'btc' }),
    ['0.00010000'],
  ),
  state('a receipt in a detail', () =>
    mount(<ReceiveReceipt status={receiptOf('partial')} amountSats={10_000} />),
  ),

  // A request as a payment's detail keeps it.
  detail('a detail, awaiting payment', payments['request pending']),
  detail('a detail, expired', payments['request expired']),
  detail('a detail, paid', payments['request paid']),
  detail('a detail, reused address', payments['request with a reused address']),
  detail(
    'a detail, status unavailable',
    payments['request whose status is unavailable'],
  ),
  detail('a detail, legacy invoice', payments['legacy invoice, expired']),
  detail('a detail, linking', payments['legacy invoice, expired'], [
    tap(copy.receive.linkOriginal),
  ]),
  detail(
    'a detail, linking refused',
    payments['legacy invoice, expired'],
    [tap(copy.receive.linkOriginal), original, tap(copy.receive.link)],
    {
      answer: jest
        .fn()
        .mockRejectedValue(new Error('It belongs to another invoice.')),
    },
  ),
  detail(
    'a detail, linked',
    payments['legacy invoice, expired'],
    [tap(copy.receive.linkOriginal), original, tap(copy.receive.link)],
    { answer: jest.fn().mockResolvedValue(ORIGINAL), shows: [ORIGINAL.uri] },
  ),

  // Copying.
  state('a copy chip', () =>
    mount(<CopyChip label={copy.receive.transaction} value={TXID} />),
  ),
  state('a copy chip, copied', async () => {
    const tree = await mount(
      <CopyChip label={copy.receive.transaction} value={TXID} />,
    );
    await press(tree, copy.receive.copyValue(copy.receive.transaction));
    return tree;
  }),
  state('a copy chip, opened in full', async () => {
    const tree = await mount(
      <CopyChip label={copy.receive.transaction} value={TXID} />,
    );
    const chip = tree.root.findAll(
      node =>
        node.props.accessibilityLabel ===
          copy.receive.copyValue(copy.receive.transaction) &&
        typeof node.props.onLongPress === 'function',
    )[0];
    await act(async () => chip.props.onLongPress());
    return tree;
  }),
  state('a toast', () =>
    mount(
      <ToastProvider>
        <Copied />
      </ToastProvider>,
    ),
  ),
  state('a toast, failed', () =>
    mount(
      <ToastProvider>
        <Copied tone="error" />
      </ToastProvider>,
    ),
  ),
];

guard('receive', GUARDED);
