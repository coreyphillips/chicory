import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Svg, { Path } from 'react-native-svg';
import { GLYPHS, GLYPH_LENGTHS, Glyph, strokeFor } from '../src/design/glyphs';
import type { GlyphName } from '../src/design/glyphs';
import { Icon } from '../src/components/ui';

const NAMES = Object.keys(GLYPHS) as GlyphName[];

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

const drawn = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Path).map(node => node.props.d);

const stroke = (tree: ReactTestRenderer) =>
  tree.root.findByType(Svg).props.strokeWidth;

test('the set is the one REDESIGN.md section 4 names', () => {
  const kept = [
    'check',
    'close',
    'copy',
    'scan',
    'search',
    'lock',
    'key',
    'shield',
    'eye',
    'eyeOff',
    'refresh',
    'bolt',
    'clock',
    'share',
    'plus',
  ];
  const renamed = ['send', 'receive', 'chain'];
  const settingsOnly = [
    'alert',
    'info',
    'back',
    'chevron',
    'chevronDown',
    'wallet',
  ];
  const added = [
    'cog',
    'question',
    'pause',
    'cross',
    'bang',
    'moon',
    'unplug',
    'infinity',
    'clipboard',
    'backspace',
    'qr',
    'sprout',
    'restore',
    'swap',
    'shieldAlert',
    'twin',
    'linkPlus',
    'gauge',
    'rewind',
    'inflow',
    'fund',
    'cameraOff',
    'faceScan',
    'fingerprint',
    'passcode',
    'pencil',
    'flask',
    'hash',
    'pin',
    'boltRetry',
    'orbit',
    'unlock',
  ];
  expect([...NAMES].sort()).toEqual(
    [...kept, ...renamed, ...settingsOnly, ...added].sort(),
  );
});

test.each(NAMES)('%s renders each of its parts', async name => {
  const tree = await render(<Glyph name={name} />);
  expect(drawn(tree)).toEqual(GLYPHS[name].map(part => part.d));
});

test.each(NAMES)('%s names its parts uniquely', name => {
  const ids = GLYPHS[name].map(part => part.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('glyphs that animate in pieces keep those pieces apart', () => {
  const ids = (name: GlyphName) => GLYPHS[name].map(part => part.id);
  expect(ids('cross')).toEqual(['first', 'second']);
  expect(ids('bang')).toEqual(['line', 'dot']);
  expect(ids('unplug')).toEqual(['left', 'right', 'spark']);
  expect(ids('chain')).toEqual(['upper', 'lower']);
  expect(ids('clock')).toEqual(['face', 'hands']);
  expect(ids('unlock')).toEqual(['body', 'shackle']);
  expect(ids('linkPlus')).toEqual([...ids('chain'), 'plus']);
  expect(ids('boltRetry')).toEqual(['refresh', 'bolt']);
});

describe('GLYPH_LENGTHS', () => {
  test('covers exactly the glyphs there are', () => {
    expect(Object.keys(GLYPH_LENGTHS).sort()).toEqual([...NAMES].sort());
  });

  test.each(NAMES)('%s has one positive length per part', name => {
    const lengths = GLYPH_LENGTHS[name];
    expect(lengths).toHaveLength(GLYPHS[name].length);
    for (const length of lengths) {
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeGreaterThan(0);
    }
  });

  test('matches the geometry it was measured from', () => {
    expect(GLYPH_LENGTHS.pause).toEqual([10, 10]);
    expect(GLYPH_LENGTHS.plus).toEqual([32]);
    expect(GLYPH_LENGTHS.bang).toEqual([8.5, 0.01]);
    // Rounded up, so a dash of this length always covers the stroke.
    expect(GLYPH_LENGTHS.cross[0]).toBeGreaterThanOrEqual(9 * Math.SQRT2);
    expect(GLYPH_LENGTHS.cross[0]).toBeLessThan(9 * Math.SQRT2 + 0.01);
    // The key's last arc is too small to reach its end and is scaled up.
    expect(GLYPH_LENGTHS.key[0]).toBeGreaterThan(60);
  });
});

describe('strokeFor', () => {
  test.each([
    [16, 2.0],
    [20, 1.8],
    [24, 1.7],
    [32, 1.5],
    [48, 1.3],
  ])('%ipt draws at %d', (size, width) => {
    expect(strokeFor(size)).toBeCloseTo(width, 5);
  });

  test('interpolates between the stops and holds past the ends', () => {
    expect(strokeFor(18)).toBeCloseTo(1.9, 5);
    expect(strokeFor(28)).toBeCloseTo(1.6, 5);
    expect(strokeFor(40)).toBeCloseTo(1.4, 5);
    expect(strokeFor(12)).toBe(2.0);
    expect(strokeFor(96)).toBe(1.3);
  });

  test('a glyph takes its stroke from its size unless one is given', async () => {
    expect(stroke(await render(<Glyph name="check" size={32} />))).toBeCloseTo(
      1.5,
      5,
    );
    expect(
      stroke(await render(<Glyph name="check" size={32} strokeWidth={3} />)),
    ).toBe(3);
  });

  test('the passcode dots are 2.6 at 24 and scale the same way', async () => {
    expect(stroke(await render(<Glyph name="passcode" />))).toBeCloseTo(2.6, 5);
    expect(
      stroke(await render(<Glyph name="passcode" size={48} />)),
    ).toBeCloseTo((1.3 * 2.6) / 1.7, 5);
  });
});

test.each([
  ['arrowUp', 'send'],
  ['arrowDown', 'receive'],
  ['link', 'chain'],
  ['settings', 'cog'],
  ['activity', 'orbit'],
] as const)('Icon draws the old %s as %s', async (old, glyph) => {
  const tree = await render(<Icon name={old} />);
  expect(drawn(tree)).toEqual(GLYPHS[glyph].map(part => part.d));
});
