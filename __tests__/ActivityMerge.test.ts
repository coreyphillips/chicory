import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { mergeActivity, mergeSnapshot } from '../src/services/activityMerge';
import { activityOf, receiptOf } from '../test-support/fixtures';

/**
 * A wallet never shows less than it already knew. The engine can answer a
 * read with fewer rows than the last one, or with a settled payment shown as
 * a request again; the merge puts back what the read lost and takes every
 * real change as it is.
 */

const ids = (rows: readonly Activity[]) => rows.map(row => row.id);
const completed = (rows: readonly Activity[]) =>
  rows.filter(row => row.status === 'completed');

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
