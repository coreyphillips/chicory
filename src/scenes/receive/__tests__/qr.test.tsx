import React from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';
import Svg from 'react-native-svg';
import {
  QR_QUIET,
  QrBloom,
  qrGrid,
  qrLayers,
  qrModules,
} from '../../../glyphs/QrBloom';
import { radius } from '../../../theme';
import { mount } from '../../../../test-support/guard';

/**
 * Where a request's modules sit on its card (REDESIGN.md 5, QrBloom). A
 * Pixel showed a dense unified request drawn at half the card: each module
 * was held to a whole point, which a 129 module code only fits once into a
 * 240 point card. The modules now fill the card but for a quiet zone of four
 * modules, with every edge on a whole pixel.
 */

/** A unified request as a regtest wallet makes one, Lightning and all. */
const DENSE = `bitcoin:bcrt1qpg0xyjz3p06mkjy8mju437lezq57ad90yq0hq3?amount=0.0006&lightning=lnbcrt600u1p4td83kpp5vhpaguzscqxf6mds0q3t7ap26s36r5u7956v8k9mad28vp6j2zdqsp559mtde4p9usjks208wlq6x4nzvvqer2za7rdtqfjez7jn86jtxlsdqqnp4q0a4kjcvlvdytpnt89r2a57pvxwsese2ef656q3tepzhzunqglld5xqzjccqzzg9qyysgqrzjqfyj57m00rzh670j67vpvt3ph36ztyvzcj35rq0zr2mkklkwz62e3llll75djz8nevqqqqqqqqqqqqqq2qyj4srmq77hfl9xu03jnchaytmzgmxs35dy99rcuvvvcdehrkv0vh920amqxwxgl6dt46dqdgedvd2nfkeae7r395e20jmgyg3ue7rjqqf82mqj&bgnq=${'A0uB3lRoMUN4Uv5VYmFt3ZwGIm5GERoLWcqvEmBD61u'.repeat(
  12,
)}`;
const SHORT = 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

/** The inline card on a phone, the detail's, and the lifted one. */
const SIDES = [264, 244, 395];
/** A Pixel's density, an iPhone's, and a whole number. */
const RATIOS = [2.625, 3, 2];

/** The quiet zone, in modules of the grid's own average size. */
const quiet = (grid: ReturnType<typeof qrGrid>) => grid.inset / grid.unit;

describe('the grid', () => {
  test('a dense unified request fills its card, with a quiet zone of about four modules', () => {
    const { size } = qrModules(DENSE);
    expect(size).toBeGreaterThan(120);
    for (const side of SIDES) {
      const grid = qrGrid(side, size, 2.625);
      // Before, the modules took half the card.
      expect((size * grid.unit) / side).toBeGreaterThan(0.9);
      expect(quiet(grid)).toBeGreaterThanOrEqual(QR_QUIET);
      expect(quiet(grid)).toBeLessThan(QR_QUIET + 1);
      // Four pixels or more a module: a phone's camera reads it at arm's
      // length.
      expect(grid.unit * grid.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a short request keeps four modules of quiet zone exactly', () => {
    const { size } = qrModules(SHORT);
    for (const side of SIDES) {
      const grid = qrGrid(side, size, 3);
      expect(quiet(grid)).toBeCloseTo(QR_QUIET, 6);
      expect(grid.inset * 2 + size * grid.unit).toBeCloseTo(side, 6);
    }
  });

  test('every module edge is a whole pixel, and no module is a pixel wider than another', () => {
    for (const value of [DENSE, SHORT]) {
      const { size } = qrModules(value);
      for (const side of SIDES) {
        for (const ratio of RATIOS) {
          const { edges, unit } = qrGrid(side, size, ratio);
          expect(edges).toHaveLength(size + 1);
          for (const edge of edges) expect(Number.isInteger(edge)).toBe(true);
          const widths = edges.slice(1).map((edge, k) => edge - edges[k]);
          expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(
            1,
          );
          for (const width of widths)
            expect(Math.abs(width - unit * ratio)).toBeLessThan(1);
          // Centred: the quiet zone is the same either side, to a pixel.
          const far = Math.round(side * ratio) - edges[size];
          expect(Math.abs(far - edges[0])).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test("the card's rounded corner stays a module clear of every finder", () => {
    for (const value of [DENSE, SHORT]) {
      const { size } = qrModules(value);
      for (const side of [174, ...SIDES]) {
        const { inset, unit } = qrGrid(side, size, 3);
        const r = radius.qr;
        // How far inside the arc a finder's outer corner lies, along the
        // diagonal; a corner past the arc's start is clear of it.
        const clearance = inset >= r ? Infinity : r - (r - inset) * Math.SQRT2;
        expect(clearance).toBeGreaterThanOrEqual(unit - 1e-9);
      }
    }
  });
});

describe('the drawing', () => {
  const frames = (value: string, size: number) =>
    mount(
      <QrBloom
        value={value}
        size={size}
        state="shown"
        accessibilityLabel="Payment request QR code"
      />,
    );

  test('each layer sits on the grid and draws in its own pixels', async () => {
    const ratio = PixelRatio.get();
    for (const size of [264, 395]) {
      const tree = await frames(DENSE, size);
      const code = qrModules(DENSE);
      const { edges } = qrGrid(size, code.size, ratio);
      const { bands, finders } = qrLayers(code, edges);
      const drawn = tree.root.findAllByType(Svg).map(svg => ({
        box: StyleSheet.flatten(svg.parent!.props.style),
        viewBox: svg.props.viewBox,
        width: svg.props.width,
      }));
      const span = edges[code.size] - edges[0];
      const whole = {
        left: edges[0] / ratio,
        top: edges[0] / ratio,
        width: span / ratio,
        height: span / ratio,
      };
      // Every band spans the whole code, from the quiet zone's inner edge.
      const full = drawn.filter(
        ({ viewBox }) => viewBox === `0 0 ${span} ${span}`,
      );
      expect(full).toHaveLength(bands.filter(Boolean).length);
      for (const { box, width } of full) {
        expect(box).toMatchObject(whole);
        expect(width).toBe(whole.width);
      }
      // Each finder its own seven modules, where its corner is.
      for (const finder of finders) {
        const side = edges[finder.x + 7] - edges[finder.x];
        const there = drawn.filter(
          ({ box }) =>
            box.left === edges[finder.x] / ratio &&
            box.top === edges[finder.y] / ratio,
        );
        expect(there.map(({ viewBox }) => viewBox)).toContain(
          `0 0 ${side} ${side}`,
        );
      }
      // The code takes nine tenths of the card.
      expect(whole.width / size).toBeGreaterThan(0.9);
      await act(async () => tree.unmount());
    }
  });
});
