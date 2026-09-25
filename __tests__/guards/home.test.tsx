import React from 'react';
import { AppState } from 'react-native';
import { act } from 'react-test-renderer';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../src/design/copy';
import { haptics } from '../../src/design/haptics';
import {
  LAUNCH_DROP,
  PULL_TRIGGER,
  heroPose,
  launchPose,
  pullOffset,
  pullProgress,
  vesselOpacity,
} from '../../src/scenes/home/motion';
import {
  backdropVisual,
  healthText,
  markVisual,
  setupOf,
} from '../../src/scenes/home/visual';
import type { HealthInput } from '../../src/scenes/home/visual';
import { HERO_MINI, STATUS_ROW } from '../../src/stage/layout';
import { arrivals, seenIn, useIncoming } from '../../src/stage/useIncoming';
import {
  NOW,
  activityOf,
  requestOf,
  snapshotOf,
} from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Home under the copy guard (REDESIGN.md rule 1) and the accessibility check
 * (section 9): the status row, the balance, the vessel and the actions, in
 * each wallet health state. The home track adds each state it redraws, drawn
 * from test-support/fixtures.ts with `guardData` as its data.
 *
 * Below the guard are the tables Home draws from, as plain functions, and
 * the detector that tells money arriving from an ordinary poll.
 */
const GUARDED: GuardedState[] = [];

guard('home', GUARDED);

const MAINNET = { network: 'mainnet' as const };

afterEach(() => jest.restoreAllMocks());

describe('the mark', () => {
  const input = (over: Partial<HealthInput> = {}): HealthInput => ({
    snapshot: snapshotOf({ wallet: MAINNET }),
    stale: false,
    refreshing: false,
    connecting: false,
    error: '',
    backupPending: false,
    ...over,
  });

  test('a ready wallet is a full, still, live bloom with a live dot', () => {
    expect(markVisual(input())).toEqual({
      mode: 'still',
      open: 1,
      tone: 'live',
      halo: false,
      droop: false,
      flask: false,
      pulse: 'live',
    });
  });

  test.each<
    [string, Partial<HealthInput>, Partial<ReturnType<typeof markVisual>>]
  >([
    ['a refresh ratchets it', { refreshing: true }, { mode: 'ratchet' }],
    ['a cached launch ratchets it', { connecting: true }, { mode: 'ratchet' }],
    [
      'setup under way opens it to .6, breathing',
      {
        snapshot: snapshotOf({
          wallet: MAINNET,
          primary: { setup: 'pending' },
        }),
      },
      { mode: 'breathe', open: 0.6 },
    ],
    [
      'setup that failed droops it',
      {
        snapshot: snapshotOf({ wallet: MAINNET, primary: { setup: 'failed' } }),
      },
      { droop: true, open: 0.8 },
    ],
    ['an old balance makes it dormant', { stale: true }, { tone: 'dormant' }],
    [
      'a test network makes it slate, with a flask',
      { snapshot: snapshotOf() },
      { tone: 'test', flask: true },
    ],
    ['a backup to save haloes it', { backupPending: true }, { halo: true }],
    [
      'a failed refresh hollows the dot',
      { error: 'offline' },
      { pulse: 'failed' },
    ],
    [
      'a lost connection pulses the dot',
      {
        snapshot: snapshotOf({
          wallet: MAINNET,
          primary: { connected: false },
        }),
      },
      { pulse: 'reconnecting' },
    ],
  ])('%s', (_name, over, look) => {
    expect(markVisual(input(over))).toMatchObject(look);
  });

  test('a wallet without lightning-first funding has no setup to wait for', () => {
    expect(
      setupOf(
        snapshotOf({ lfbw: { enabled: false }, primary: { setup: 'pending' } }),
      ),
    ).toBe('ready');
    expect(
      setupOf(snapshotOf({ primary: { setup: 'pending', setupError: 'x' } })),
    ).toBe('failed');
  });

  test('says the connection, the network off mainnet and a backup to save', () => {
    expect(healthText(input())).toBe(copy.health.fresh);
    const text = healthText(
      input({ snapshot: snapshotOf(), backupPending: true }),
    );
    expect(text).toContain(copy.health.fresh);
    expect(text).toContain(copy.health.testNetwork('regtest'));
    expect(text).toContain('Save your recovery phrase.');
  });

  test('a failed refresh says what the notice said, with the reason', () => {
    expect(healthText(input({ error: 'Electrum is offline.' }))).toContain(
      'Could not refresh. Showing the last known state. Electrum is offline.',
    );
  });

  test('says how old the balance is, and why setup stopped', () => {
    expect(healthText(input({ stale: true }))).toContain(copy.health.stale);
    expect(healthText(input({ stale: true, connecting: true }))).toContain(
      copy.health.cached,
    );
    const failed = snapshotOf({
      wallet: MAINNET,
      primary: { setup: 'failed', setupError: 'Provider unavailable.' },
    });
    expect(healthText(input({ snapshot: failed }))).toContain(
      `${copy.health.setupFailed} Provider unavailable.`,
    );
  });
});

describe('the backdrop', () => {
  const look = (
    snapshot: WalletSnapshot,
    over: { stale?: boolean; backupPending?: boolean } = {},
  ) =>
    backdropVisual({
      snapshot,
      stale: false,
      backupPending: false,
      ...over,
    });

  test('a calm mainnet wallet has the bloom glow and no tint', () => {
    expect(look(snapshotOf({ wallet: MAINNET }))).toEqual({
      glow: 'bloom',
      dim: false,
      tint: null,
    });
  });

  test('honey for a backup or an unknown outcome, night for an open offline request', () => {
    expect(look(snapshotOf(), { backupPending: true }).tint).toBe('honey');
    expect(
      look(snapshotOf({ activity: [activityOf('sent', 'uncertain')] })).tint,
    ).toBe('honey');
    const offline = (expiresAt: number) =>
      snapshotOf({
        activity: [
          activityOf('request', 'pending', {
            receiveRequest: requestOf({ offlineReceive: true, expiresAt }),
          }),
        ],
      });
    expect(look(offline(NOW + 60_000)).tint).toBe('night');
    expect(look(offline(NOW - 1)).tint).toBeNull();
  });

  test('an old balance dims the glow, and a test network turns it slate', () => {
    expect(look(snapshotOf({ wallet: MAINNET }), { stale: true }).dim).toBe(
      true,
    );
    expect(look(snapshotOf()).glow).toBe('slate');
  });
});

describe('the motion', () => {
  test('the pull follows the finger at half, then gives less and less', () => {
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(40)).toBe(20);
    expect(pullOffset(PULL_TRIGGER)).toBe(PULL_TRIGGER / 2);
    expect(pullOffset(PULL_TRIGGER + 400)).toBeLessThan(PULL_TRIGGER / 2 + 28);
    expect(pullOffset(PULL_TRIGGER + 40)).toBeGreaterThan(
      pullOffset(PULL_TRIGGER),
    );
    expect(pullProgress(PULL_TRIGGER / 2)).toBe(0.5);
    expect(pullProgress(PULL_TRIGGER * 2)).toBe(1);
  });

  test('the hero shrinks into the middle of the status row', () => {
    const frame = { y: 40, height: 80 };
    expect(heroPose(1, frame)).toEqual({ scale: 1, translateY: 0 });
    const mini = heroPose(0, frame);
    expect(mini.scale).toBeCloseTo(HERO_MINI);
    // Scaled from its top edge, the strip's centre lands on the row's.
    const centre = frame.y + mini.translateY + (mini.scale * frame.height) / 2;
    expect(centre).toBeCloseTo(-STATUS_ROW / 2);
  });

  test('the vessel is gone before the hero has shrunk far', () => {
    expect(vesselOpacity(1)).toBe(1);
    expect(vesselOpacity(0.85)).toBeCloseTo(0.5);
    expect(vesselOpacity(0.7)).toBe(0);
    expect(vesselOpacity(0)).toBe(0);
  });

  test('the tapped circle grows toward the 88pt control, and the rest shrink', () => {
    const rest = { scale: 1, translateX: 0, translateY: 0 };
    expect(launchPose(1, true, 'none', 120)).toEqual(rest);
    expect(launchPose(0, true, 'send', 120)).toEqual(rest);
    const tapped = launchPose(1, true, 'send', 120);
    expect(tapped.scale * 56).toBeCloseTo(88);
    expect(tapped.translateX).toBe(120);
    expect(tapped.translateY).toBe(LAUNCH_DROP);
    expect(launchPose(0.5, true, 'send', 120).translateX).toBe(60);
    expect(launchPose(0.5, false, 'send').scale).toBeCloseTo(0.8);
  });
});

describe('money arriving', () => {
  const received = (
    status: Activity['status'],
    over: Partial<Activity> & { seed?: number } = {},
  ) => activityOf('received', status, { seed: 1, ...over });

  test('counts a received payment that completes, and a new one that arrives complete', () => {
    const before = seenIn([received('pending')]);
    expect(arrivals(before, [received('completed')])).toHaveLength(1);
    expect(arrivals(seenIn([]), [received('completed')])).toHaveLength(1);
    // A request paid becomes a received payment under the same id.
    const request = activityOf('request', 'pending', { seed: 2 });
    expect(
      arrivals(seenIn([request]), [
        { ...request, kind: 'received', status: 'completed' },
      ]),
    ).toHaveLength(1);
  });

  test('counts nothing already there, sent, or still on its way', () => {
    const done = received('completed');
    expect(arrivals(seenIn([done]), [done])).toEqual([]);
    expect(
      arrivals(seenIn([]), [activityOf('sent', 'completed', { seed: 3 })]),
    ).toEqual([]);
    expect(arrivals(seenIn([]), [received('pending')])).toEqual([]);
  });

  /** Reports what `useIncoming` counts for the snapshot it is given. */
  function Watch({
    snapshot,
    seen,
  }: {
    snapshot: WalletSnapshot;
    seen: number[];
  }) {
    seen.push(useIncoming(snapshot));
    return null;
  }

  test('is felt once, and never on the first read or an ordinary poll', async () => {
    const felt = jest.spyOn(haptics, 'incoming');
    const seen: number[] = [];
    const first = snapshotOf({
      activity: [received('completed', { seed: 7 })],
    });
    const tree = await mount(
      <>
        <Watch snapshot={first} seen={seen} />
        <Watch snapshot={first} seen={[]} />
      </>,
    );
    const next = (snapshot: WalletSnapshot) =>
      act(async () =>
        tree.update(
          <>
            <Watch snapshot={snapshot} seen={seen} />
            <Watch snapshot={snapshot} seen={[]} />
          </>,
        ),
      );
    // An ordinary poll: a new read of the same history.
    await next({ ...first, updatedAt: NOW + 12_000 });
    expect(felt).not.toHaveBeenCalled();
    const pending = received('pending', { seed: 8 });
    await next(snapshotOf({ activity: [pending, ...first.activity] }));
    expect(felt).not.toHaveBeenCalled();
    await next(
      snapshotOf({
        activity: [{ ...pending, status: 'completed' }, ...first.activity],
      }),
    );
    // Two watchers saw it, and it was felt once.
    expect(felt).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toBe(1);
    await act(async () => tree.unmount());
  });

  test('is not felt for what completed while the app was away', async () => {
    const felt = jest.spyOn(haptics, 'incoming');
    const listeners: ((state: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_, listener) => {
        listeners.push(listener as (state: string) => void);
        return { remove: jest.fn() } as never;
      });
    const pending = received('pending', { seed: 9 });
    const seen: number[] = [];
    const tree = await mount(
      <Watch snapshot={snapshotOf({ activity: [pending] })} seen={seen} />,
    );
    await act(async () =>
      listeners.forEach(listener => listener('background')),
    );
    await act(async () =>
      tree.update(
        <Watch
          snapshot={snapshotOf({
            activity: [{ ...pending, status: 'completed' }],
          })}
          seen={seen}
        />,
      ),
    );
    expect(felt).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(0);
    await act(async () => tree.unmount());
  });
});
