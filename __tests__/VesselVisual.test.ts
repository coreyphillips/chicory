import type { WalletRecord } from '@beignet/wallet-core';
import { vesselVisual } from '../src/scenes/home/visual';
import type { VesselVisual } from '../src/scenes/home/visual';

/**
 * The vessel table (REDESIGN.md 5, Vessel): what the pill under the hero
 * looks like for each reason money can be on its way.
 */
type Lfbw = NonNullable<WalletRecord['lfbw']>;
type Channelize = NonNullable<Lfbw['lastChannelize']>;

const AT = 1_700_000_000_000;
const IN_FLIGHT = { availableSats: 75_000, pendingSats: 25_000 };
const SETTLED = { availableSats: 100_000, pendingSats: 0 };

const lfbw = (over: Partial<Lfbw> = {}): Lfbw => ({ enabled: true, ...over });
const decided = (
  action: Channelize['action'],
  reason?: string,
): Partial<Lfbw> => ({ lastChannelize: { action, at: AT, reason } });
const splice = (state: 'conflicted' | 'reverted'): Partial<Lfbw> => ({
  lastSplice: { state, spliceTxid: null, conflictTxid: null, at: AT },
});

/** Money on its way with nothing to explain it: plain glass and a sweep. */
const GLASS: VesselVisual = {
  weight: 'swollen',
  solid: 0.75,
  fill: 'glass',
  sheen: 'sweep',
  glyph: null,
  tone: 'bloom',
  retry: false,
};

test('everything spendable is a hairline, whole and plain', () => {
  expect(vesselVisual(SETTLED, undefined)).toEqual({
    ...GLASS,
    weight: 'hairline',
    solid: 1,
    sheen: 'none',
  });
});

test('money in flight swells the pill, split by what can be spent now', () => {
  expect(vesselVisual(IN_FLIGHT, undefined)).toEqual(GLASS);
  expect(vesselVisual(IN_FLIGHT, lfbw())).toEqual(GLASS);
});

test('an empty wallet draws a whole hairline rather than dividing by zero', () => {
  expect(
    vesselVisual({ availableSats: 0, pendingSats: 0 }, undefined).solid,
  ).toBe(1);
});

describe('the rows of the table', () => {
  test.each<[string, Partial<Lfbw>, Partial<VesselVisual>]>([
    [
      'below the channel floor: dust seeds',
      decided('wait', 'below-floor'),
      { fill: 'seeds', sheen: 'none', tone: 'dust' },
    ],
    ['a splice-in: a sprout', decided('splice-in'), { glyph: 'sprout' }],
    ['a channel open: a sprout', decided('open'), { glyph: 'sprout' }],
    ['a dual-funded open: a sprout', decided('open-v2'), { glyph: 'sprout' }],
    [
      'waiting on the fee: honey glass and a gauge, no sheen',
      decided('wait', 'fee-too-high'),
      { fill: 'honey', sheen: 'none', glyph: 'gauge', tone: 'honey' },
    ],
    [
      'a failed move: radish glass and a retry',
      decided('failed'),
      {
        fill: 'radish',
        sheen: 'none',
        glyph: 'refresh',
        tone: 'radish',
        retry: true,
      },
    ],
    [
      'waiting on a splice: a slow sheen and a clock',
      decided('wait', 'splicing'),
      { sheen: 'slow', glyph: 'clock' },
    ],
    [
      'waiting on a pending channel: a slow sheen and a clock',
      decided('wait', 'channel-pending'),
      { sheen: 'slow', glyph: 'clock' },
    ],
    [
      'waiting on confirmations: a slow sheen and a clock',
      decided('wait', 'unconfirmed'),
      { sheen: 'slow', glyph: 'clock' },
    ],
    [
      'a splice conflicted: a reversed honey sheen and a rewind',
      splice('conflicted'),
      { fill: 'honey', sheen: 'reversed', glyph: 'rewind', tone: 'honey' },
    ],
    [
      'a splice reverted: a sage wash and a rewind',
      splice('reverted'),
      { fill: 'sage', sheen: 'none', glyph: 'rewind', tone: 'sage' },
    ],
    [
      "a payer's funding: an inflow",
      { unpairedFunding: { at: AT } },
      { glyph: 'inflow' },
    ],
  ])('%s', (_name, record, look) => {
    expect(vesselVisual(IN_FLIGHT, lfbw(record))).toEqual({
      ...GLASS,
      ...look,
    });
  });
});

test('a decision whose money has already moved styles nothing', () => {
  for (const record of [
    decided('failed'),
    decided('wait', 'fee-too-high'),
    decided('open'),
    { unpairedFunding: { at: AT } },
  ]) {
    expect(vesselVisual(SETTLED, lfbw(record))).toEqual(
      vesselVisual(SETTLED, undefined),
    );
  }
});

test('a splice conflict is told even with nothing left in flight', () => {
  expect(vesselVisual(SETTLED, lfbw(splice('conflicted')))).toMatchObject({
    weight: 'hairline',
    glyph: 'rewind',
    tone: 'honey',
  });
});

test('a failure outranks a conflict, and a conflict outranks an explanation', () => {
  expect(
    vesselVisual(
      IN_FLIGHT,
      lfbw({ ...decided('failed'), ...splice('conflicted') }),
    ).tone,
  ).toBe('radish');
  expect(
    vesselVisual(
      IN_FLIGHT,
      lfbw({ ...decided('open'), ...splice('conflicted') }),
    ).glyph,
  ).toBe('rewind');
});
