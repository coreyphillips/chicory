import React from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { MaxQuote, SendReview } from '@beignet/wallet-core';
import {
  DEFAULT_PRIMARY_URI,
  EmbeddedWalletClient,
} from '@beignet/wallet-core';
import { Chip } from '../../../components/ui';
import { copy } from '../../../design/copy';
import { Whisper } from '../../../glyphs/Whisper';
import { AmountReadout } from '../../keypad/AmountReadout';
import { SendScreen } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { amountValue, enterAmount } from '../../../../test-support/keypad';
import { activate, press } from '../../../../test-support/query';
import { copyViolations } from '../../../../test-support/copyGuard';
import { a11yProblems } from '../../../../test-support/a11y';
import { Amount } from '../Amount';
import { reviewFigures, reviewWords, shortRequest } from '../model';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const INVOICE =
  'lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqlvhfca';
const maximum: MaxQuote = {
  amountSats: 198000,
  keptSats: 1402,
  keptReason: 'commitment-cost',
};
const review = (): SendReview => ({
  id: 'max-review',
  destination: INVOICE,
  description: '',
  route: 'lightning',
  max: true,
  amountSats: 198000,
  minRecipientSats: 198000,
  feeSats: 2000,
  feeLabel: 'Maximum routing fee',
  maxFeeSats: 2000,
  debitSats: 200000,
  debitMsat: '200000000',
  maxFeeMsat: '2000000',
  totalSats: 200000,
  keptSats: 1402,
  keptReason: 'commitment-cost',
  warnings: [],
  expiresAt: Date.now() + 60000,
});
const trees: ReactTestRenderer[] = [];
type Props = Partial<React.ComponentProps<typeof SendScreen>>;
async function draw(over: Partial<WalletAdapter> = {}, props: Props = {}) {
  const client = {
    quoteMax: jest.fn().mockResolvedValue(maximum),
    prepareSend: jest.fn().mockResolvedValue(review()),
    send: jest.fn().mockResolvedValue({
      id: 'max-review',
      status: 'completed',
      amountSats: 199998,
      feeSats: 2,
      message: 'Payment sent.',
    }),
    ...over,
  } as unknown as WalletAdapter;
  const render = (patch: Props = {}) => (
    <GestureHandlerRootView>
      <SendScreen
        client={client}
        initialRequest={INVOICE}
        primaryConnected
        onActivity={jest.fn()}
        onBusy={jest.fn()}
        onRefresh={jest.fn()}
        balance={{
          totalSats: 300000,
          availableSats: 1000,
          pendingSats: 0,
          receivableSats: 1000,
        }}
        {...props}
        {...patch}
      />
    </GestureHandlerRootView>
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(render());
  });
  trees.push(tree);
  return {
    tree,
    client,
    update: async (patch: Props) => {
      await act(async () => tree.update(render(patch)));
    },
  };
}
beforeEach(() => clearHeldRequests());
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test('the number-only max chip fills the readout, stays plain, and prepares max', async () => {
  const { tree, client } = await draw();
  const chip = () => tree.root.findByType(Chip);
  expect(chip().props.label).toBe('198,000 sats');
  expect(chip().props.selected).toBe(false);
  expect(client.prepareSend).not.toHaveBeenCalled();
  await press(tree, '198,000 sats');
  expect(amountValue(tree)).toBe('198000');
  expect(chip().props.selected).toBe(true);
  expect(tree.root.findByType(AmountReadout).props.tone).toBe('plain');
  await press(tree, copy.send.review);
  expect(client.prepareSend).toHaveBeenCalledWith({
    request: INVOICE,
    max: true,
  });
});

test('the installed wallet core offers address max before home funding confirms', async () => {
  const primary = DEFAULT_PRIMARY_URI.split('@')[0];
  const core = new EmbeddedWalletClient({
    walletId: 'unconfirmed',
    runtime: {
      request: async ({ path }) => {
        if (path === '/api/wallets/unconfirmed') {
          return {
            id: 'unconfirmed',
            network: 'mainnet',
            lfbw: { enabled: true, primaryPubkey: primary, setup: 'ready' },
          };
        }
        if (path === '/api/config') return { engineVersion: '0.27.0-portable' };
        if (path.endsWith('/channels')) {
          return [
            {
              channelId: 'home',
              peerPubkey: primary,
              state: 'NORMAL',
              htlcUsable: true,
              fundingConfirmed: false,
              localBalanceSats: 100000,
              localReserveWaived: true,
            },
          ];
        }
        if (path.endsWith('/fees/estimates')) return { normal: 2 };
        if (path.endsWith('/channel/splice-quote')) {
          return { feeSats: 579, maxAmountSats: 99421 };
        }
        if (path.endsWith('/peers'))
          return [{ pubkey: primary, state: 'connected' }];
        throw new Error(`Unexpected wallet request: ${path}`);
      },
    },
  });
  const prepareSend = jest.fn(core.prepareSend.bind(core));
  const { tree } = await draw(
    {
      quoteMax: core.quoteMax.bind(core),
      prepareSend,
    },
    { initialRequest: ADDRESS },
  );
  expect(tree.root.findByType(Chip).props.label).toBe('99,421 sats');
  await press(tree, '99,421 sats');
  await press(tree, copy.send.review);
  expect(prepareSend).toHaveBeenCalledWith({ request: ADDRESS, max: true });
  const prepared = await prepareSend.mock.results[0].value;
  expect(prepared.amountSats).toBe(99421);
  expect(prepared.warnings.join(' ')).toContain('funding is unconfirmed');
});

test('typing deselects max and continues with the typed amount', async () => {
  const { tree, client } = await draw();
  await press(tree, '198,000 sats');
  await enterAmount(tree, '4200');
  expect(tree.root.findByType(Chip).props.selected).toBe(false);
  await press(tree, copy.send.review);
  expect(client.prepareSend).toHaveBeenCalledWith({
    request: INVOICE,
    amountSats: 4200,
  });
});

test.each([
  { disabled: true },
  { primaryConnected: false },
  { initialRequest: `bitcoin:${ADDRESS}?amount=0.0001` },
  { initialRequest: '' },
])(
  'max is absent until request and wallet gates permit it: %j',
  async props => {
    const { tree, client } = await draw({}, props);
    expect(tree.root.findAllByType(Chip)).toHaveLength(0);
    expect(client.quoteMax).not.toHaveBeenCalled();
  },
);

test('a slow or empty quote draws no busy chip, and an old answer cannot cross requests', async () => {
  let answer!: (quote: MaxQuote) => void;
  const quoteMax = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<MaxQuote>(resolve => {
          answer = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...maximum, amountSats: 0 });
  const { tree, update } = await draw({ quoteMax });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  await update({ initialRequest: ADDRESS });
  await act(async () => answer(maximum));
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
});

test('a refreshed selected max updates its readout, and disconnect hides the chip', async () => {
  let answer!: (quote: MaxQuote) => void;
  const quoteMax = jest
    .fn()
    .mockResolvedValueOnce(maximum)
    .mockResolvedValueOnce({ ...maximum, amountSats: 200000 })
    .mockImplementationOnce(
      () =>
        new Promise<MaxQuote>(resolve => {
          answer = resolve;
        }),
    );
  const { tree, update } = await draw({ quoteMax });
  await press(tree, '198,000 sats');
  await update({ quoteRevision: 2 });
  expect(amountValue(tree)).toBe('200000');
  expect(tree.root.findByType(Chip).props.selected).toBe(true);
  await update({ quoteRevision: 3 });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  expect(amountValue(tree)).toBe('200000');
  await act(async () => answer({ ...maximum, amountSats: 205000 }));
  expect(amountValue(tree)).toBe('205000');
  await update({ primaryConnected: false });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  expect(amountValue(tree)).toBe('205000');
  expect(tree.root.findByType(AmountReadout).props.tone).toBe('plain');
});

test('pay-all review shows and speaks three bounds and whispers the retained balance', async () => {
  const { tree, client } = await draw();
  await press(tree, '198,000 sats');
  await press(tree, copy.send.review);
  expect(
    reviewFigures(review()).map(figure => [figure.signs, figure.sats]),
  ).toEqual([
    ['≤', 2000],
    ['', 200000],
  ]);
  expect(reviewWords(review())).toBe(
    'Recipient at least 198,000 sats. Routing fee at most 2,000 sats. Total debit 200,000 sats.',
  );
  expect(tree.root.findByType(Amount).props.minimum).toBe(true);
  expect(tree.root.findByType(Amount).props.sats).toBe(198000);
  const whispers = tree.root.findAllByType(Whisper);
  expect(
    whispers.some(
      node =>
        node.props.label ===
          'Everything you can send. 1,402 sats stay in your channel.' &&
        node.props.enabled,
    ),
  ).toBe(true);
  expect(
    tree.root.findAllByType(Text).some(node => node.props.children === '≥'),
  ).toBe(true);
  expect(copyViolations(tree, { data: [shortRequest(INVOICE)] })).toEqual([]);
  expect(a11yProblems(tree)).toEqual([]);
  await activate(tree, copy.send.sendMax);
  expect(client.send).toHaveBeenCalledWith(
    expect.objectContaining({ debitMsat: '200000000', maxFeeMsat: '2000000' }),
  );
  expect(tree.root.findByType(Amount).props.sats).toBe(199998);
});

test('address max keeps ordinary review lines and refresh keeps max selected', async () => {
  const addressReview = {
    ...review(),
    route: 'bitcoin' as const,
    minRecipientSats: undefined,
    debitMsat: undefined,
  };
  const { tree, client } = await draw(
    { prepareSend: jest.fn().mockResolvedValue(addressReview) },
    { initialRequest: ADDRESS },
  );
  await press(tree, '198,000 sats');
  await press(tree, copy.send.review);
  expect(tree.root.findByType(Amount).props.minimum).toBe(false);
  expect(reviewFigures(addressReview).map(figure => figure.signs)).toEqual([
    '+ ≤',
    '=',
  ]);
  await press(tree, copy.send.edit);
  expect(tree.root.findByType(Chip).props.selected).toBe(true);
  await press(tree, copy.send.review);
  expect(client.prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    max: true,
  });
});
