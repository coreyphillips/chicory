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
import type { SendHandle } from '../../../screens/Send';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { amountValue, enterAmount } from '../../../../test-support/keypad';
import {
  activate,
  find,
  press,
  visibleText,
} from '../../../../test-support/query';
import { copyViolations } from '../../../../test-support/copyGuard';
import { a11yProblems } from '../../../../test-support/a11y';
import { Amount } from '../Amount';
import { FeeSlider } from '../FeeSlider';
import { reviewFigures, reviewWords, shortRequest } from '../model';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OTHER_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
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

test.each([INVOICE, `bitcoin:${ADDRESS}?lightning=${INVOICE}`])(
  'the Lightning max chip fills the readout and prepares max for %s',
  async request => {
    const { tree, client } = await draw({}, { initialRequest: request });
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
      request,
      max: true,
    });
  },
);

test.each([ADDRESS, `bitcoin:${ADDRESS}?label=Coffee`])(
  'keying an amount after a camera scan never requests an onchain quote for %s',
  async request => {
    const ref = React.createRef<SendHandle>();
    const balance = {
      totalSats: 300_000,
      availableSats: 300_000,
      pendingSats: 0,
      receivableSats: 0,
    };
    const { tree, client, update } = await draw(
      {},
      { ref, initialRequest: '', balance, quoteRevision: 1 },
    );
    await act(async () => ref.current!.receive(request, 'camera'));
    expect(visibleText(tree)).toContain('100%');
    expect(find(tree, copy.send.reviewMax)).toBeDefined();
    expect(copyViolations(tree, { data: [shortRequest(request)] })).toEqual([]);
    await enterAmount(tree, '42');
    await update({ quoteRevision: 2 });
    await press(tree, '0');
    await press(tree, '0');
    expect(amountValue(tree)).toBe('4200');
    expect(client.prepareSend).not.toHaveBeenCalled();
    expect(client.quoteMax).not.toHaveBeenCalled();
    const reviewButton = tree.root
      .findAllByProps({ accessibilityLabel: copy.send.review })
      .filter(node => typeof node.props.onPress === 'function')
      .at(-1)!;
    await act(async () => reviewButton.props.onPress({ nativeEvent: {} }));
    expect(client.prepareSend).toHaveBeenCalledTimes(1);
    expect(client.prepareSend).toHaveBeenCalledWith({
      request,
      amountSats: 4200,
    });
    expect(client.send).not.toHaveBeenCalled();
  },
);

test('a digit immediately followed by Review prices the last tap', async () => {
  const { tree, client } = await draw({}, { initialRequest: ADDRESS });
  await enterAmount(tree, '420');
  await act(async () => {
    find(tree, '0')!.props.onPress();
    find(tree, copy.send.review)!.props.onPress();
  });
  expect(client.prepareSend).toHaveBeenCalledWith({
    request: ADDRESS,
    amountSats: 4200,
  });
});

test('immediate Review after backspace uses the edited amount instead of max', async () => {
  const { tree, client } = await draw();
  await press(tree, '198,000 sats');
  await act(async () => {
    find(tree, copy.keypad.backspace)!.props.onPress();
    find(tree, copy.send.review)!.props.onPress();
  });
  expect(client.prepareSend).toHaveBeenCalledWith({
    request: INVOICE,
    amountSats: 19800,
  });
});

test('clearing the last digit before Review leaves the keypad open', async () => {
  const { tree, client } = await draw({}, { initialRequest: ADDRESS });
  await enterAmount(tree, '1');
  await act(async () => {
    find(tree, copy.keypad.backspace)!.props.onPress();
    find(tree, copy.send.review)!.props.onPress();
  });
  expect(amountValue(tree)).toBe('');
  expect(client.prepareSend).not.toHaveBeenCalled();
});

test('the installed wallet core reviews address max once on demand before home funding confirms', async () => {
  const primary = DEFAULT_PRIMARY_URI.split('@')[0];
  const spliceQuotes: number[] = [];
  const core = new EmbeddedWalletClient({
    walletId: 'unconfirmed',
    runtime: {
      request: async ({ path, body }) => {
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
        if (path.endsWith('/fees/estimates'))
          return { fast: 8, normal: 2, slow: 1, minimum: 1 };
        if (path.endsWith('/channel/splice-quote')) {
          // A splice of 1,158 weight units, priced at the rate asked for.
          const { feeratePerkw } = body as { feeratePerkw: number };
          spliceQuotes.push(feeratePerkw);
          const feeSats = Math.ceil((1158 * feeratePerkw) / 1000);
          return { feeSats, maxAmountSats: 100000 - feeSats };
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
  expect(spliceQuotes).toEqual([]);
  await press(tree, copy.send.reviewMax);
  expect(prepareSend).toHaveBeenCalledWith({ request: ADDRESS, max: true });
  expect(spliceQuotes).toEqual([500]);
  const prepared = await prepareSend.mock.results[0].value;
  expect(prepared.amountSats).toBe(99421);
  expect(prepared.warnings.join(' ')).toContain('funding is unconfirmed');
  // The slider prices the max again at the rate chosen: the fee rises, the
  // amount gives way, and Edit keeps the amount last reviewed.
  const slider = () => tree.root.findByType(FeeSlider);
  expect(slider().props).toMatchObject({
    rate: 2,
    rates: { fast: 8, normal: 2, slow: 1, minimum: 1 },
    feeSats: 579,
  });
  await act(async () => {
    await slider().props.onChoose(8);
  });
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    max: true,
    feeRate: 8,
  });
  const rated = await prepareSend.mock.results[1].value;
  expect(rated).toMatchObject({ feeRate: 8, feeSats: 2316, amountSats: 97684 });
  expect(slider().props).toMatchObject({ rate: 8, feeSats: 2316 });
  await press(tree, copy.send.edit);
  expect(amountValue(tree)).toBe('97684');
  expect(spliceQuotes).toEqual([500, 2000]);
  await enterAmount(tree, '25000');
  await press(tree, copy.send.review);
  expect(prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    amountSats: 25000,
    feeRate: 8,
  });
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
  { initialRequest: ADDRESS, disabled: true },
  { initialRequest: ADDRESS, primaryConnected: false },
  {
    initialRequest: ADDRESS,
    balance: {
      totalSats: 0,
      availableSats: 0,
      pendingSats: 0,
      receivableSats: 0,
    },
  },
  { initialRequest: `bitcoin:${ADDRESS}?amount=0.0001` },
  { initialRequest: '' },
])(
  'max is absent until request and wallet gates permit it: %j',
  async props => {
    const { tree, client } = await draw({}, props);
    expect(tree.root.findAllByType(Chip)).toHaveLength(0);
    expect(find(tree, copy.send.reviewMax)).toBeUndefined();
    expect(client.quoteMax).not.toHaveBeenCalled();
  },
);

test('a late Lightning max cannot replace the next address max control', async () => {
  let answer!: (quote: MaxQuote) => void;
  const quoteMax = jest.fn(
    () =>
      new Promise<MaxQuote>(resolve => {
        answer = resolve;
      }),
  );
  const { tree, update } = await draw({ quoteMax });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  await update({ initialRequest: ADDRESS });
  await act(async () => answer(maximum));
  expect(find(tree, '198,000 sats')).toBeUndefined();
  expect(find(tree, copy.send.reviewMax)).toBeDefined();
  expect(quoteMax).toHaveBeenCalledTimes(1);
});

test.each(['request', 'wallet'])(
  'an address max review arriving after a change of %s leaves the new draft editable',
  async changed => {
    let answer!: (quote: SendReview) => void;
    const prepareSend = jest.fn(
      () =>
        new Promise<SendReview>(resolve => {
          answer = resolve;
        }),
    );
    const { tree, client, update } = await draw(
      { prepareSend },
      { initialRequest: ADDRESS },
    );
    await act(async () => {
      find(tree, copy.send.reviewMax)!.props.onPress();
    });
    expect(prepareSend).toHaveBeenCalledWith({ request: ADDRESS, max: true });
    await update(
      changed === 'request'
        ? { initialRequest: OTHER_ADDRESS }
        : { client: { ...client } },
    );
    await act(async () =>
      answer({ ...review(), destination: ADDRESS, route: 'bitcoin' }),
    );
    expect(tree.root.findAllByType(Amount)).toHaveLength(0);
    expect(amountValue(tree)).toBe('');
    await enterAmount(tree, '300');
    expect(amountValue(tree)).toBe('300');
    expect(prepareSend).toHaveBeenCalledTimes(1);
    expect(client.send).not.toHaveBeenCalled();
  },
);

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'a scan cancels a review resolved in the same batch (max=%s, rescanOriginal=%s)',
  async (max, rescanOriginal) => {
    const ref = React.createRef<SendHandle>();
    const currentAddress = rescanOriginal ? ADDRESS : OTHER_ADDRESS;
    const amountSats = max ? 198000 : 420;
    const quoted: SendReview = {
      id: 'address-review',
      destination: ADDRESS,
      route: 'bitcoin',
      amountSats,
      description: '',
      feeLabel: 'Network fee',
      feeSats: 10,
      totalSats: amountSats + 10,
      expiresAt: Date.now() + 60000,
      warnings: [],
      ...(max ? { max: true } : {}),
    };
    let answer!: (quote: SendReview) => void;
    const prepareSend = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SendReview>(resolve => {
            answer = resolve;
          }),
      )
      .mockResolvedValue({ ...quoted, destination: currentAddress });
    const { tree } = await draw(
      { prepareSend },
      { initialRequest: ADDRESS, ref },
    );
    const button = max ? copy.send.reviewMax : copy.send.review;
    if (!max) await enterAmount(tree, '420');
    await act(async () => {
      find(tree, button)!.props.onPress();
    });
    await act(async () => {
      ref.current!.receive(OTHER_ADDRESS, 'camera');
      if (rescanOriginal) ref.current!.receive(ADDRESS, 'camera');
      answer(quoted);
    });
    expect(tree.root.findAllByType(Amount)).toHaveLength(0);
    expect(amountValue(tree)).toBe(max ? '' : '420');
    await press(tree, button);
    expect(prepareSend).toHaveBeenLastCalledWith({
      request: currentAddress,
      ...(max ? { max: true } : { amountSats: 420 }),
    });
    expect(tree.root.findAllByType(Amount)).toHaveLength(1);
  },
);

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
  const chip = tree.root.findByType(Chip);
  await update({ quoteRevision: 3 });
  expect(tree.root.findByType(Chip)).toBe(chip);
  expect(chip.props.label).toBe('200,000 sats');
  expect(amountValue(tree)).toBe('200000');
  await act(async () => answer({ ...maximum, amountSats: 205000 }));
  expect(amountValue(tree)).toBe('205000');
  await update({ primaryConnected: false });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  expect(amountValue(tree)).toBe('205000');
  expect(tree.root.findByType(AmountReadout).props.tone).toBe('plain');
});

test.each(['empty', 'invalid', 'refused'])(
  'a %s refresh clears the retained max, and a later quote restores it',
  async outcome => {
    let answer!: (quote: MaxQuote) => void;
    let refuse!: (error: Error) => void;
    const quoteMax = jest
      .fn()
      .mockResolvedValueOnce(maximum)
      .mockImplementationOnce(
        () =>
          new Promise<MaxQuote>((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          }),
      )
      .mockResolvedValueOnce({ ...maximum, amountSats: 199000 });
    const { tree, update } = await draw({ quoteMax });
    const chip = tree.root.findByType(Chip);
    await update({ quoteRevision: 2 });
    expect(tree.root.findByType(Chip)).toBe(chip);
    await act(async () => {
      if (outcome === 'refused') refuse(new Error('Channel unavailable'));
      else answer({ ...maximum, amountSats: outcome === 'empty' ? 0 : NaN });
    });
    expect(tree.root.findAllByType(Chip)).toHaveLength(0);
    await update({ quoteRevision: 3 });
    expect(tree.root.findByType(Chip).props.label).toBe('199,000 sats');
  },
);

test('a retained max can start a fresh review while its background quote is pending', async () => {
  const quoteMax = jest
    .fn()
    .mockResolvedValueOnce(maximum)
    .mockImplementationOnce(() => new Promise<MaxQuote>(() => {}));
  const { tree, client, update } = await draw({ quoteMax });
  await update({ quoteRevision: 2 });
  await press(tree, '198,000 sats');
  await press(tree, copy.send.review);
  expect(client.prepareSend).toHaveBeenCalledWith({
    request: INVOICE,
    max: true,
  });
  expect(client.send).not.toHaveBeenCalled();
});

test('a changed wallet drops its cached max and a late refusal cannot clear the new quote', async () => {
  let refuse!: (error: Error) => void;
  let answer!: (quote: MaxQuote) => void;
  const quoteMax = jest
    .fn()
    .mockResolvedValueOnce(maximum)
    .mockImplementationOnce(
      () =>
        new Promise<MaxQuote>((_resolve, reject) => {
          refuse = reject;
        }),
    );
  const { tree, client, update } = await draw({ quoteMax });
  await update({ quoteRevision: 2 });
  expect(tree.root.findByType(Chip).props.label).toBe('198,000 sats');
  const nextClient = {
    ...client,
    quoteMax: jest.fn(
      () =>
        new Promise<MaxQuote>(resolve => {
          answer = resolve;
        }),
    ),
  };
  await update({ client: nextClient });
  expect(tree.root.findAllByType(Chip)).toHaveLength(0);
  await act(async () => answer({ ...maximum, amountSats: 300000 }));
  expect(tree.root.findByType(Chip).props.label).toBe('300,000 sats');
  await act(async () => refuse(new Error('Old wallet unavailable')));
  expect(tree.root.findByType(Chip).props.label).toBe('300,000 sats');
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
  await press(tree, copy.send.reviewMax);
  expect(tree.root.findByType(Amount).props.minimum).toBe(false);
  expect(reviewFigures(addressReview).map(figure => figure.signs)).toEqual([
    '+ ≤',
    '=',
  ]);
  await press(tree, copy.send.edit);
  expect(amountValue(tree)).toBe('198000');
  await press(tree, copy.send.review);
  expect(client.prepareSend).toHaveBeenLastCalledWith({
    request: ADDRESS,
    max: true,
  });
  expect(client.prepareSend).toHaveBeenCalledTimes(2);
  expect(client.send).not.toHaveBeenCalled();
});
