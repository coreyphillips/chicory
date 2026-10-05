import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import {
  mergeActivity,
  mergeSnapshot,
  settledLightning,
} from '../src/services/activityMerge';
import { activityOf, receiptOf } from '../test-support/fixtures';
import { drainReviewOf } from '../native-tests/gallery/fakes';

/**
 * A wallet never shows less than it already knew. The engine can answer a
 * read with fewer rows than the last one, or with a settled payment shown as
 * a request again; the merge puts back what the read lost and takes every
 * real change as it is.
 */

const ids = (rows: readonly Activity[]) => rows.map(row => row.id);
const completed = (rows: readonly Activity[]) =>
  rows.filter(row => row.status === 'completed');

test('the combined drain replaces both cached component sends', () => {
  const close = activityOf('sent', 'completed', { seed: 40, rail: 'chain' });
  const sweepLeg = activityOf('sent', 'completed', { seed: 41, rail: 'chain' });
  const drain: Activity = {
    ...close,
    id: 'drain:combined',
    drain: {
      ...drainReviewOf().drain!,
      requestId: 'combined',
      revision: 5,
      phase: 'completed',
      txids: [close.txid!, sweepLeg.txid!],
    },
  };
  expect(mergeActivity([close, sweepLeg], [drain])).toEqual([drain]);
  expect(mergeActivity([drain], [close, sweepLeg])).toEqual([drain]);
  for (const status of ['pending', 'uncertain'] as const) {
    const ongoing: Activity = {
      ...drain,
      status,
      drain: { ...drain.drain!, phase: 'pending', revision: 6 },
    };
    expect(mergeActivity([ongoing], [])).toEqual([ongoing]);
    expect(mergeActivity([ongoing], [close, sweepLeg])).toEqual([ongoing]);
  }
});

test('drain progress follows revisions, including a verified reorg', () => {
  const done: Activity = {
    ...activityOf('sent', 'completed', { seed: 42 }),
    drain: {
      ...drainReviewOf().drain!,
      revision: 5,
      phase: 'completed',
    },
  };
  const stale: Activity = {
    ...done,
    status: 'pending',
    drain: { ...done.drain!, revision: 2, phase: 'preparing' },
  };
  expect(mergeActivity([done], [stale])).toEqual([done]);
  const reorg: Activity = {
    ...stale,
    drain: { ...stale.drain!, revision: 6, phase: 'pending' },
  };
  expect(mergeActivity([done], [reorg])).toEqual([reorg]);
});

/**
 * The regtest run from the issue: receives of 50,000, 50,000 and 25,000 over
 * saved requests, sends of 90,001 and 24,371, and a 10,298 sweep from a
 * force close that landed on the 25,000 request's address.
 */
const receive1 = activityOf('received', 'completed', {
  seed: 1,
  amountSats: 50_000,
});
const receive2 = activityOf('received', 'completed', {
  seed: 2,
  amountSats: 50_000,
});
const receive3 = activityOf('received', 'completed', {
  seed: 3,
  amountSats: 25_000,
});
const send1 = activityOf('sent', 'completed', { seed: 4, amountSats: 90_001 });
const send2 = activityOf('sent', 'completed', { seed: 5, amountSats: 24_371 });
const sweep = activityOf('received', 'completed', {
  seed: 6,
  rail: 'chain',
  amountSats: 10_298,
});
const full = [receive1, receive2, receive3, send1, send2, sweep];

/** The row the engine builds for a saved request it no longer sees paid. */
const expiredRequest = (row: Activity): Activity => ({
  ...row,
  kind: 'request',
  title: 'Payment request',
  status: 'expired',
  receiveStatus: receiptOf('waiting'),
});

/** The 25,000 request shown as a partial on-chain receive of the sweep. */
const partial: Activity = {
  ...receive3,
  title: 'Partial payment received',
  amountSats: 10_298,
  status: 'pending',
  txid: sweep.txid,
  receiveStatus: receiptOf('partial', { txid: sweep.txid }),
};

describe('reads replayed from the run', () => {
  test('every completed row is kept through every short read, and the read wins once it is full again', () => {
    let known = mergeActivity([], full);
    expect(ids(known)).toEqual(ids(full));
    // 16:50:24: both sends are gone.
    known = mergeActivity(known, [receive1, receive2, receive3, sweep]);
    expect(completed(known)).toHaveLength(6);
    expect(ids(known).sort()).toEqual(ids(full).sort());
    // 16:55:12: one receive reads as an expired request, the 25,000 receive
    // as a pending partial of the sweep, and the sweep's own row is gone.
    known = mergeActivity(known, [expiredRequest(receive1), receive2, partial]);
    expect(completed(known)).toHaveLength(6);
    expect(known.find(row => row.id === receive3.id)).toEqual(receive3);
    expect(known.find(row => row.id === sweep.id)).toEqual(sweep);
    // 16:55:24: none completed.
    known = mergeActivity(known, [
      expiredRequest(receive1),
      expiredRequest(receive2),
      partial,
    ]);
    expect(completed(known)).toHaveLength(6);
    expect(ids(known).sort()).toEqual(ids(full).sort());
    // The engine restarts and answers in full: the read's own rows.
    const restarted = full.map(row => ({ ...row, feeSats: row.feeSats + 1 }));
    known = mergeActivity(known, restarted);
    expect(known).toEqual(restarted);
    // Then short again, and still whole.
    known = mergeActivity(known, [receive1, receive2, receive3, sweep]);
    expect(completed(known)).toHaveLength(6);
  });

  test('the merged list is newest first, as the engine orders its own', () => {
    const merged = mergeActivity(full, [receive2, sweep]);
    const times = merged.map(row => row.timestamp);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test('nothing known means the read as it is', () => {
    expect(mergeActivity([], [send1])).toEqual([send1]);
  });
});

describe('real changes a read brings', () => {
  test('a pending send that completes, or fails, shows as the read has it', () => {
    const pending = activityOf('sent', 'pending', { seed: 10 });
    const done = { ...pending, status: 'completed' as const };
    const failed = { ...pending, status: 'failed' as const };
    expect(mergeActivity([pending], [done])).toEqual([done]);
    expect(mergeActivity([pending], [failed])).toEqual([failed]);
  });

  test('an unpaid request that expires, and a request that gets paid, show as the read has them', () => {
    const open = activityOf('request', 'pending', { seed: 11 });
    const expired = { ...open, status: 'expired' as const };
    const paid = {
      ...open,
      kind: 'received' as const,
      status: 'completed' as const,
    };
    expect(mergeActivity([open], [expired])).toEqual([expired]);
    expect(mergeActivity([open], [paid])).toEqual([paid]);
  });

  test('a new row shows', () => {
    const arrived = activityOf('received', 'completed', { seed: 12 });
    expect(mergeActivity([send1], [arrived, send1])).toEqual([arrived, send1]);
  });

  test('only a settled Lightning payment is kept over a lesser read of its id', () => {
    const chain = activityOf('received', 'completed', {
      seed: 13,
      rail: 'chain',
    });
    const unconfirmed = { ...chain, status: 'pending' as const };
    expect(mergeActivity([chain], [unconfirmed])).toEqual([unconfirmed]);
    const lightning = activityOf('received', 'completed', { seed: 14 });
    const lost = { ...lightning, status: 'pending' as const };
    expect(mergeActivity([lightning], [lost])).toEqual([lightning]);
  });

  test('a kept row gives way to the read as soon as a read includes it', () => {
    const kept = mergeActivity(full, [receive1]);
    const again = { ...send1, feeSats: 99 };
    const merged = mergeActivity(kept, [receive1, again]);
    expect(merged.find(row => row.id === send1.id)).toEqual(again);
  });
});

describe('an on-chain receive the engine moves onto its request', () => {
  test('shows once', () => {
    const request = activityOf('request', 'pending', { seed: 20 });
    const own = activityOf('received', 'completed', {
      seed: 21,
      rail: 'chain',
    });
    const onRequest: Activity = {
      ...request,
      kind: 'received',
      status: 'completed',
      txid: own.txid,
      receiveStatus: receiptOf('completed', { txid: own.txid }),
    };
    const merged = mergeActivity([own, request], [onRequest]);
    expect(merged).toEqual([onRequest]);
    expect(merged.filter(row => row.txid === own.txid)).toHaveLength(1);
  });
});

describe('a snapshot merged into what the app knew', () => {
  const snapshotOf = (
    activity: Activity[],
    over: Partial<WalletSnapshot> = {},
  ): WalletSnapshot => ({
    wallet: {
      id: 'w1',
      name: 'Everyday',
      network: 'regtest',
      status: 'running',
    },
    balance: {
      totalSats: 1000,
      availableSats: 800,
      pendingSats: 200,
      receivableSats: 5000,
    },
    activity,
    primary: { uri: 'node', connected: true, setup: 'ready' },
    notes: [],
    updatedAt: 1,
    demo: false,
    ...over,
  });

  test('takes the balance, the primary, the notes and the time from the read', () => {
    const known = snapshotOf(full);
    const read = snapshotOf([receive1], {
      balance: {
        totalSats: 20_926,
        availableSats: 20_926,
        pendingSats: 0,
        receivableSats: 0,
      },
      primary: { uri: 'node', connected: false, setup: 'ready' },
      notes: ['Some receive requests are still being checked.'],
      updatedAt: 2,
    });
    const merged = mergeSnapshot(known, read);
    expect(merged.balance).toEqual(read.balance);
    expect(merged.primary).toEqual(read.primary);
    expect(merged.notes).toEqual(read.notes);
    expect(merged.updatedAt).toBe(2);
    expect(completed(merged.activity)).toHaveLength(6);
  });

  test('is the read itself when nothing was known', () => {
    const read = snapshotOf([receive1]);
    expect(mergeSnapshot(null, read)).toBe(read);
  });
});

/**
 * The merge as it was before it looked rows up instead of searching for
 * them, word for word, so the faster one is held to the same answer: the
 * same rows, the very same objects, in the same order.
 */
function mergeActivityBefore(
  known: readonly Activity[],
  read: readonly Activity[],
): Activity[] {
  const byId = new Map(read.map(row => [row.id, row]));
  const before = new Map(known.map(row => [row.id, row]));
  const out: Activity[] = read.map(row => {
    const was = before.get(row.id);
    if (was?.drain && row.drain)
      return was.drain.revision > row.drain.revision ? was : row;
    return was && settledLightning(was) && row.status !== 'completed'
      ? was
      : row;
  });
  const kept = known.filter(
    row => (row.status === 'completed' || row.drain) && !byId.has(row.id),
  );
  const merged = [...out, ...kept];
  const drainTxids = new Set(merged.flatMap(row => row.drain?.txids ?? []));
  const shown = merged.filter(
    row =>
      (row.drain || !row.txid || !drainTxids.has(row.txid)) &&
      (row.drain ||
        !kept.includes(row) ||
        !row.txid ||
        !merged.some(other => other !== row && other.txid === row.txid)),
  );
  return kept.length ? shown.sort((a, b) => b.timestamp - a.timestamp) : shown;
}

describe('the merge against the one before it', () => {
  /** Park and Miller's generator, seeded, so a failing run can be run again. */
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  };
  const STATUSES = [
    'completed',
    'pending',
    'uncertain',
    'failed',
    'expired',
  ] as const;
  const KINDS = ['sent', 'received', 'request', 'transfer'] as const;
  // Few ids, transactions and times, so reads and histories collide often:
  // the same id read again, two rows on one transaction, equal times.
  const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
  const TXIDS = ['t1', 't2', 't3'];

  function rowsFrom(random: () => number) {
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(random() * list.length)];
    const row = (): Activity => ({
      id: pick(IDS),
      kind: pick(KINDS),
      title: 'Payment',
      description: '',
      amountSats: 1,
      feeSats: 0,
      status: pick(STATUSES),
      timestamp: Math.floor(random() * 4),
      reference: '',
      ...(random() < 0.6 ? { txid: pick(TXIDS) } : {}),
      ...(random() < 0.4 ? { paymentHash: 'hash' } : {}),
      ...(random() < 0.2
        ? {
            drain: {
              ...drainReviewOf().drain!,
              revision: Math.floor(random() * 3),
              txids: TXIDS.filter(() => random() < 0.3),
            },
          }
        : {}),
    });
    // A history and a read drawn from one pool of rows, so the same object
    // can be in both, or twice in either, beside rows made fresh.
    const pool = Array.from({ length: 1 + Math.floor(random() * 8) }, row);
    const some = (most: number) =>
      Array.from({ length: Math.floor(random() * (most + 1)) }, () =>
        random() < 0.75 ? pick(pool) : row(),
      );
    return { known: some(10), read: some(6) };
  }

  test('gives the same rows, as the same objects, in the same order, on random histories', () => {
    const random = seeded(20261005);
    const differs: number[] = [];
    let twice = 0;
    let shared = 0;
    for (let run = 0; run < 3000; run++) {
      const { known, read } = rowsFrom(random);
      const expected = mergeActivityBefore(known, read);
      const actual = mergeActivity(known, read);
      if (
        actual.length !== expected.length ||
        actual.some((row, index) => row !== expected[index])
      )
        differs.push(run);
      // That the runs reach the cases the lookups answer: a row put back
      // twice, and a row put back that another row shares a transaction
      // with.
      const readIds = new Set(read.map(row => row.id));
      const putBack = known.filter(
        row =>
          (row.status === 'completed' || row.drain) && !readIds.has(row.id),
      );
      if (new Set(putBack).size < putBack.length) twice += 1;
      if (
        putBack.some(
          row =>
            row.txid &&
            [...read, ...putBack].some(
              other => other !== row && other.txid === row.txid,
            ),
        )
      )
        shared += 1;
    }
    expect(differs).toEqual([]);
    expect(twice).toBeGreaterThan(100);
    expect(shared).toBeGreaterThan(100);
  });

  test('the same row listed twice is still one row to the transaction check, as before', () => {
    const chain = activityOf('received', 'completed', {
      seed: 30,
      rail: 'chain',
    });
    expect(mergeActivity([chain, chain], [])).toEqual(
      mergeActivityBefore([chain, chain], []),
    );
    expect(mergeActivity([chain, chain], [])).toEqual([chain, chain]);
    // Two rows on one transaction are two rows, and neither is put back.
    const other = { ...chain, id: 'other' };
    expect(mergeActivity([chain, other], [])).toEqual([]);
    expect(mergeActivityBefore([chain, other], [])).toEqual([]);
  });
});
