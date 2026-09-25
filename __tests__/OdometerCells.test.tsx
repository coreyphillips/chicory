import React from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  PixelRatio,
  StyleSheet,
} from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import {
  Odometer,
  cellHeight,
  rowFade,
  rowInView,
} from '../src/glyphs/Odometer';
import type { OdometerVariant } from '../src/glyphs/Odometer';
import { type as typography } from '../src/theme';

/**
 * An odometer's cells (REDESIGN.md 5, Odometer). A Pixel showed parts of
 * the digits above and below a rolling one: a cell must be exactly one line
 * of its figures tall, with no font padding in it, and a digit that slides
 * over the cell's edge fades as it goes.
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
beforeEach(() =>
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false),
);
afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  jest.restoreAllMocks();
});

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};
const hosts = (
  tree: ReactTestRenderer,
  where: (node: ReactTestInstance) => boolean,
) => tree.root.findAll(node => typeof node.type === 'string' && where(node));
/** The clipped cells, each a figure's window. */
const cells = (tree: ReactTestRenderer) =>
  hosts(tree, node => flat(node).overflow === 'hidden');
/** The figures drawn in a cell. */
const figures = (cell: ReactTestInstance) =>
  cell.findAll(
    node =>
      typeof node.type === 'string' &&
      typeof node.children[0] === 'string' &&
      /\d/.test(node.children[0] as string),
  );

describe('a cell', () => {
  test('is one line box tall, in whole pixels rounded up as Android sets it', () => {
    for (const ratio of [2, 2.625, 3]) {
      for (const scale of [1, 1.15, 1.4]) {
        for (const line of [72, 26, 22]) {
          const height = cellHeight(line, scale, ratio);
          expect(Number.isInteger(Math.round(height * ratio * 1e6) / 1e6)).toBe(
            true,
          );
          expect(height).toBeGreaterThanOrEqual(line * scale - 1e-9);
          expect(height - line * scale).toBeLessThan(1 / ratio);
        }
      }
    }
    // A line that is already whole pixels stays as it is.
    expect(cellHeight(26, 1, 2)).toBe(26);
  });

  // Each variant's line, and how far its type grows with the system's text
  // size, which Jest sets to twice.
  test.each<[OdometerVariant, number, number]>([
    ['hero', typography.hero.lineHeight, 1.2],
    ['line', typography.line.lineHeight, 1.4],
    ['row', typography.row.lineHeight, 1.4],
  ])(
    '%s: the cell and every figure in it share one height, without font padding',
    async (variant, line, cap) => {
      const tree = await render(
        <Odometer sats={1_200} unit="sats" variant={variant} />,
      );
      // Rolling, so the columns are drawn.
      act(() =>
        tree.update(<Odometer sats={1_450} unit="sats" variant={variant} />),
      );
      const { fontScale } = Dimensions.get('window');
      const height = cellHeight(
        line,
        Math.min(fontScale, cap),
        PixelRatio.get(),
      );
      const drawn = cells(tree);
      expect(drawn.length).toBeGreaterThan(0);
      for (const cell of drawn) {
        expect(flat(cell).height).toBe(height);
        for (const figure of figures(cell)) {
          expect(flat(figure)).toMatchObject({
            height,
            includeFontPadding: false,
            textAlignVertical: 'center',
          });
        }
      }
      await act(async () => {});
      // At rest each cell is one digit, set the same way.
      for (const cell of cells(tree)) {
        const [digit] = figures(cell);
        if (!digit) continue;
        expect(flat(digit)).toMatchObject({
          height,
          includeFontPadding: false,
        });
      }
    },
  );

  test('rolls as two layers, the even rows in its flow and the odd rows over them', async () => {
    const tree = await render(
      <Odometer sats={1_200} unit="sats" variant="line" />,
    );
    act(() =>
      tree.update(<Odometer sats={1_450} unit="sats" variant="line" />),
    );
    const cell = cells(tree)[0];
    const rows = (layer: ReactTestInstance) =>
      figures(layer).map(node => node.children[0]);
    // The views that roll: each moves by translateY alone.
    const layers = cell.findAll(
      node =>
        typeof node.type === 'string' &&
        (flat(node).transform ?? []).some(
          (step: object) => 'translateY' in step,
        ),
    );
    expect(layers).toHaveLength(2);
    const [even, odd] = layers;
    expect(rows(even)).toEqual(['0', '2', '4', '6', '8', '0']);
    expect(rows(odd)).toEqual(['1', '3', '5', '7', '9']);
    expect(flat(even).position).toBeUndefined();
    expect(flat(odd)).toMatchObject({ position: 'absolute', top: 0 });
    await act(async () => {});
  });
});

describe('a rolling digit', () => {
  test('shows whole at its place, fades over the edge and is gone a row out', () => {
    expect(rowFade(3, 3)).toBe(1);
    expect(rowFade(3, 3.5)).toBeCloseTo(0.5);
    expect(rowFade(4, 3.5)).toBeCloseTo(0.5);
    expect(rowFade(3, 4)).toBe(0);
    expect(rowFade(3, 5.5)).toBe(0);
    // Faster near the edge than in the middle, so a digit that is nearly
    // home reads as home.
    expect(rowFade(3, 3.1)).toBeGreaterThan(0.95);
    expect(rowFade(3, 3.9)).toBeLessThan(0.05);
  });

  test('crossfades with the next: the two rows in view always add to one', () => {
    for (let pos = 0; pos <= 10; pos += 0.037) {
      const shown = [0, 1].map(parity => rowFade(rowInView(pos, parity), pos));
      expect(shown[0] + shown[1]).toBeCloseTo(1, 9);
    }
  });

  test('each layer names its one row in view, the one above or the one below', () => {
    for (let pos = 0; pos < 10; pos += 0.043) {
      const top = Math.floor(pos);
      const rows = [rowInView(pos, 0), rowInView(pos, 1)].sort((a, b) => a - b);
      expect(rows).toEqual([top, top + 1]);
      expect(rowInView(pos, 0) % 2).toBe(0);
      expect(rowInView(pos, 1) % 2).toBe(1);
    }
    // The trailing 0 below the 9 is an even row.
    expect(rowInView(9.5, 0)).toBe(10);
  });

  test('a scramble lands on whole rows, so each jump shows one digit whole', () => {
    for (let digit = 0; digit < 10; digit++) {
      const shown = [0, 1].map(parity =>
        rowFade(rowInView(digit, parity), digit),
      );
      expect(shown.sort()).toEqual([0, 1]);
    }
  });
});
