import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type { DrainProgress, WalletSnapshot } from '@beignet/wallet-core';
import { Scanner } from '../../../components/Scanner';
import { copy } from '../../../design/copy';
import { CopyChip } from '../../../glyphs/CopyChip';
import { DetailScreen } from '../../../screens/wallet/Detail';
import { SettingsScreen } from '../../../screens/Settings';
import type { WalletAdapter } from '../../../services/wallet';
import {
  ADDRESS,
  clientOf,
  drainReviewOf,
  onMainnet,
} from '../../../../native-tests/gallery/fakes';
import {
  activate,
  field,
  press,
  visibleText,
} from '../../../../test-support/query';
import { copyViolations } from '../../../../test-support/copyGuard';
import { EmptyWallet } from '../EmptyWallet';
import { Line, SettingsSurface } from '../ui';

const w = copy.settings.empty;
const trees: ReactTestRenderer[] = [];
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
            : 'pending',
        timestamp: Date.now(),
        reference: drain.requestId,
        drain,
      },
    ],
  });
async function draw(over: Partial<WalletAdapter> = {}, snapshot = onMainnet()) {
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
  const onRefresh = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SettingsSurface>
        <EmptyWallet
          client={client}
          snapshot={snapshot}
          onRefresh={onRefresh}
        />
      </SettingsSurface>,
    );
  });
  trees.push(tree);
  const update = async (next: WalletSnapshot) => {
    await act(async () =>
      tree.update(
        <SettingsSurface>
          <EmptyWallet client={client} snapshot={next} onRefresh={onRefresh} />
        </SettingsSurface>,
      ),
    );
  };
  return { tree, client, review, progress, onRefresh, update };
}
async function enter(tree: ReactTestRenderer, address = ADDRESS) {
  await press(tree, w.link);
  await act(async () => {
    field(tree, w.address).props.onChangeText(address);
  });
  await press(tree, w.review);
}
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
});

test('Settings exposes draining only when the engine supports it, below Change primary', async () => {
  for (const supported of [false, true]) {
    const client = clientOf({
      getConfig: jest.fn().mockResolvedValue({ drainAvailable: supported }),
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <SettingsScreen
          snapshot={onMainnet()}
          client={client}
          switchError=""
          onDisconnect={jest.fn()}
          onChooseWallet={jest.fn()}
          onRefresh={jest.fn()}
          onNetwork={jest.fn()}
        />,
      );
    });
    trees.push(tree);
    const labels = tree.root
      .findAll(
        node => typeof node.type === 'string' && node.props.accessibilityLabel,
      )
      .map(node => node.props.accessibilityLabel);
    expect(labels.includes(w.link)).toBe(supported);
    if (supported)
      expect(labels.indexOf(w.link)).toBeGreaterThan(
        labels.indexOf(copy.settings.primary.change),
      );
  }
});

test('drain review shows the total arrival, both network fees and a pin-led address', async () => {
  const f = await draw();
  await enter(f.tree);
  expect(f.client.prepareDrain).toHaveBeenCalledWith({ address: ADDRESS });
  expect(f.client.send).not.toHaveBeenCalled();
  expect(f.tree.root.findAllByType(Line).map(line => line.props)).toEqual([
    { label: w.arrives, value: '261,000 sats' },
    { label: w.fees, value: '500 sats' },
  ]);
  expect(f.tree.root.findByType(CopyChip).props).toMatchObject({
    value: ADDRESS,
    glyph: 'pin',
  });
  expect(copyViolations(f.tree, { data: [ADDRESS] })).toEqual([]);
});

test('drain refuses amount-bearing links and wrong-network destinations before review', async () => {
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
});

test('drain scan uses the same address-only validation and fills the field', async () => {
  const f = await draw();
  await press(f.tree, w.link);
  await press(f.tree, w.scan);
  const scan = f.tree.root.findByType(Scanner);
  expect(() => scan.props.validate(`bitcoin:${ADDRESS}?amount=0.1`)).toThrow(
    w.noAmount,
  );
  expect(scan.props.validate(`bitcoin:${ADDRESS}`)).toBe(ADDRESS);
  await act(async () => {
    scan.props.onDetected(ADDRESS);
  });
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
});

test('drain paste fills the address without submitting', async () => {
  jest.mocked(Clipboard.getString).mockResolvedValueOnce(`bitcoin:${ADDRESS}`);
  const f = await draw();
  await press(f.tree, w.link);
  await press(f.tree, w.paste);
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.send).not.toHaveBeenCalled();
});

test('Keep my channel cancels the review without sending', async () => {
  const f = await draw();
  await enter(f.tree);
  await press(f.tree, w.keep);
  expect(f.client.cancelDrain).toHaveBeenCalledWith(f.review.id);
  expect(f.client.send).not.toHaveBeenCalled();
  expect(visibleText(f.tree)).toContain(w.link);
});

test('the hold commits once and shows pending progress without another send control', async () => {
  const f = await draw();
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(f.client.send).toHaveBeenCalledTimes(1);
  expect(f.client.send).toHaveBeenCalledWith(f.review);
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(visibleText(f.tree)).not.toContain(w.send);
  expect(f.onRefresh).toHaveBeenCalled();
});

test('an unknown drain outcome stays uncertain and allows only authoritative cancellation', async () => {
  const review = drainReviewOf();
  const f = await draw({
    send: jest.fn().mockResolvedValue({
      id: review.id,
      status: 'uncertain',
      amountSats: review.amountSats,
      feeSats: review.feeSats,
      drain: review.drain,
      message: 'Unknown',
    }),
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain(w.uncertain);
  expect(visibleText(f.tree)).not.toContain(w.send);
  await press(f.tree, w.keep);
  expect(f.client.cancelDrain).toHaveBeenCalledTimes(1);
});

test('an expired review returns to address entry for a new review', async () => {
  const f = await draw({
    send: jest.fn().mockRejectedValue(new Error('The quote expired.')),
  });
  await enter(f.tree);
  await activate(f.tree, w.send);
  expect(visibleText(f.tree)).toContain('The quote expired.');
  expect(field(f.tree, w.address).props.value).toBe(ADDRESS);
  expect(f.client.send).toHaveBeenCalledTimes(1);
});

test('a pending drain restored in Activity opens progress directly', async () => {
  const drain = {
    ...drainReviewOf().drain!,
    revision: 2,
    phase: 'pending' as const,
  };
  const snapshot: WalletSnapshot = onMainnet({
    activity: [
      {
        id: `drain:${drain.requestId}`,
        kind: 'sent',
        title: 'Emptying wallet',
        description: '',
        amountSats: drain.amountSats,
        feeSats: drain.feeSats,
        status: 'pending',
        timestamp: Date.now(),
        reference: drain.requestId,
        drain,
      },
    ],
  });
  const f = await draw({}, snapshot);
  expect(visibleText(f.tree)).toContain(w.pending);
  expect(f.client.prepareDrain).not.toHaveBeenCalled();
});

test('a delayed send response cannot replace newer durable progress', async () => {
  let finish!: (value: any) => void;
  const f = await draw({
    send: jest.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    ),
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
  const pending = {
    ...drainReviewOf().drain!,
    revision: 4,
    phase: 'pending' as const,
  };
  const f = await draw({}, snapshotWith(pending));
  await f.update(snapshotWith({ ...pending, revision: 5, phase: 'completed' }));
  expect(visibleText(f.tree)).toContain(w.completed);
  await f.update(snapshotWith({ ...pending, revision: 6 }));
  expect(visibleText(f.tree)).toContain(w.pending);
  await f.update(snapshotWith({ ...pending, revision: 7, phase: 'cancelled' }));
  expect(visibleText(f.tree)).toContain(w.cancelled);
});

test('a new active drain is adopted without comparing revisions across identities', async () => {
  const pending = {
    ...drainReviewOf().drain!,
    revision: 5,
    phase: 'pending' as const,
  };
  const f = await draw({}, snapshotWith(pending));
  const next = {
    ...pending,
    requestId: 'another-drain',
    address: 'another-address',
    revision: 1,
  };
  await f.update(snapshotWith(next));
  expect(f.tree.root.findByType(CopyChip).props.value).toBe(next.address);
});

test('a delayed snapshot cannot resurrect a previously cancelled drain', async () => {
  const old = {
    ...drainReviewOf().drain!,
    revision: 2,
    phase: 'preparing' as const,
  };
  const f = await draw({}, snapshotWith(old));
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
  expect(f.tree.root.findByType(CopyChip).props.value).toBe(next.address);
});

test('drain Activity detail shows both transaction references and the address once', async () => {
  const drain = {
    ...drainReviewOf().drain!,
    revision: 2,
    phase: 'pending' as const,
    txids: ['ab'.repeat(32), 'cd'.repeat(32)],
  };
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
