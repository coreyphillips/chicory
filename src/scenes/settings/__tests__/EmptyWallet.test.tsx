import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type {
  DrainProgress,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { Scanner } from '../../../components/Scanner';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { forgetPendingHaptics, haptics } from '../../../design/haptics';
import { CopyChip } from '../../../glyphs/CopyChip';
import { chipText } from '../../../glyphs/chipText';
import * as Speech from '../../../motion/speech';
import { DetailScreen } from '../../../screens/wallet/Detail';
import { SettingsScreen } from '../../../screens/Settings';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import type { Unit } from '../../../theme';
import {
  ADDRESS,
  clientOf,
  drainReviewOf,
  onMainnet,
  refusal,
} from '../../../../native-tests/gallery/fakes';
import {
  activate,
  field,
  find,
  holdMs,
  holds,
  press,
  visibleText,
} from '../../../../test-support/query';
import { copyViolations } from '../../../../test-support/copyGuard';
import {
  DRAIN_POLL_MS,
  EmptyWallet,
  amountText,
  progressNote,
} from '../EmptyWallet';
import { CopyLine, Line, Note, SettingsSurface } from '../ui';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

const w = copy.settings.empty;
const said = jest.mocked(announce);
const trees: ReactTestRenderer[] = [];

/** A drain in Activity, as the wallet's history carries one. */
const snapshotWith = (drain: DrainProgress) =>
  onMainnet({
    activity: [
      {
        id: `drain:${drain.requestId}`,
        kind: 'sent',
        title: 'Emptying wallet',
        description: '',
        amountSats: drain.amountSats,
        feeSats: drain.feeSats,
        status:
          drain.phase === 'completed'
            ? 'completed'
            : drain.phase === 'cancelled'
            ? 'failed'
            : drain.phase === 'review'
            ? 'uncertain'
            : 'pending',
        timestamp: Date.now(),
        reference: drain.requestId,
        drain,
      },
    ],
  });

/** A drain under way, from the review the fakes prepare. */
const underWay = (over: Partial<DrainProgress> = {}): DrainProgress => ({
  ...drainReviewOf().drain!,
  revision: 4,
  phase: 'pending',
  ...over,
});

interface Draw {
  over?: Partial<WalletAdapter>;
  snapshot?: WalletSnapshot;
  unit?: Unit;
  symbol?: boolean;
  onClose?: () => void;
}

async function draw({
  over = {},
  snapshot = onMainnet(),
  unit,
  symbol,
  onClose,
}: Draw = {}) {
  const review = drainReviewOf();
  const progress = {
    ...review.drain!,
    revision: 2,
    phase: 'pending' as const,
    txids: ['ab'.repeat(32), 'cd'.repeat(32)],
  };
  const client = clientOf({
    prepareDrain: jest.fn().mockResolvedValue(review),
    cancelDrain: jest
      .fn()
      .mockResolvedValue({ ...progress, phase: 'cancelled' }),
    getDrain: jest.fn().mockResolvedValue(progress),
    send: jest.fn().mockResolvedValue({
      id: review.id,
      status: 'pending',
      amountSats: review.amountSats,
      feeSats: review.feeSats,
      drain: progress,
      message: 'Pending',
    }),
    ...over,
  });
  const onRead = jest.fn();
  // The hold is a gesture, which needs the app's gesture root.
  const element = (read: WalletSnapshot) => (
    <GestureHandlerRootView>
      <SettingsSurface>
        <EmptyWallet
          client={client}
          snapshot={read}
          onRead={onRead}
          unit={unit}
          symbol={symbol}
          onClose={onClose}
        />
      </SettingsSurface>
    </GestureHandlerRootView>
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element(snapshot));
  });
  trees.push(tree);
  const update = async (next: WalletSnapshot) => {
    await act(async () => tree.update(element(next)));
  };
  return { tree, client, review, progress, onRead, update };
}

async function enter(tree: ReactTestRenderer, address = ADDRESS) {
  await press(tree, w.link);
  await act(async () => {
    field(tree, w.address).props.onChangeText(address);
  });
  await press(tree, w.review);
}

/** Presses `label` and leaves what it started running. */
const start = (tree: ReactTestRenderer, label: string) =>
  act(async () => {
    find(tree, label)!.props.onPress();
  });

/** A call that answers only when told to. */
function later<T>() {
  let answer!: (value: T) => void;
  let refuse!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  return { promise, answer, refuse };
}

/** The host element a screen reader reaches for the control `label`. */
const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  )[0];

/** What each focus move landed on, by its label or the text it holds. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, kind]) => kind === 'focus')
    .map(([node]) => {
      const { props } = node as unknown as ReactTestInstance;
      return props.accessibilityLabel ?? props.children;
    });

/** Focus moves once nothing is moving, which here is the next tick. */
const settle = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  });

const logged = () =>
  recentDiagnostics().map(({ code, message }) => code ?? message);

beforeEach(() => {
  said.mockClear();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  clearDiagnostics();
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  // A safety message one test left unheard is not said in the next, nor the
  // held haptic's second beat felt there.
  Speech.forgetSafety();
  forgetPendingHaptics();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Settings as the hub draws it, on mainnet, with `client`. */
async function hub(client: WalletAdapter, snapshot = onMainnet()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <SettingsScreen
          snapshot={snapshot}
          client={client}
          switchError=""
          onDisconnect={jest.fn()}
          onRefresh={jest.fn()}
          onNetwork={jest.fn()}
        />
      </GestureHandlerRootView>,
    );
  });
  trees.push(tree);
  return tree;
}

test('Settings offers draining only when the engine supports it, in Funds and exits before Lock', async () => {
  for (const supported of [false, true]) {
    const tree = await hub(
      clientOf({
        getConfig: jest.fn().mockResolvedValue({ drainAvailable: supported }),
      }),
    );
    const labels = tree.root
      .findAll(
        node => typeof node.type === 'string' && node.props.accessibilityLabel,
      )
      .map(node => node.props.accessibilityLabel);
    expect(labels.includes(w.link)).toBe(supported);
    if (supported) {
      const at = (label: string) => labels.indexOf(label);
      expect(at(copy.settings.primary.heading)).toBeGreaterThanOrEqual(0);
      expect(at(w.link)).toBeGreaterThan(at(copy.settings.primary.heading));
      expect(at(copy.settings.wallet.lock)).toBeGreaterThan(at(w.link));
    }
  }
});

test('its row opens it at its warning, and Keep my channel closes the row and lands back on it', async () => {
  const warning = jest.spyOn(haptics, 'warning');
  const client = clientOf({
    getConfig: jest.fn().mockResolvedValue({ drainAvailable: true }),
  });
  const tree = await hub(client);
  // Closed, nothing of it is drawn.
  expect(visibleText(tree)).not.toContain(w.warning);
  await press(tree, w.link);
  await settle();
  expect(visibleText(tree)).toContain(w.warning);
  expect(warning).toHaveBeenCalledTimes(1);
  // It opened as a row opens it: no link of its own.
  expect(
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === w.link &&
        typeof node.props.onPress === 'function',
    ),
  ).toHaveLength(1);
  expect(focused()).toEqual([w.warning]);
  await press(tree, w.keep);
  await settle();
  expect(visibleText(tree)).not.toContain(w.warning);
  expect(focused().at(-1)).toBe(w.link);
  expect(control(tree, w.link).props.accessibilityState).toMatchObject({
    expanded: false,
  });
});

test('a drain under way opens its row as Settings opens, and says so on the row once closed', async () => {
  const client = clientOf({
    getConfig: jest.fn().mockResolvedValue({ drainAvailable: true }),
    getDrain: jest.fn().mockResolvedValue(underWay()),
  });
  const tree = await hub(client, snapshotWith(underWay()));
  expect(visibleText(tree)).toContain(w.pending);
  await press(tree, w.link);
  expect(visibleText(tree)).not.toContain(w.pending);
  expect(control(tree, w.link).props.accessibilityValue).toEqual({
    text: w.underway,
  });
  expect(visibleText(tree)).toContain(w.underway);
});

test('drain review shows the total arrival, both network fees and the address in full', async () => {
  const f = await draw();
  await enter(f.tree);
  expect(f.client.prepareDrain).toHaveBeenCalledWith({ address: ADDRESS });
  expect(f.client.send).not.toHaveBeenCalled();
  expect(f.tree.root.findAllByType(Line).map(line => line.props)).toEqual([
    {
      label: w.arrives,
      value: '261,000 sats',
      said: '261,000 sats',
      focus: true,
    },
    { label: w.fees, value: '500 sats', said: '500 sats' },
  ]);
  // Labelled and wrapping, as the node address is, never cut short.
  expect(f.tree.root.findByType(CopyLine).props).toEqual({
    label: w.address,
    value: ADDRESS,
    shown: chipText(ADDRESS, true),
    copyLabel: w.copy,
    copiedLabel: w.copied,
  });
  expect(f.tree.root.findAllByType(CopyChip)).toHaveLength(0);
  expect(copyViolations(f.tree, { data: [ADDRESS] })).toEqual([]);
});

test('the review is held for 1000ms in honey, and the hold says what it sends', async () => {
  const f = await draw();
  await enter(f.tree);
  expect(holdMs(f.tree, w.send)).toBe(1000);
  const [hold] = holds(f.tree, w.send);
  expect(hold.props.accessibilityHint).toBe(w.hold);
  expect(hold.props.accessibilityValue).toEqual({
    text: w.said('261,000 sats', '500 sats'),
  });
  // Its name is drawn under it for a finger, and heard from the hold.
  expect(visibleText(f.tree)).toContain(w.send);
  const named = f.tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.children === w.send &&
      node.props.accessibilityElementsHidden === true,
  );
  expect(named).toHaveLength(1);
});

test('amounts are drawn in the wallet’s unit, and heard in sats', async () => {
  for (const [unit, symbol, arrives, fees] of [
    ['sats', true, '₿261,000', '₿500'],
    ['btc', false, '0.00261 BTC', '0.000005 BTC'],
  ] as const) {
    const f = await draw({ unit, symbol });
    await enter(f.tree);
    expect(f.tree.root.findAllByType(Line).map(line => line.props)).toEqual([
      { label: w.arrives, value: arrives, said: '261,000 sats', focus: true },
      { label: w.fees, value: fees, said: '500 sats' },
    ]);
    expect(holds(f.tree, w.send)[0].props.accessibilityValue).toEqual({
      text: w.said('261,000 sats', '500 sats'),
    });
  }
  expect(amountText(261_000, 'sats')).toBe('261,000 sats');
  expect(amountText(261_000, 'sats', true)).toBe('₿261,000');
  expect(amountText(261_000, 'btc', true)).toBe('0.00261 BTC');
});

test('what stays in the wallet after the drain is in its unit too, and heard in sats', async () => {
  const f = await draw({
    snapshot: snapshotWith(underWay({ residualSats: 1_200 })),
    symbol: true,
  });
  const residual = f.tree.root
    .findAllByType(Note)
    .find(note => note.props.said)!;
  expect(residual.props.children).toBe(w.residual('₿1,200'));
  expect(residual.props.said).toBe(w.residual('1,200 sats'));
  expect(control(f.tree, w.residual('1,200 sats'))).toBeDefined();
});

test('drain refuses amount-bearing links and wrong-network destinations before review, and logs neither', async () => {
  const error = jest.spyOn(haptics, 'error');
  const f = await draw();
  await enter(f.tree, `bitcoin:${ADDRESS}?amount=0.0001`);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
  expect(visibleText(f.tree)).toContain(w.noAmount);
  await act(async () => {
    field(f.tree, w.address).props.onChangeText('bc1invalid');
  });
  await press(f.tree, w.review);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
  expect(visibleText(f.tree)).toContain(w.addressOnly);
  // Felt as errors, but nothing reached the engine to log.
  expect(error).toHaveBeenCalledTimes(2);
  expect(recentDiagnostics()).toEqual([]);
});

test('drain scan reads an address, with the same address-only check, and fills the field', async () => {
  const f = await draw();
  await press(f.tree, w.link);
  await press(f.tree, w.scan);
  // Drawn alone there is no overlay to ask, so the scanner is drawn in
  // place: no modal.
  const scan = f.tree.root.findByType(Scanner);
  expect(scan.props.purpose).toBe('address');
  expect(() => scan.props.validate(`bitcoin:${ADDRESS}?amount=0.1`)).toThrow(
    w.noAmount,
  );
  expect(scan.props.validate(`bitcoin:${ADDRESS}`)).toBe(ADDRESS);
  await act(async () => {
    scan.props.onDetected(ADDRESS);
  });
  expect(f.tree.root.findAllByType(Scanner)).toHaveLength(0);
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
  await settle();
  expect(focused().at(-1)).toBe(w.address);
  // A close fills nothing, and lands back on the scan button.
  await press(f.tree, w.scan);
  await act(async () => {
    f.tree.root.findByType(Scanner).props.onCancel();
  });
  await settle();
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(focused().at(-1)).toBe(w.scan);
});

test('drain paste fills the address without submitting, and says so', async () => {
  jest.mocked(Clipboard.getString).mockResolvedValueOnce(`bitcoin:${ADDRESS}`);
  const f = await draw();
  await press(f.tree, w.link);
  await press(f.tree, w.paste);
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.send).not.toHaveBeenCalled();
  expect(said).toHaveBeenCalledWith(w.pasted);
});

test.each([
  ['an empty clipboard', () => Promise.resolve('  '), w.clipboardEmpty],
  [
    'a clipboard it cannot read',
    () => Promise.reject(new Error('denied')),
    w.clipboardUnreadable,
  ],
])('%s is felt and said, and fills nothing', async (_, answer, why) => {
  const error = jest.spyOn(haptics, 'error');
  jest.mocked(Clipboard.getString).mockImplementationOnce(answer);
  const f = await draw();
  await press(f.tree, w.link);
  await press(f.tree, w.paste);
  expect(visibleText(f.tree)).toContain(why);
  expect(said).toHaveBeenCalledWith(why);
  expect(said).not.toHaveBeenCalledWith(w.pasted);
  expect(error).toHaveBeenCalledTimes(1);
  expect(field(f.tree, w.address).props.value).toBe('');
  expect(recentDiagnostics()).toEqual([]);
});

test('Keep my channel cancels the review without sending', async () => {
  const f = await draw();
  await enter(f.tree);
  await press(f.tree, w.keep);
  expect(f.client.cancelDrain).toHaveBeenCalledWith(f.review.id);
  expect(f.client.send).not.toHaveBeenCalled();
  expect(visibleText(f.tree)).toContain(w.link);
  expect(said).toHaveBeenCalledWith(w.keeping);
});

test('the hold commits once and shows pending progress without another send control', async () => {
  const soft = jest.spyOn(haptics, 'soft');
  const f = await draw();
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(f.client.send).toHaveBeenCalledTimes(1);
  expect(f.client.send).toHaveBeenCalledWith(f.review);
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(visibleText(f.tree)).not.toContain(w.send);
  expect(f.onRead).toHaveBeenCalled();
  expect(soft).toHaveBeenCalledTimes(1);
});

test('each operation turns only its own control to an orbit', async () => {
  const preparing = later<SendReview>();
  const pasting = later<string>();
  const sending = later<unknown>();
  const keeping = later<DrainProgress>();
  jest.mocked(Clipboard.getString).mockReturnValueOnce(pasting.promise);
  const f = await draw({
    over: {
      prepareDrain: jest.fn().mockReturnValue(preparing.promise),
      send: jest.fn().mockReturnValue(sending.promise),
      cancelDrain: jest.fn().mockReturnValue(keeping.promise),
    },
  });
  const state = (label: string) =>
    control(f.tree, label).props.accessibilityState;
  await press(f.tree, w.link);
  await start(f.tree, w.paste);
  expect(state(w.paste)).toEqual({ disabled: true, busy: true });
  expect(state(w.review)).toEqual({ disabled: true, busy: false });
  expect(state(w.keep)).toEqual({ disabled: true, busy: false });
  await act(async () => pasting.answer(ADDRESS));
  expect(state(w.paste)).toEqual({ disabled: false, busy: false });
  await start(f.tree, w.review);
  expect(state(w.review)).toEqual({ disabled: true, busy: true });
  expect(state(w.paste)).toEqual({ disabled: true, busy: false });
  await act(async () => preparing.answer(f.review));
  await activate(f.tree, w.send);
  expect(state(w.send)).toEqual({ disabled: false, busy: true });
  expect(state(w.keep)).toEqual({ disabled: true, busy: false });
  await act(async () =>
    sending.answer({
      id: f.review.id,
      status: 'pending',
      amountSats: f.review.amountSats,
      feeSats: f.review.feeSats,
      drain: { ...f.progress, phase: 'preparing' },
      message: 'Pending',
    }),
  );
  await start(f.tree, w.keep);
  expect(state(w.keep)).toEqual({ disabled: true, busy: true });
  await act(async () =>
    keeping.answer({ ...f.progress, revision: 3, phase: 'cancelled' }),
  );
  expect(visibleText(f.tree)).toContain(w.link);
});

test('an unknown drain outcome stays uncertain and allows only authoritative cancellation', async () => {
  const review = drainReviewOf();
  const f = await draw({
    over: {
      send: jest.fn().mockResolvedValue({
        id: review.id,
        status: 'uncertain',
        amountSats: review.amountSats,
        feeSats: review.feeSats,
        drain: review.drain,
        message: 'Unknown',
      }),
    },
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain(w.uncertain);
  expect(visibleText(f.tree)).not.toContain(w.send);
  await press(f.tree, w.keep);
  expect(f.client.cancelDrain).toHaveBeenCalledTimes(1);
});

test('an unknown start is a safety state: honey, held, logged and said assertively', async () => {
  const held = jest.spyOn(haptics, 'held');
  const safety = jest.spyOn(Speech, 'announceSafety');
  const review = drainReviewOf();
  const f = await draw({
    over: {
      send: jest.fn().mockResolvedValue({
        id: review.id,
        status: 'uncertain',
        amountSats: review.amountSats,
        feeSats: review.feeSats,
        drain: review.drain,
        message: 'The wallet drain is pending.',
      }),
    },
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  const note = f.tree.root.findAllByType(Note)[0];
  expect(note.props.tone).toBe('warning');
  expect(held).toHaveBeenCalledTimes(1);
  expect(safety).toHaveBeenCalledWith(w.uncertainAnnouncement, 'held');
  // Logged once, with the engine's own words.
  expect(recentDiagnostics()).toEqual([
    expect.objectContaining({
      phase: 'ui',
      code: 'UNCERTAIN',
      message: 'The wallet drain is pending.',
    }),
  ]);
});

test('an unknown start restored from the history is felt and logged as it shows', async () => {
  const held = jest.spyOn(haptics, 'held');
  await draw({ snapshot: snapshotWith(underWay({ phase: 'review' })) });
  expect(held).toHaveBeenCalledTimes(1);
  expect(logged()).toEqual(['UNCERTAIN']);
  expect(recentDiagnostics()[0].message).toBe(w.uncertain);
});

test('an expired review returns to address entry for a new review', async () => {
  const f = await draw({
    over: {
      send: jest.fn().mockRejectedValue(new Error('The quote expired.')),
    },
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain('The quote expired.');
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.send).toHaveBeenCalledTimes(1);
});

test('an engine refusal is felt and logged with its own code, wherever it comes from', async () => {
  const error = jest.spyOn(haptics, 'error');
  const f = await draw({
    over: {
      prepareDrain: jest
        .fn()
        .mockRejectedValueOnce(refusal('Nothing to send.', 'NOTHING_TO_SEND'))
        .mockResolvedValue(drainReviewOf()),
      send: jest
        .fn()
        .mockRejectedValue(refusal('This fee quote expired.', 'QUOTE_EXPIRED')),
      cancelDrain: jest
        .fn()
        .mockRejectedValue(
          refusal('Cancel refused.', 'DRAIN_ALREADY_COMMITTED'),
        ),
    },
  });
  await enter(f.tree);
  expect(visibleText(f.tree)).toContain('Nothing to send.');
  await press(f.tree, w.review);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain('This fee quote expired.');
  await press(f.tree, w.review);
  await press(f.tree, w.keep);
  expect(visibleText(f.tree)).toContain('Cancel refused.');
  expect(error).toHaveBeenCalledTimes(3);
  expect(recentDiagnostics()).toEqual([
    {
      at: expect.any(String),
      phase: 'ui',
      code: 'NOTHING_TO_SEND',
      message: 'Nothing to send.',
    },
    {
      at: expect.any(String),
      phase: 'ui',
      code: 'QUOTE_EXPIRED',
      message: 'This fee quote expired.',
    },
    {
      at: expect.any(String),
      phase: 'ui',
      code: 'DRAIN_ALREADY_COMMITTED',
      message: 'Cancel refused.',
    },
  ]);
});

test('a send the coordinator answers as cancelled is shown as a failure and logged', async () => {
  const review = drainReviewOf();
  const f = await draw({
    over: {
      send: jest.fn().mockResolvedValue({
        id: review.id,
        status: 'failed',
        amountSats: review.amountSats,
        feeSats: review.feeSats,
        drain: { ...review.drain!, phase: 'cancelled' },
        message: 'The wallet drain was cancelled.',
      }),
    },
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain('The wallet drain was cancelled.');
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(logged()).toEqual(['FAILED']);
});

test('a pending drain restored in Activity opens progress directly', async () => {
  const f = await draw({ snapshot: snapshotWith(underWay({ revision: 2 })) });
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
});

test('a delayed send response cannot replace newer durable progress', async () => {
  let finish!: (value: any) => void;
  const f = await draw({
    over: {
      send: jest.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      ),
    },
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  await f.update(snapshotWith({ ...f.progress, revision: 5 }));
  await act(async () =>
    finish({
      status: 'pending',
      drain: { ...f.progress, revision: 2, phase: 'preparing' },
    }),
  );
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(visibleText(f.tree)).not.toContain(w.keep);
});

test('terminal snapshot progress updates the tracked drain and later reorgs remain visible', async () => {
  const pending = underWay();
  const f = await draw({ snapshot: snapshotWith(pending) });
  await f.update(snapshotWith({ ...pending, revision: 5, phase: 'completed' }));
  expect(visibleText(f.tree)).toContain(w.completed);
  await f.update(snapshotWith({ ...pending, revision: 6 }));
  expect(visibleText(f.tree)).toContain(w.pending);
  await f.update(snapshotWith({ ...pending, revision: 7, phase: 'cancelled' }));
  expect(visibleText(f.tree)).toContain(w.cancelled);
});

test('a change seen while it is shown is felt and said, never moved to', async () => {
  const success = jest.spyOn(haptics, 'success');
  const soft = jest.spyOn(haptics, 'soft');
  const pending = underWay();
  const f = await draw({ snapshot: snapshotWith(pending) });
  await settle();
  // What the page first shows is not news.
  expect(success).not.toHaveBeenCalled();
  expect(said).not.toHaveBeenCalled();
  await f.update(
    snapshotWith({ ...pending, revision: 5, phase: 'cancelling' }),
  );
  expect(soft).toHaveBeenCalledTimes(1);
  expect(said).toHaveBeenLastCalledWith(w.cancelling);
  await f.update(snapshotWith({ ...pending, revision: 6, phase: 'completed' }));
  expect(success).toHaveBeenCalledTimes(1);
  expect(said).toHaveBeenLastCalledWith(w.completed);
  await settle();
  expect(focused()).toEqual([]);
});

test('the notes take the tone of each phase', () => {
  expect(
    (
      [
        'review',
        'preparing',
        'closing',
        'sweeping',
        'pending',
        'cancelling',
        'cancelled',
        'completed',
      ] as const
    ).map(phase => [phase, progressNote(phase)]),
  ).toEqual([
    ['review', { tone: 'warning', message: w.uncertain }],
    ['preparing', { tone: 'pending', message: w.pending }],
    ['closing', { tone: 'pending', message: w.pending }],
    ['sweeping', { tone: 'pending', message: w.pending }],
    ['pending', { tone: 'pending', message: w.pending }],
    ['cancelling', { tone: 'pending', message: w.cancelling }],
    ['cancelled', { tone: 'info', message: w.cancelled }],
    ['completed', { tone: 'success', message: w.completed }],
  ]);
  // Cancelling never says the wallet is emptying.
  expect(w.cancelling).not.toMatch(/emptying/i);
});

test('the warning is felt as it opens, and is where a screen reader lands', async () => {
  const warning = jest.spyOn(haptics, 'warning');
  const f = await draw();
  expect(warning).not.toHaveBeenCalled();
  await press(f.tree, w.link);
  expect(warning).toHaveBeenCalledTimes(1);
  await settle();
  expect(focused()).toEqual([w.warning]);
});

test('a review lands on what arrives, and the hold’s own result on its note', async () => {
  const f = await draw();
  await enter(f.tree);
  await settle();
  expect(focused().at(-1)).toBe(w.arrives);
  await activate(f.tree, w.send);
  await settle();
  expect(focused().at(-1)).toBe(w.pending);
  // Later news is said, never moved to, even news that says the same
  // again, as a reorg's return to pending does.
  const moves = focused().length;
  await f.update(
    snapshotWith({ ...f.progress, revision: 5, phase: 'completed' }),
  );
  await f.update(snapshotWith({ ...f.progress, revision: 6 }));
  await settle();
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(said).toHaveBeenLastCalledWith(w.pending);
  expect(focused()).toHaveLength(moves);
});

test('the drain under way is read every 5s while the app is in front, and the wallet only when it moved', async () => {
  jest.useFakeTimers();
  const pending = underWay();
  const getDrain = jest.fn().mockResolvedValue(pending);
  const f = await draw({
    over: { getDrain },
    snapshot: snapshotWith(pending),
  });
  const tick = () =>
    act(async () => {
      jest.advanceTimersByTime(DRAIN_POLL_MS);
    });
  await tick();
  expect(getDrain).toHaveBeenCalledTimes(1);
  // The same revision the history showed: nothing new for the wallet.
  expect(f.onRead).not.toHaveBeenCalled();
  getDrain.mockResolvedValue({ ...pending, revision: 5 });
  await tick();
  expect(f.onRead).toHaveBeenCalledTimes(1);
  await tick();
  expect(f.onRead).toHaveBeenCalledTimes(1);
  // Nobody reads it in the background.
  const state = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  try {
    await tick();
    expect(getDrain).toHaveBeenCalledTimes(3);
  } finally {
    Object.defineProperty(AppState, 'currentState', state);
  }
  await tick();
  expect(getDrain).toHaveBeenCalledTimes(4);
});

test('a new active drain is adopted without comparing revisions across identities', async () => {
  const pending = underWay({ revision: 5 });
  const f = await draw({ snapshot: snapshotWith(pending) });
  const next = {
    ...pending,
    requestId: 'another-drain',
    address: 'another-address',
    revision: 1,
  };
  await f.update(snapshotWith(next));
  expect(f.tree.root.findByType(CopyLine).props.value).toBe(next.address);
});

test('a delayed snapshot cannot resurrect a previously cancelled drain', async () => {
  const old = underWay({ revision: 2, phase: 'preparing' });
  const f = await draw({ snapshot: snapshotWith(old) });
  await f.update(snapshotWith({ ...old, revision: 4, phase: 'cancelled' }));
  const next = {
    ...old,
    requestId: 'new-drain',
    address: 'new-address',
    revision: 1,
    createdAt: old.createdAt + 1,
  };
  await f.update(snapshotWith(next));
  await f.update(snapshotWith(old));
  expect(f.tree.root.findByType(CopyLine).props.value).toBe(next.address);
});

test('opened by a row of its own, it starts open, and Keep my channel closes the row', async () => {
  const warning = jest.spyOn(haptics, 'warning');
  const onClose = jest.fn();
  const f = await draw({ onClose });
  expect(find(f.tree, w.link)).toBeUndefined();
  expect(visibleText(f.tree)).toContain(w.warning);
  expect(warning).toHaveBeenCalledTimes(1);
  await press(f.tree, w.keep);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(f.client.cancelDrain).not.toHaveBeenCalled();
  // From a review, the review is cancelled before the row closes.
  const g = await draw({ onClose });
  await act(async () => {
    field(g.tree, w.address).props.onChangeText(ADDRESS);
  });
  await press(g.tree, w.review);
  await press(g.tree, w.keep);
  expect(g.client.cancelDrain).toHaveBeenCalledWith(g.review.id);
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(find(g.tree, w.link)).toBeUndefined();
});

test('drain Activity detail shows both transaction references and the address once', async () => {
  const drain = underWay({
    revision: 2,
    txids: ['ab'.repeat(32), 'cd'.repeat(32)],
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <DetailScreen
        item={{
          id: `drain:${drain.requestId}`,
          kind: 'sent',
          title: 'Emptying wallet',
          description: '',
          amountSats: drain.amountSats,
          feeSats: drain.feeSats,
          status: 'pending',
          timestamp: Date.now(),
          reference: drain.requestId,
          txid: drain.txids[0],
          drain,
        }}
      />,
    );
  });
  trees.push(tree);
  const values = tree.root
    .findAllByType(CopyChip)
    .map(chip => chip.props.value);
  for (const value of [...drain.txids, ADDRESS])
    expect(values.filter(item => item === value)).toHaveLength(1);
});
