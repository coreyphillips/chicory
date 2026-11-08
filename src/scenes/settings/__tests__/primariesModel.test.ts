import {
  DEFAULT_FILL_TARGET_SATS,
  fillOf,
  fillTargetShown,
  hostLabel,
  moved,
  restingOffset,
  shiftOf,
  slotAt,
} from '../primariesModel';

/**
 * The figures behind Settings > Primary nodes (REDESIGN.md 6, Settings):
 * how full a node's bar is, what a full bar stands for, the name a node is
 * listed under, and where a dragged row lands.
 */

describe('the fill target shown', () => {
  it('is the saved one, else the default', () => {
    expect(fillTargetShown(250_000)).toBe(250_000);
    expect(fillTargetShown(null)).toBe(DEFAULT_FILL_TARGET_SATS);
    expect(fillTargetShown(undefined)).toBe(DEFAULT_FILL_TARGET_SATS);
    expect(fillTargetShown(0)).toBe(DEFAULT_FILL_TARGET_SATS);
  });
});

describe('how full a node is', () => {
  it('with several nodes is the balance against the fill target, full once reached', () => {
    const at = (balanceSat: number) =>
      fillOf({ balanceSat }, { total: 3, target: 250_000, receivableSats: 0 });
    expect(at(100_000)).toEqual({ level: 0.4, of: 250_000, full: false });
    expect(at(250_000)).toEqual({ level: 1, of: 250_000, full: true });
    expect(at(400_000)).toEqual({ level: 1, of: 250_000, full: true });
    expect(at(0)).toEqual({ level: 0, of: 250_000, full: false });
  });

  it('with one node is the balance against the channel as the wallet knows it, and never full', () => {
    expect(
      fillOf(
        { balanceSat: 100_000 },
        { total: 1, target: 250_000, receivableSats: 300_000 },
      ),
    ).toEqual({ level: 0.25, of: 400_000, full: false });
    expect(
      fillOf({ balanceSat: 0 }, { total: 1, target: 250_000, receivableSats: 0 }),
    ).toEqual({ level: 0, of: 0, full: false });
  });
});

describe('the name a node is listed under', () => {
  const key = `02${'1'.repeat(64)}`;
  it('is the host and port, with the key left out', () => {
    expect(hostLabel(`${key}@umbrel.local:9735`)).toBe('umbrel.local:9735');
    expect(hostLabel(`${key}@127.0.0.1:19846`)).toBe('127.0.0.1:19846');
    expect(hostLabel(` ${key}@node.example `)).toBe('node.example');
  });
  it('shortens an onion host and an Iroh node id', () => {
    const onion = `${'a'.repeat(28)}${'z'.repeat(28)}.onion`;
    expect(hostLabel(`${key}@${onion}:9735`)).toBe('aaaaaa…zzzzzz.onion:9735');
    expect(
      hostLabel(
        `${key}@iroh:${'8e'.repeat(32)}?relay=https%3A%2F%2Fuse1-1.relay.n0.iroh.link.%2F`,
      ),
    ).toBe('iroh:8e8e8e…8e8e8e');
  });
  it('draws anything else as it is', () => {
    expect(hostLabel('ws://relay.example')).toBe('ws://relay.example');
    expect(hostLabel(key)).toBe(key);
  });
});

describe('a dragged row', () => {
  const heights = [90, 90, 90];
  const gap = 8;

  it('takes a neighbour’s slot once its centre has passed the neighbour’s', () => {
    expect(slotAt(0, 0, heights, gap)).toBe(0);
    expect(slotAt(0, 40, heights, gap)).toBe(0);
    expect(slotAt(0, 99, heights, gap)).toBe(1);
    expect(slotAt(0, 197, heights, gap)).toBe(2);
    expect(slotAt(0, 500, heights, gap)).toBe(2);
    expect(slotAt(2, -99, heights, gap)).toBe(1);
    expect(slotAt(2, -197, heights, gap)).toBe(0);
    expect(slotAt(1, -500, heights, gap)).toBe(0);
    expect(slotAt(5, 10, heights, gap)).toBe(5);
  });

  it('moves the rows it passes out of its way by its own height and the gap', () => {
    expect(shiftOf(1, 0, 2, 98)).toBe(-98);
    expect(shiftOf(2, 0, 2, 98)).toBe(-98);
    expect(shiftOf(0, 0, 2, 98)).toBe(0);
    expect(shiftOf(0, 2, 0, 98)).toBe(98);
    expect(shiftOf(1, 2, 0, 98)).toBe(98);
    expect(shiftOf(2, 2, 0, 98)).toBe(0);
    expect(shiftOf(1, 0, 0, 98)).toBe(0);
  });

  it('comes to rest at the top of its new slot, with rows of any height', () => {
    expect(restingOffset(0, 2, heights, gap)).toBe(196);
    expect(restingOffset(2, 0, heights, gap)).toBe(-196);
    expect(restingOffset(1, 1, heights, gap)).toBe(0);
    const uneven = [60, 120, 90];
    // Down past a taller row: the dragged row ends where that row's foot was.
    expect(restingOffset(0, 1, uneven, gap)).toBe(68 + 120 - 60);
    expect(restingOffset(2, 0, uneven, gap)).toBe(-(60 + 8 + 120 + 8));
  });

  it('is placed in the order it was dropped at, and nowhere outside it', () => {
    expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 3)).toEqual(['a', 'b', 'c']);
  });
});
