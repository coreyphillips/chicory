import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import Svg, {
  Circle,
  G,
  LinearGradient,
  Path,
  Pattern,
} from 'react-native-svg';
import type { WalletRecord } from '@beignet/wallet-core';
import { Bloom } from '../src/glyphs/Bloom';
import type { BloomEvent, BloomMode, BloomTone } from '../src/glyphs/Bloom';
import { Odometer } from '../src/glyphs/Odometer';
import type { OdometerVariant } from '../src/glyphs/Odometer';
import { PulseDot } from '../src/glyphs/PulseDot';
import { StatusRing } from '../src/glyphs/StatusRing';
import type { RingVisual } from '../src/glyphs/StatusRing';
import { Vessel } from '../src/glyphs/Vessel';
import { Whisper, WhisperProvider } from '../src/glyphs/Whisper';
import { GLYPHS } from '../src/design/glyphs';
import { palette } from '../src/design/palette';
import { Pane } from '../src/stage/panes/Pane';
import { MASK } from '../src/theme';
import { copyViolations } from '../test-support/copyGuard';
import { a11yText, visibleText } from '../test-support/query';

/**
 * The glyphs as drawn (REDESIGN.md 5 and 8). Under Jest every animation
 * lands on its end at once and a style is read when it renders, so these
 * check what each state mounts and how it is wired, and GlyphMath checks
 * the motion itself.
 */
const mounted: ReactTestRenderer[] = [];

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  mounted.push(tree);
  return tree;
}

function reducedMotion(on = true) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

const hosts = (
  tree: ReactTestRenderer,
  where: (node: ReactTestInstance) => boolean,
) => tree.root.findAll(node => typeof node.type === 'string' && where(node));

/** Everything on screen that is not data by its shape. */
const prose = (tree: ReactTestRenderer) => copyViolations(tree, { data: [] });

// Reduce Motion is read once per app and kept, so each test sets it.
beforeEach(() => reducedMotion(false));

afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Bloom', () => {
  const petals = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(G)
      .filter(group => typeof group.props.transform === 'string');
  /** The view that turns, scales and fades a petal. */
  const turned = (group: ReactTestInstance) => {
    let at = group.parent;
    while (at && !(typeof at.type === 'string' && flat(at).transform)) {
      at = at.parent;
    }
    return flat(at!);
  };
  const rotation = (group: ReactTestInstance) =>
    parseFloat(
      (turned(group).transform as Array<{ rotate?: string }>).find(
        step => step.rotate,
      )!.rotate!,
    );

  const MODES: BloomMode[] = ['still', 'breathe', 'chase', 'ratchet'];
  const TONES: BloomTone[] = ['live', 'test', 'dormant'];

  test.each(MODES.flatMap(mode => TONES.map(tone => [mode, tone] as const)))(
    '%s in %s draws twelve petals and nothing to read',
    async (mode, tone) => {
      for (const size of [28, 96]) {
        const tree = await render(
          <Bloom size={size} mode={mode} tone={tone} />,
        );
        expect(petals(tree)).toHaveLength(12);
        expect(visibleText(tree)).toEqual([]);
      }
    },
  );

  test('below 40pt the tips keep three teeth and the centre is plain', async () => {
    const mark = await render(<Bloom size={28} />);
    const full = await render(<Bloom size={96} />);
    const tip = (tree: ReactTestRenderer) =>
      (tree.root.findAllByType(Path)[0].props.d as string).match(/L/g)!.length;
    expect(tip(mark)).toBe(6);
    expect(tip(full)).toBe(10);
    expect(mark.root.findAllByType(Circle)).toHaveLength(1);
    // The centre, 8 anthers and 5 pollen dots.
    expect(full.root.findAllByType(Circle)).toHaveLength(14);
    // Veins only at full detail.
    expect(mark.root.findAllByType(Path)).toHaveLength(12);
    expect(full.root.findAllByType(Path)).toHaveLength(24);
    const forced = await render(<Bloom size={96} detail="mark" />);
    expect(forced.root.findAllByType(Circle)).toHaveLength(1);
  });

  test('each tone paints its petals its own way', async () => {
    const fill = async (tone: BloomTone) => {
      const tree = await render(<Bloom size={96} tone={tone} />);
      return tree.root.findAllByType(Path)[0].props;
    };
    expect((await fill('live')).fill).toMatch(/^url\(#/);
    expect(await fill('test')).toMatchObject({
      fill: 'none',
      stroke: palette.slate,
    });
    expect(await fill('dormant')).toMatchObject({
      fill: palette.husk,
      stroke: palette.bark,
    });
  });

  test('the halo is a honey ring that comes and goes', async () => {
    const tree = await render(<Bloom size={28} halo />);
    const honey = () =>
      tree.root
        .findAllByType(Circle)
        .filter(circle => circle.props.stroke === palette.honey);
    expect(honey()).toHaveLength(1);
    await act(async () => tree.update(<Bloom size={28} />));
    expect(honey()).toHaveLength(0);
  });

  test.each<BloomEvent['kind']>(['burst', 'wilt', 'fold', 'fall', 'shake'])(
    'a %s plays when its key changes, and settles',
    async kind => {
      const tree = await render(<Bloom size={96} />);
      for (const key of [1, 2]) {
        await act(async () =>
          tree.update(<Bloom size={96} event={{ kind, key }} />),
        );
        expect(petals(tree)).toHaveLength(12);
      }
      // A burst's clone is gone once it has played: at most a petal and a
      // vein for each of the twelve.
      expect(tree.root.findAllByType(Path).length).toBeLessThanOrEqual(24);
      await act(async () => tree.update(<Bloom size={96} />));
      expect(petals(tree)).toHaveLength(12);
    },
  );

  test('a burst draws a clone while it plays', async () => {
    const tree = await render(<Bloom size={96} />);
    act(() =>
      tree.update(<Bloom size={96} event={{ kind: 'burst', key: 1 }} />),
    );
    // Twelve petals, and the clone's twelve drawn in one Svg.
    expect(tree.root.findAllByType(Path).length).toBeGreaterThan(24);
    await act(async () => {});
    expect(tree.root.findAllByType(Path)).toHaveLength(24);
  });

  test('a bloom that mounts wilted, folded or fallen starts in that pose', async () => {
    const wilted = await render(
      <Bloom size={96} event={{ kind: 'wilt', key: 0 }} />,
    );
    const plain = await render(<Bloom size={96} />);
    petals(wilted).forEach((petal, i) => {
      expect(rotation(petal)).toBeCloseTo(rotation(petals(plain)[i]) + 10);
    });
    expect(wilted.root.findAllByType(Path)[0].props.fill).toBe(palette.dust);

    const folded = await render(
      <Bloom size={96} event={{ kind: 'fold', key: 0 }} />,
    );
    for (const petal of petals(folded))
      expect(turned(petal).opacity).toBe(0.25);

    const fallen = await render(
      <Bloom size={96} event={{ kind: 'fall', key: 0 }} />,
    );
    for (const petal of petals(fallen)) expect(turned(petal).opacity).toBe(0);
  });

  test('a labelled chase is busy', async () => {
    const tree = await render(
      <Bloom size={96} mode="chase" accessibilityLabel="Opening wallet" />,
    );
    expect(tree.root.findByProps({ accessible: true }).props).toMatchObject({
      accessibilityRole: 'image',
      accessibilityState: { busy: true },
    });
  });

  test('a burst clone grows as it fades; under Reduce Motion it only fades', async () => {
    const clone = async () => {
      const tree = await render(<Bloom size={96} />);
      act(() =>
        tree.update(<Bloom size={96} event={{ kind: 'burst', key: 1 }} />),
      );
      // The clone is the one Svg that draws every petal.
      const svg = tree.root
        .findAllByType(Svg)
        .find(node => node.findAllByType(Path).length === 12)!;
      let at = svg.parent;
      while (at && !(typeof at.type === 'string' && flat(at).transform)) {
        at = at.parent;
      }
      const scale = (flat(at!).transform as Array<{ scale?: number }>).find(
        step => step.scale !== undefined,
      )!.scale;
      await act(async () => {});
      return scale;
    };
    expect(await clone()).toBeCloseTo(1.6);
    reducedMotion();
    expect(await clone()).toBe(1);
  });

  test('under Reduce Motion a fall only fades, with nothing dropping', async () => {
    const drop = async () => {
      const tree = await render(
        <Bloom size={96} event={{ kind: 'fall', key: 0 }} />,
      );
      return petals(tree).map(petal => {
        const style = turned(petal);
        const step = (style.transform as Array<{ translateY?: number }>).find(
          part => part.translateY !== undefined,
        );
        return [style.opacity, step?.translateY];
      });
    };
    for (const pose of await drop()) expect(pose).toEqual([0, 48]);
    reducedMotion();
    for (const pose of await drop()) expect(pose).toEqual([0, 0]);
  });

  test('under Reduce Motion the chase is a still bloom at .6, and a shake is a tint', async () => {
    reducedMotion();
    const tree = await render(<Bloom size={96} mode="chase" />);
    for (const petal of petals(tree)) expect(turned(petal).opacity).toBe(0.6);
    const tint = hosts(
      tree,
      node => flat(node).backgroundColor === palette.radishSoft,
    );
    expect(tint).toHaveLength(1);
    await act(async () =>
      tree.update(<Bloom size={96} event={{ kind: 'shake', key: 1 }} />),
    );
    const moved = hosts(tree, node =>
      ((flat(node).transform as object[]) ?? []).some(
        step =>
          'translateX' in step &&
          (step as { translateX: number }).translateX !== 0,
      ),
    );
    expect(moved).toEqual([]);
  });
});

describe('Bloom counting words', () => {
  const petals = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(G)
      .filter(group => typeof group.props.transform === 'string');
  const hostAbove = (node: ReactTestInstance) => {
    let at = node.parent;
    while (at && typeof at.type !== 'string') at = at.parent;
    return at!;
  };
  /** The view that turns, scales and fades a petal. */
  const turned = (group: ReactTestInstance) => {
    let at = group.parent;
    while (at && !(typeof at.type === 'string' && flat(at).transform)) {
      at = at.parent;
    }
    return at!;
  };
  const pose = (group: ReactTestInstance) => {
    const style = flat(turned(group));
    const steps = style.transform as Array<Record<string, string | number>>;
    const step = (name: string) => steps.find(part => name in part)![name];
    return {
      opacity: style.opacity as number,
      rotate: parseFloat(step('rotate') as string),
      scaleX: step('scaleX') as number,
    };
  };
  const fill = (group: ReactTestInstance) =>
    group.findAllByType(Path)[0].props.fill as string;
  /** The ring behind is drawn first, under the twelve in front. */
  const rings = (tree: ReactTestRenderer) => {
    const all = petals(tree);
    expect(all).toHaveLength(24);
    return { behind: all.slice(0, 12), front: all.slice(12) };
  };
  const shown = (ring: ReactTestInstance[]) =>
    flat(hostAbove(turned(ring[0]))).opacity;

  test('each word lights the next petal, and the rest stand dormant', async () => {
    const tree = await render(<Bloom size={120} lit={5} />);
    const { behind, front } = rings(tree);
    expect(front.slice(0, 5).map(fill)).toEqual(
      Array(5).fill(expect.stringMatching(/^url\(#/)),
    );
    expect(front.slice(5).map(fill)).toEqual(Array(7).fill(palette.husk));
    // A dormant petal stands half open and faint until its word comes.
    expect(pose(front[0]).opacity).toBe(1);
    expect(pose(front[5]).opacity).toBeCloseTo(0.25 + 0.75 * 0.55);
    // The ring behind waits for the first to be whole.
    expect(shown(behind)).toBe(0);
    expect(visibleText(tree)).toEqual([]);
  });

  test('from the thirteenth word the ring behind lights, half a petal round and longer', async () => {
    const tree = await render(<Bloom size={120} lit={14} />);
    const { behind, front } = rings(tree);
    expect(shown(behind)).toBe(1);
    expect(front.map(fill).filter(paint => paint === palette.husk)).toEqual([]);
    expect(behind.slice(2).map(fill)).toEqual(Array(10).fill(palette.husk));
    const whole = await render(<Bloom size={120} lit={24} />);
    const both = rings(whole);
    both.front.forEach((petal, i) => {
      expect(pose(both.behind[i]).rotate).toBeCloseTo(pose(petal).rotate + 15);
      expect(pose(both.behind[i]).scaleX / pose(petal).scaleX).toBeCloseTo(
        1.25,
      );
    });
    // Both rings fit the bloom's own box.
    expect(pose(both.behind[0]).scaleX).toBeCloseTo(1);
  });

  test('past 24 words every petal turns radish; a test network counts in slate', async () => {
    const over = await render(<Bloom size={120} lit={25} />);
    expect(new Set(petals(over).map(fill))).toEqual(new Set([palette.radish]));
    const test = await render(<Bloom size={120} lit={3} tone="test" />);
    const { front } = rings(test);
    expect(front.slice(0, 3).map(fill)).toEqual(Array(3).fill('none'));
    expect(front[3].findAllByType(Path)[0].props.fill).toBe(palette.husk);
  });

  test('a refused count wilts only the petals it lit', async () => {
    const tree = await render(
      <Bloom size={120} lit={12} event={{ kind: 'wilt', key: 0 }} />,
    );
    const { behind, front } = rings(tree);
    expect(new Set(front.map(fill))).toEqual(new Set([palette.dust]));
    expect(new Set(behind.map(fill))).toEqual(new Set([palette.husk]));
  });
});

describe('Odometer', () => {
  const SIGNS = { '+': '+', '-': '−' } as const;
  const VARIANTS: OdometerVariant[] = [
    'hero',
    'amount',
    'amountDetail',
    'line',
    'row',
  ];

  test.each(VARIANTS)(
    '%s draws the amount and its unit, and nothing else',
    async variant => {
      for (const sign of [null, '+', '-'] as const) {
        const tree = await render(
          <Odometer sats={261_500} unit="sats" variant={variant} sign={sign} />,
        );
        expect(visibleText(tree).join('')).toBe(
          `${sign ? SIGNS[sign] : ''}261,500sats`,
        );
        expect(prose(tree)).toEqual([]);
        // One element to a screen reader.
        expect(a11yText(tree)).toEqual(['261,500 sats']);
      }
    },
  );

  test('a new amount rolls through columns, then rests on the digits', async () => {
    const tree = await render(
      <Odometer sats={1_200} unit="sats" variant="hero" />,
    );
    act(() =>
      tree.update(<Odometer sats={1_450} unit="sats" variant="hero" />),
    );
    // Each column holds 0 to 9 and a trailing 0 while it rolls.
    expect(visibleText(tree)).toContain('9');
    await act(async () => {});
    expect(visibleText(tree).join('')).toBe('1,450sats');
  });

  test('a new leading digit joins the roll, and one going away leaves after it', async () => {
    const tree = await render(
      <Odometer sats={999} unit="sats" variant="line" />,
    );
    act(() =>
      tree.update(<Odometer sats={1_000} unit="sats" variant="line" />),
    );
    expect(visibleText(tree)).toContain(',');
    await act(async () => {});
    expect(visibleText(tree).join('')).toBe('1,000sats');
    await act(async () =>
      tree.update(<Odometer sats={999} unit="sats" variant="line" />),
    );
    expect(visibleText(tree).join('')).toBe('999sats');
  });

  test('a new unit swaps the cells without rolling', async () => {
    const tree = await render(
      <Odometer sats={120_000} unit="sats" variant="hero" />,
    );
    act(() =>
      tree.update(<Odometer sats={120_000} unit="btc" variant="hero" />),
    );
    expect(visibleText(tree).join('')).toBe('0.00120000BTC');
    // The trailing zeros are dust.
    const dust = hosts(tree, node => flat(node).color === palette.dust);
    expect(dust.map(node => node.children.join(''))).toEqual([
      '0',
      '0',
      '0',
      '0',
    ]);
  });

  test('hiding scrambles the digits, then shows six dots; showing brings them back', async () => {
    const tree = await render(
      <Odometer sats={4_200} unit="sats" variant="row" />,
    );
    act(() =>
      tree.update(<Odometer sats={4_200} unit="sats" variant="row" masked />),
    );
    // Scrambling runs in the columns, before the mask.
    expect(visibleText(tree)).toContain('9');
    await act(async () => {});
    expect(visibleText(tree).join('')).toBe(`${MASK}sats`);
    expect(a11yText(tree)).toEqual(['Amount hidden']);
    await act(async () =>
      tree.update(<Odometer sats={4_200} unit="sats" variant="row" />),
    );
    expect(visibleText(tree).join('')).toBe('4,200sats');
  });

  test('a masked amount is its dots alone, whichever way it went', async () => {
    for (const sign of ['+', '-'] as const) {
      const tree = await render(
        <Odometer sats={4_200} unit="sats" variant="row" sign={sign} masked />,
      );
      expect(visibleText(tree).join('')).toBe(`${MASK}sats`);
      expect(prose(tree)).toEqual([]);
      await act(async () =>
        tree.update(
          <Odometer sats={4_200} unit="sats" variant="row" sign={sign} />,
        ),
      );
      expect(visibleText(tree).join('')).toBe(`${SIGNS[sign]}4,200sats`);
    }
  });

  test('a stale amount is inked steam', async () => {
    const tree = await render(
      <Odometer sats={4_200} unit="sats" variant="hero" stale />,
    );
    const inked = hosts(
      tree,
      node =>
        typeof node.children[0] === 'string' &&
        /\d/.test(node.children[0] as string),
    );
    for (const node of inked) expect(flat(node).color).toBe(palette.steam);
  });

  test('the hero steps down to fit a long amount, and holds its size otherwise', async () => {
    const size = async (sats: number, unit: 'sats' | 'btc') => {
      const tree = await render(
        <Odometer sats={sats} unit={unit} variant="hero" />,
      );
      const digit = hosts(tree, node => node.children[0] === '1')[0];
      return flat(digit);
    };
    expect((await size(261_500, 'sats')).fontSize).toBe(64);
    const whole = await size(2_100_000_000_000_000, 'btc');
    expect([56, 48, 40]).toContain(whole.fontSize);
    // Its line height and tracking come down with it.
    expect(whole.lineHeight).toBe(Math.round((72 * whole.fontSize) / 64));
    expect(whole.letterSpacing).toBeCloseTo((-1.5 * whole.fontSize) / 64);
    // Hidden, it keeps the size of its six dots, so its size says nothing
    // about how long the amount is.
    const tree = await render(
      <Odometer
        sats={2_100_000_000_000_000}
        unit="btc"
        variant="hero"
        masked
      />,
    );
    const dot = hosts(tree, node => node.children[0] === MASK[0])[0];
    expect(flat(dot).fontSize).toBe(64);
  });

  test('a roll lands every column on its own digit, even beside a nine', async () => {
    const tree = await render(
      <Odometer sats={1_450} unit="sats" variant="line" />,
    );
    act(() =>
      tree.update(<Odometer sats={1_295} unit="sats" variant="line" />),
    );
    // The roll has landed but not yet settled into still digits: each
    // column rests on the amount's own digit, where the carry alone would
    // leave the hundreds halfway between 2 and 3.
    const columns = hosts(tree, node =>
      ((flat(node).transform as object[]) ?? []).some(
        step => 'translateY' in step,
      ),
    );
    const line = 26 * 1.4;
    const shown = columns.map(column => {
      const step = (
        flat(column).transform as Array<{ translateY?: number }>
      ).find(part => part.translateY !== undefined)!;
      return Math.round((-step.translateY! / line) * 100) / 100;
    });
    expect(shown).toEqual([1, 2, 9, 5]);
    await act(async () => {});
    expect(visibleText(tree).join('')).toBe('1,295sats');
  });

  test('under Reduce Motion a new amount crossfades instead of rolling', async () => {
    reducedMotion();
    const tree = await render(
      <Odometer sats={1_200} unit="sats" variant="hero" />,
    );
    act(() =>
      tree.update(<Odometer sats={1_450} unit="sats" variant="hero" />),
    );
    expect(visibleText(tree).join('')).toBe('1,450sats');
    act(() =>
      tree.update(<Odometer sats={1_450} unit="sats" variant="hero" masked />),
    );
    expect(visibleText(tree).join('')).toBe(`${MASK}sats`);
  });
});

describe('Vessel', () => {
  type Lfbw = NonNullable<WalletRecord['lfbw']>;
  const decided = (action: string, reason?: string): Lfbw => ({
    enabled: true,
    lastChannelize: {
      action: action as NonNullable<Lfbw['lastChannelize']>['action'],
      at: 1,
      reason,
    },
  });
  const ROWS: Array<[string, Lfbw | undefined, string | null]> = [
    ['plain glass', undefined, null],
    ['below the floor', decided('wait', 'below-floor'), null],
    ['moving in', decided('splice-in'), 'sprout'],
    ['the fee wait', decided('wait', 'fee-too-high'), 'gauge'],
    ['a failure', decided('failed'), 'refresh'],
    ['confirming', decided('wait', 'channel-pending'), 'clock'],
    [
      'a conflicted splice',
      {
        enabled: true,
        lastSplice: {
          state: 'conflicted',
          spliceTxid: null,
          conflictTxid: null,
          at: 1,
        },
      },
      'rewind',
    ],
    [
      'unpaired funding',
      { enabled: true, unpairedFunding: { at: 1 } },
      'inflow',
    ],
  ];
  const drawn = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(Path).map(path => path.props.d as string);

  test.each(ROWS)(
    '%s draws its glyph over the pill',
    async (_, lfbw, glyph) => {
      const tree = await render(
        <Vessel
          availableSats={250_000}
          pendingSats={11_500}
          lfbw={lfbw}
          unit="sats"
        />,
      );
      const expected = glyph
        ? GLYPHS[glyph as keyof typeof GLYPHS].map(part => part.d)
        : [];
      for (const d of expected) expect(drawn(tree)).toContain(d);
      expect(prose(tree)).toEqual([]);
    },
  );

  test('a failure wears a radish retry ring', async () => {
    const tree = await render(
      <Vessel
        availableSats={1}
        pendingSats={1}
        lfbw={decided('failed')}
        unit="sats"
      />,
    );
    expect(
      hosts(tree, node => flat(node).borderColor === palette.radish),
    ).toHaveLength(1);
  });

  test('below the floor, seeds sit in the glass once it has a width', async () => {
    const tree = await render(
      <Vessel
        availableSats={20_000}
        pendingSats={5_000}
        lfbw={decided('wait', 'below-floor')}
        unit="sats"
      />,
    );
    const root = tree.root.findByProps({ accessible: true });
    await act(async () =>
      root.props.onLayout({
        nativeEvent: { layout: { width: 300, height: 8 } },
      }),
    );
    const seeds = hosts(
      tree,
      node => flat(node).backgroundColor === palette.dust,
    );
    expect(seeds).toHaveLength(5);
  });

  test('everything spendable is a cream hairline; a hidden balance too', async () => {
    const settled = await render(
      <Vessel availableSats={250_000} pendingSats={0} unit="sats" />,
    );
    const hidden = await render(
      <Vessel
        availableSats={250_000}
        pendingSats={11_500}
        lfbw={decided('failed')}
        unit="sats"
        masked
      />,
    );
    for (const tree of [settled, hidden]) {
      expect(
        hosts(
          tree,
          node => flat(node).backgroundColor === 'rgba(243,236,223,0.25)',
        ),
      ).toHaveLength(1);
    }
    expect(drawn(hidden)).toEqual([]);
    expect(a11yText(hidden)).toEqual(['Balance hidden']);
  });

  test('a tap shows both figures for three seconds', async () => {
    jest.useFakeTimers();
    const tree = await render(
      <Vessel availableSats={250_000} pendingSats={11_500} unit="sats" />,
    );
    const root = tree.root.findByProps({ accessible: true });
    const touch = (x: number) => ({ nativeEvent: { pageX: x, pageY: 20 } });
    // A drag is not a tap.
    await act(async () => {
      root.props.onResponderGrant(touch(10));
      root.props.onResponderRelease(touch(80));
    });
    expect(visibleText(tree)).toEqual([]);
    await act(async () => {
      root.props.onResponderGrant(touch(10));
      root.props.onResponderRelease(touch(12));
    });
    expect(visibleText(tree)).toEqual(['250,000 sats', '11,500 sats']);
    expect(prose(tree)).toEqual([]);
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(visibleText(tree)).toEqual([]);
  });

  test('a hidden balance, or a pane out of use, takes no tap', async () => {
    const hidden = await render(
      <Vessel availableSats={1} pendingSats={1} unit="sats" masked />,
    );
    const aside = await render(
      <Pane active={false}>
        <Vessel availableSats={1} pendingSats={1} unit="sats" />
      </Pane>,
    );
    for (const tree of [hidden, aside]) {
      expect(
        tree.root.findAll(
          node => typeof node.props.onResponderRelease === 'function',
        ),
      ).toEqual([]);
    }
  });

  test('stale, it dims', async () => {
    const tree = await render(
      <Vessel availableSats={1} pendingSats={1} unit="sats" stale />,
    );
    expect(
      hosts(tree, node => flat(node).opacity === 0.55).length,
    ).toBeGreaterThan(0);
  });

  test('the spendable part grows from the left and the glass from the right', async () => {
    const tree = await render(
      <Vessel availableSats={250_000} pendingSats={11_500} unit="sats" />,
    );
    const part = (origin: string) =>
      flat(hosts(tree, node => flat(node).transformOrigin === origin)[0]);
    const scaleX = (style: object) =>
      ((style as { transform: Array<{ scaleX?: number }> }).transform.find(
        step => step.scaleX !== undefined,
      )?.scaleX ?? NaN) as number;
    const solid = part('left center');
    const glass = part('right center');
    expect(solid.backgroundColor).toBe(palette.bloom);
    expect(glass.backgroundColor).toBe(palette.glass);
    expect(scaleX(solid)).toBeCloseTo(250_000 / 261_500);
    expect(scaleX(solid) + scaleX(glass)).toBeCloseTo(1);
    // With money moving the hairline gives way to the glass.
    const hairline = hosts(
      tree,
      node => flat(node).backgroundColor === 'rgba(243,236,223,0.25)',
    );
    expect(flat(hairline[0]).opacity).toBe(0);
  });

  test.each([
    [
      'confirming',
      decided('wait', 'channel-pending'),
      'minute',
      ['hour', 'face'],
    ],
    ['the fee wait', decided('wait', 'fee-too-high'), 'needle', ['dial']],
  ] as const)(
    'while %s only the moving part of its glyph turns',
    async (_, lfbw, moving, still) => {
      const tree = await render(
        <Vessel
          availableSats={250_000}
          pendingSats={11_500}
          lfbw={lfbw}
          unit="sats"
        />,
      );
      const glyph =
        lfbw.lastChannelize!.reason === 'fee-too-high'
          ? GLYPHS.gauge
          : GLYPHS.clock;
      const d = (id: string) => glyph.find(part => part.id === id)!.d;
      const turns = (id: string) => {
        let at = tree.root.findByProps({ d: d(id) }).parent;
        while (at && !(typeof at.type === 'string' && flat(at).transform)) {
          at = at.parent;
        }
        return (
          !!at &&
          (flat(at).transform as object[]).some(step => 'rotate' in step)
        );
      };
      expect(turns(moving)).toBe(true);
      for (const id of still) expect(turns(id)).toBe(false);
    },
  );

  test('under Reduce Motion the glass holds a still hatch instead of a sheen', async () => {
    reducedMotion();
    const tree = await render(
      <Vessel availableSats={1} pendingSats={1} unit="sats" />,
    );
    const root = tree.root.findByProps({ accessible: true });
    await act(async () =>
      root.props.onLayout({
        nativeEvent: { layout: { width: 300, height: 8 } },
      }),
    );
    expect(tree.root.findAllByType(Pattern)).toHaveLength(1);
    expect(tree.root.findAllByType(LinearGradient)).toEqual([]);
    // It covers only the glass, from the seam to the end.
    const glass = hosts(
      tree,
      node =>
        flat(node).left === 150 && node.findAllByType(Pattern).length === 1,
    );
    expect(glass).toHaveLength(1);
  });
});

describe('PulseDot', () => {
  const core = (tree: ReactTestRenderer) => {
    const colored = hosts(
      tree,
      node =>
        [palette.sage, palette.honey, palette.radish].includes(
          flat(node).backgroundColor as never,
        ) ||
        [palette.honey, palette.radish].includes(
          flat(node).borderColor as never,
        ),
    );
    return flat(colored[colored.length - 1]);
  };

  test.each([
    ['live', { backgroundColor: palette.sage }],
    ['reconnecting', { backgroundColor: palette.honey }],
    ['failed', { borderColor: palette.radish, backgroundColor: palette.roast }],
  ] as const)('%s is its own dot', async (state, look) => {
    const tree = await render(<PulseDot state={state} pingKey={1} />);
    expect(core(tree)).toMatchObject(look);
    expect(visibleText(tree)).toEqual([]);
  });

  test('only a live dot pings, and a new poll pings again', async () => {
    const tree = await render(<PulseDot state="live" pingKey={1} />);
    await act(async () => tree.update(<PulseDot state="live" pingKey={2} />));
    await act(async () => tree.update(<PulseDot state="failed" pingKey={3} />));
    await act(async () => tree.update(<PulseDot state="hidden" />));
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.update(<PulseDot state="live" pingKey={4} />));
    expect(a11yText(tree)).toEqual(['Connected.']);
  });

  test('under Reduce Motion reconnecting is a hollow honey ring', async () => {
    reducedMotion();
    const tree = await render(<PulseDot state="reconnecting" />);
    expect(core(tree)).toMatchObject({
      borderColor: palette.honey,
      backgroundColor: palette.roast,
    });
  });
});

describe('StatusRing', () => {
  const PENDING: RingVisual = {
    tone: 'bloom',
    pattern: 'orbit',
    glyph: 'send',
  };
  const dashes = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(Path)
      .filter(path => Array.isArray(path.props.strokeDasharray));

  test('a ring that mounts in a state shows it still', async () => {
    const tree = await render(
      <StatusRing
        size={40}
        visual={{ tone: 'steam', pattern: 'full', glyph: 'send' }}
      />,
    );
    expect(dashes(tree)).toEqual([]);
  });

  test('completing draws the glyph after the fill starts', async () => {
    const tree = await render(<StatusRing size={96} visual={PENDING} />);
    await act(async () =>
      tree.update(
        <StatusRing
          size={96}
          visual={{ tone: 'steam', pattern: 'full', glyph: 'send' }}
        />,
      ),
    );
    expect(dashes(tree).map(path => path.props.d)).toEqual(
      GLYPHS.send.map(part => part.d),
    );
  });

  test('failing draws the cross in two strokes', async () => {
    const tree = await render(<StatusRing size={120} visual={PENDING} />);
    await act(async () =>
      tree.update(
        <StatusRing
          size={120}
          visual={{ tone: 'radish', pattern: 'full', glyph: 'cross' }}
        />,
      ),
    );
    expect(dashes(tree)).toHaveLength(2);
  });

  test('an unknown outcome grows its pause bars one by one under a halo', async () => {
    const tree = await render(<StatusRing size={120} visual={PENDING} />);
    await act(async () =>
      tree.update(
        <StatusRing
          size={120}
          visual={{ tone: 'honey', pattern: 'held', glyph: 'pause' }}
        />,
      ),
    );
    const bars = hosts(tree, node =>
      ((flat(node).transform as object[]) ?? []).some(step => 'scaleY' in step),
    );
    expect(bars).toHaveLength(GLYPHS.pause.length);
    const honey = tree.root
      .findAllByType(Circle)
      .filter(circle => circle.props.stroke === palette.honey);
    // The ring and its halo.
    expect(honey).toHaveLength(2);
  });

  test('an open ring keeps its badge in the gap', async () => {
    const tree = await render(
      <StatusRing
        size={96}
        visual={{
          tone: 'steam',
          pattern: 'gap',
          glyph: 'question',
          badge: 'chain',
        }}
      />,
    );
    const badge = hosts(
      tree,
      node => flat(node).backgroundColor === palette.roast,
    )[0];
    expect(flat(badge).left).toBeGreaterThan(48);
    expect(flat(badge).top).toBeLessThan(48);
  });

  test('under Reduce Motion a change shows the new state still, and a failure tints', async () => {
    reducedMotion();
    const tree = await render(<StatusRing size={96} visual={PENDING} />);
    await act(async () =>
      tree.update(
        <StatusRing
          size={96}
          visual={{ tone: 'radish', pattern: 'full', glyph: 'cross' }}
        />,
      ),
    );
    expect(dashes(tree)).toEqual([]);
    expect(
      hosts(tree, node => flat(node).backgroundColor === palette.radishSoft),
    ).toHaveLength(1);
  });
});

describe('Whisper', () => {
  async function held(element: React.ReactElement) {
    const tree = await render(
      <GestureHandlerRootView>
        <WhisperProvider>{element}</WhisperProvider>
      </GestureHandlerRootView>,
    );
    const press = async (index: number) => {
      const gesture =
        tree.root.findAllByType(GestureDetector)[index].props.gesture;
      await act(async () =>
        fireGestureHandler(gesture, [
          { state: State.BEGAN },
          { state: State.ACTIVE, absoluteX: 100, absoluteY: 300 },
          { state: State.END },
        ]),
      );
    };
    return { tree, press };
  }

  test('only one whisper shows at a time, and the pill is the only words', async () => {
    const { tree, press } = await held(
      <>
        <Whisper label="Connected.">
          <Text>1</Text>
        </Whisper>
        <Whisper label="Reconnecting to your wallet.">
          <Text>2</Text>
        </Whisper>
      </>,
    );
    await press(0);
    await press(1);
    expect(visibleText(tree)).toEqual([
      '1',
      '2',
      'Reconnecting to your wallet.',
    ]);
    expect(prose(tree).map(found => found.text)).toEqual([
      'Reconnecting to your wallet.',
    ]);
    // A screen reader already has the words; the pill is hidden from it.
    expect(a11yText(tree)).toEqual([]);
  });

  test('it grows from .92 as it fades in; under Reduce Motion it only fades', async () => {
    const scale = async () => {
      const { tree, press } = await held(
        <Whisper label="Connected.">
          <Text>1</Text>
        </Whisper>,
      );
      await press(0);
      const [pill] = hosts(
        tree,
        node => flat(node).backgroundColor === palette.cocoa,
      );
      return (flat(pill).transform as Array<{ scale?: number }>).find(
        step => step.scale !== undefined,
      )!.scale;
    };
    expect(await scale()).toBeCloseTo(0.92);
    reducedMotion();
    expect(await scale()).toBe(1);
  });

  test('the pill goes with its source, when it leaves or its pane goes out of use', async () => {
    const pill = (tree: ReactTestRenderer) =>
      hosts(tree, node => flat(node).backgroundColor === palette.cocoa);
    const app = (active: boolean, shown = true) => (
      <GestureHandlerRootView>
        <WhisperProvider>
          <Pane active={active}>
            {shown ? (
              <Whisper label="Connected.">
                <Text>1</Text>
              </Whisper>
            ) : null}
          </Pane>
        </WhisperProvider>
      </GestureHandlerRootView>
    );
    for (const after of [app(false), app(true, false)]) {
      const tree = await render(app(true));
      const gesture = tree.root.findByType(GestureDetector).props.gesture;
      await act(async () =>
        fireGestureHandler(gesture, [
          { state: State.BEGAN },
          { state: State.ACTIVE, absoluteX: 100, absoluteY: 300 },
          { state: State.END },
        ]),
      );
      expect(pill(tree)).toHaveLength(1);
      await act(async () => tree.update(after));
      expect(pill(tree)).toEqual([]);
    }
  });

  test('a pane out of use asks nothing', async () => {
    const { tree } = await held(
      <Pane active={false}>
        <Whisper label="Connected.">
          <Text>1</Text>
        </Whisper>
      </Pane>,
    );
    const gesture = tree.root.findByType(GestureDetector).props.gesture;
    expect(gesture.config.enabled).toBe(false);
  });

  test('outside a provider it draws only what it wraps', async () => {
    const tree = await render(
      <Whisper label="Connected.">
        <Text>1</Text>
      </Whisper>,
    );
    expect(tree.root.findAllByType(GestureDetector)).toEqual([]);
    expect(visibleText(tree)).toEqual(['1']);
  });
});
