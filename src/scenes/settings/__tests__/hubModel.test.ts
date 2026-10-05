import type { DrainProgress, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { durations, overlap } from '../../../motion/tokens';
import { activityOf, snapshotOf } from '../../../../test-support/fixtures';
import { drainReviewOf } from '../../../../native-tests/gallery/fakes';
import {
  GROUPS,
  HUB_CASCADE,
  HUB_LANDS,
  answering,
  cardBloom,
  cardStatus,
  cardWords,
  drainState,
  drainWords,
  edgeOf,
  hubItems,
  joinedAbove,
  joinedBelow,
  networkWords,
  nextOpen,
  primaryWords,
  rowsOf,
} from '../hubModel';
import type { HubEdge, HubRow, HubShape } from '../hubModel';

/**
 * Settings as a grouped hub (REDESIGN.md 6, Settings), held as data: which
 * items the page draws and in what order, where each row sits in its
 * group's card, when each arrives, which row is open, how the card's bloom
 * reads the wallet, and what the card and the rows say.
 */

const s = copy.settings;

/** Every page shape there can be. */
const SHAPES: HubShape[] = [false, true].flatMap(lead =>
  [false, true].flatMap(drain =>
    [false, true].map(erase => ({ lead, drain, erase })),
  ),
);

const named = (shape: HubShape) =>
  Object.entries(shape)
    .map(([key, on]) => `${key} ${on ? 'on' : 'off'}`)
    .join(', ');

describe('the page', () => {
  test.each(SHAPES.map(shape => [named(shape), shape] as const))(
    'draws the card, the groups in order and the versions, with %s',
    (_, shape) => {
      const items = hubItems(shape);
      expect(items[0]).toMatchObject({ key: 'card', kind: 'card', step: 0 });
      expect(items.at(-1)).toMatchObject({ key: 'about', kind: 'about' });
      const headers = items
        .filter(item => item.kind === 'header')
        .map(item => item.key);
      expect(headers).toEqual([
        'header:wallet',
        'header:phone',
        'header:funds',
        'header:help',
      ]);
      // Every key is its own, so each item moves as itself.
      const keys = items.map(item => item.key);
      expect(new Set(keys).size).toBe(keys.length);
      // The recovery phrase is drawn once, leading or in its row.
      expect(keys.filter(key => key === 'recovery')).toHaveLength(1);
      // Optional rows only when the page can offer them.
      expect(keys.includes('empty')).toBe(shape.drain);
      expect(keys.includes('erase')).toBe(shape.erase);
    },
  );

  test('the whole order, with everything drawn and the phrase saved', () => {
    expect(
      hubItems({ lead: false, drain: true, erase: true }).map(item => item.key),
    ).toEqual([
      'card',
      'header:wallet',
      'recovery',
      'primary',
      'network',
      'header:phone',
      'applock',
      'haptics',
      'header:funds',
      'empty',
      'leave',
      'erase',
      'header:help',
      'diagnostics',
      'about',
    ]);
  });

  test('the phrase to save leads, under the same key it keeps as a row', () => {
    const leading = hubItems({ lead: true, drain: false, erase: true });
    expect(leading.slice(0, 3).map(item => [item.key, item.kind])).toEqual([
      ['card', 'card'],
      ['recovery', 'lead'],
      ['header:wallet', 'header'],
    ]);
    expect(leading[1]).toMatchObject({
      row: 'recovery',
      group: 'wallet',
      edge: 'only',
    });
    const saved = hubItems({ lead: false, drain: false, erase: true });
    expect(saved.find(item => item.key === 'recovery')).toMatchObject({
      kind: 'row',
      row: 'recovery',
      group: 'wallet',
      edge: 'first',
    });
  });

  test("each row's group and place in its card", () => {
    const places = (shape: HubShape) =>
      Object.fromEntries(
        hubItems(shape)
          .filter(item => item.kind === 'row')
          .map(item => [item.key, `${item.group} ${item.edge}`]),
      );
    expect(places({ lead: false, drain: true, erase: true })).toEqual({
      recovery: 'wallet first',
      primary: 'wallet middle',
      network: 'wallet last',
      applock: 'phone first',
      haptics: 'phone last',
      empty: 'funds first',
      leave: 'funds middle',
      erase: 'funds last',
      diagnostics: 'help only',
    });
    // Leading, the phrase is not in the Wallet card; nor are the rows the
    // page cannot offer in theirs.
    expect(places({ lead: true, drain: false, erase: false })).toEqual({
      primary: 'wallet first',
      network: 'wallet last',
      applock: 'phone first',
      haptics: 'phone last',
      leave: 'funds only',
      diagnostics: 'help only',
    });
  });

  test.each(GROUPS)('the %s group is drawn as rowsOf lays it out', group => {
    for (const shape of SHAPES) {
      const drawn = hubItems(shape)
        .filter(item => item.kind === 'row' && item.group === group)
        .map(item => item.row);
      expect(drawn).toEqual(rowsOf(group, shape));
    }
  });
});

describe('a row in its card', () => {
  test.each([
    [0, 1, 'only'],
    [0, 2, 'first'],
    [1, 2, 'last'],
    [0, 3, 'first'],
    [1, 3, 'middle'],
    [2, 3, 'last'],
    [0, 0, 'only'],
  ] as const)('the row at %i of %i is %s', (index, count, edge) => {
    expect(edgeOf(index, count)).toBe(edge);
  });

  test.each([
    ['only', false, false],
    ['first', false, true],
    ['middle', true, true],
    ['last', true, false],
  ] as const)(
    'at %s, joined above %s and below %s',
    (edge: HubEdge, above, below) => {
      expect(joinedAbove(edge)).toBe(above);
      expect(joinedBelow(edge)).toBe(below);
    },
  );
});

describe('the arrival', () => {
  test('the page lands within the 350ms a handover may take', () => {
    expect(HUB_CASCADE).toBe(2);
    expect(HUB_LANDS).toBe(
      overlap.enterDelay + 2 * overlap.staggerMin + durations.enter,
    );
    expect(HUB_LANDS).toBeLessThanOrEqual(350);
    for (const shape of SHAPES) {
      for (const item of hubItems(shape)) {
        expect(item.step).toBeGreaterThanOrEqual(0);
        expect(item.step).toBeLessThanOrEqual(HUB_CASCADE);
      }
    }
  });

  test('the card first, then the phrase to save or the Wallet group, then the rest', () => {
    const steps = (shape: HubShape) =>
      Object.fromEntries(hubItems(shape).map(item => [item.key, item.step]));
    expect(steps({ lead: false, drain: true, erase: true })).toMatchObject({
      card: 0,
      'header:wallet': 1,
      recovery: 1,
      primary: 1,
      network: 1,
      'header:phone': 2,
      haptics: 2,
      empty: 2,
      diagnostics: 2,
      about: 2,
    });
    expect(steps({ lead: true, drain: false, erase: false })).toMatchObject({
      card: 0,
      recovery: 1,
      'header:wallet': 2,
      primary: 2,
      network: 2,
      leave: 2,
      about: 2,
    });
  });
});

describe('one row open at a time', () => {
  test.each([
    [null, 'primary', 'primary'],
    ['primary', 'primary', null],
    ['primary', 'network', 'network'],
    ['diagnostics', 'erase', 'erase'],
    ['erase', 'erase', null],
  ] as const)(
    'with %s open, pressing %s leaves %s open',
    (open, pressed, after) => {
      expect(nextOpen(open as HubRow | null, pressed as HubRow)).toBe(after);
    },
  );
});

const snapshot = (over: Parameters<typeof snapshotOf>[0] = {}) =>
  snapshotOf(over);

describe('whether the primary node answers', () => {
  test.each([
    [true, false, false, true],
    [true, true, false, false],
    [true, false, true, false],
    [false, false, false, false],
    [false, true, true, false],
  ])(
    'connected %s, connecting %s, stale %s: %s',
    (connected, connecting, stale, live) => {
      expect(
        answering({
          snapshot: snapshot({ primary: { connected } }),
          connecting,
          stale,
        }),
      ).toBe(live);
    },
  );
});

describe("the card's bloom", () => {
  const read = (
    over: Parameters<typeof snapshotOf>[0] = {},
    session: Partial<{
      refreshing: boolean;
      connecting: boolean;
      stale: boolean;
      backupPending: boolean;
    }> = {},
  ) =>
    cardBloom({
      snapshot: snapshot(over),
      refreshing: false,
      connecting: false,
      stale: false,
      backupPending: false,
      ...session,
    });

  test('breathes at rest, whole and fully open, in bloom', () => {
    expect(read({ wallet: { network: 'mainnet' } })).toEqual({
      mode: 'breathe',
      breath: 'whole',
      open: 1,
      tone: 'live',
      halo: false,
      droop: false,
    });
  });

  test('ratchets while a refresh runs or the engine starts', () => {
    expect(read({}, { refreshing: true }).mode).toBe('ratchet');
    expect(read({}, { connecting: true }).mode).toBe('ratchet');
  });

  test('opens to .6 and breathes its centre while setup is under way', () => {
    expect(read({ primary: { setup: 'pending' } })).toMatchObject({
      mode: 'breathe',
      breath: 'center',
      open: 0.6,
      droop: false,
    });
  });

  test('wilts at .8 once setup has stopped short', () => {
    expect(
      read({ primary: { setup: 'failed', setupError: 'Unavailable.' } }),
    ).toMatchObject({ breath: 'whole', open: 0.8, droop: true });
    // An error stops it, whatever the status says.
    expect(
      read({ primary: { setup: 'pending', setupError: 'Unavailable.' } }).droop,
    ).toBe(true);
  });

  test('is slate on a test network, old balance or not, and dormant on mainnet', () => {
    expect(read().tone).toBe('test');
    expect(read({}, { stale: true }).tone).toBe('test');
    expect(read({ wallet: { network: 'mainnet' } }, { stale: true }).tone).toBe(
      'dormant',
    );
  });

  test('wears the halo while the phrase is still to save', () => {
    expect(read({}, { backupPending: true }).halo).toBe(true);
  });
});

describe('what the card says', () => {
  test('a test network, its coins, and whether the primary answers', () => {
    expect(cardWords({ snapshot: snapshot(), live: true })).toBe(
      'Everyday, regtest. regtest is a test network. Its coins have no value. Primary connected',
    );
    expect(
      cardWords({
        snapshot: snapshot({ wallet: { network: 'mainnet' } }),
        live: false,
      }),
    ).toBe('Everyday, mainnet. Primary connecting');
  });

  test('a setup under way or stopped short, after the connection', () => {
    const mainnet = { network: 'mainnet' } as const;
    expect(
      cardWords({
        snapshot: snapshot({ wallet: mainnet, primary: { setup: 'pending' } }),
        live: true,
      }),
    ).toBe(`Everyday, mainnet. Primary connected. ${s.primary.setupPending}`);
    expect(
      cardWords({
        snapshot: snapshot({
          wallet: mainnet,
          primary: { setup: 'failed', connected: false },
        }),
        live: false,
      }),
    ).toBe(
      `Everyday, mainnet. Primary connecting. ${s.primary.setupFailedValue}`,
    );
  });

  test('no primary, without a dot', () => {
    const none = snapshot({ primary: { uri: '' } });
    expect(cardStatus(none, false)).toEqual({
      words: s.primary.none,
      look: null,
      attention: false,
      said: s.primary.none,
    });
  });

  test('the connection by its dot', () => {
    expect(cardStatus(snapshot(), true)).toMatchObject({
      words: s.card.connected,
      look: 'live',
    });
    expect(cardStatus(snapshot(), false)).toMatchObject({
      words: s.card.connecting,
      look: 'seeking',
    });
  });
});

describe("what a row's value says", () => {
  test('Primary node: connected, connecting, none, or setup failed in honey', () => {
    expect(primaryWords(snapshot(), true)).toEqual({
      words: s.primary.connected,
      look: 'live',
      attention: false,
      said: s.primary.connected,
    });
    expect(primaryWords(snapshot(), false)).toMatchObject({
      words: s.primary.connecting,
      look: 'seeking',
    });
    expect(primaryWords(snapshot({ primary: { uri: '' } }), true)).toEqual({
      words: s.primary.none,
      look: null,
      attention: false,
      said: s.primary.none,
    });
    const failed = snapshot({ primary: { setup: 'failed' } });
    expect(primaryWords(failed, true)).toEqual({
      words: s.primary.setupFailedValue,
      look: 'stopped',
      attention: true,
      said: 'Connected. Setup failed',
    });
    expect(primaryWords(failed, false).said).toBe('Connecting. Setup failed');
  });

  test('Network & servers: the network, with a flask off mainnet', () => {
    expect(networkWords('regtest')).toEqual({
      words: 'regtest',
      look: 'test',
      attention: false,
      said: 'regtest',
    });
    expect(networkWords('mainnet').look).toBeNull();
  });
});

describe('a drain shown in the history', () => {
  const drained = (phase: DrainProgress['phase'], status = 'pending') =>
    snapshot({
      activity: [
        {
          ...activityOf('sent', status as never),
          drain: { ...drainReviewOf().drain!, phase },
        },
      ],
    }).activity;

  test.each([
    ['preparing', 'underway'],
    ['closing', 'underway'],
    ['sweeping', 'underway'],
    ['pending', 'underway'],
    ['cancelling', 'underway'],
    ['review', 'unknown'],
    ['completed', null],
    ['cancelled', null],
  ] as const)('in %s is %s', (phase, state) => {
    expect(drainState(drained(phase))).toBe(state);
  });

  test('is over once its row is completed or failed, and absent without one', () => {
    expect(drainState(drained('pending', 'completed'))).toBeNull();
    expect(drainState(drained('pending', 'failed'))).toBeNull();
    expect(drainState([])).toBeNull();
    expect(
      drainState([activityOf('sent', 'pending')] as WalletSnapshot['activity']),
    ).toBeNull();
  });

  test('says so on its row: an orbit under way, honey while unconfirmed', () => {
    expect(drainWords('underway')).toEqual({
      words: s.empty.underway,
      look: 'working',
      attention: false,
      said: s.empty.underway,
    });
    expect(drainWords('unknown')).toEqual({
      words: s.empty.unknown,
      look: 'stopped',
      attention: true,
      said: s.empty.uncertainAnnouncement,
    });
    expect(drainWords(null)).toBeNull();
  });
});
