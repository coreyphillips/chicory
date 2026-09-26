import React from 'react';
import { AppState, StyleSheet, Switch } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { palette } from '../../../design/palette';
import { mount } from '../../../../test-support/guard';
import { RETINT_AFTER_MS, Toggle, thumbTint } from '../ui';

/**
 * A Settings switch on the phone (the P7 and P10 device passes): it sits
 * level with its label, and its thumb stays cream (REDESIGN.md 3.1), which
 * iOS 26 forgets for a colour sent before the switch is drawn.
 *
 * Jest lays nothing out, so the alignment is held here as the styles that
 * make it, and the reasons are in the component.
 */

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

const unmount = (tree: ReactTestRenderer) => act(async () => tree.unmount());

describe('a switch', () => {
  const toggle = () =>
    mount(
      <Toggle
        label="Haptics"
        accessibilityLabel="Haptics"
        value
        onValueChange={jest.fn()}
      />,
    );

  test('sits level with its label, over the top-aligned iOS default', async () => {
    const tree = await toggle();
    const control = tree.root.findByType(Switch);
    // React Native gives an iOS switch `alignSelf: 'flex-start'` under
    // whatever style it is given, so only a style of its own centres it.
    expect(flat(control).alignSelf).toBe('center');
    const box = control.parent!;
    expect(flat(box)).toMatchObject({ justifyContent: 'center' });
    expect(flat(box).minHeight).toBeGreaterThanOrEqual(48);
    let row = box.parent!;
    while (flat(row).flexDirection !== 'row') row = row.parent!;
    expect(flat(row).alignItems).toBe('center');
    await unmount(tree);
  });

  test('is told its cream thumb again each time the app comes to the front', async () => {
    const before = jest.mocked(AppState.addEventListener).mock.calls.length;
    const tree = await toggle();
    const thumb = () => tree.root.findByType(Switch).props.thumbColor;
    const shown = thumb();
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.slice(before)
      .filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    expect(listeners.length).toBeGreaterThan(0);
    await act(async () => listeners.forEach(listener => listener('active')));
    expect(thumb()).not.toBe(shown);
    await act(async () => listeners.forEach(listener => listener('active')));
    expect(thumb()).toBe(shown);
    await unmount(tree);
  });

  test('is cream from its first render', async () => {
    const tree = await toggle();
    expect(tree.root.findByType(Switch).props.thumbColor).toBe(palette.cream);
    await unmount(tree);
  });

  test('is told its thumb again once it is laid out, on the next frame and after Settings has slid in', async () => {
    jest.useFakeTimers();
    try {
      const tree = await toggle();
      const thumb = () => tree.root.findByType(Switch).props.thumbColor;
      const box = tree.root.findByType(Switch).parent!;
      const seen = [thumb()];
      // Nothing is sent again before the switch is laid out: a colour sent
      // then is the one iOS 26 drops.
      await act(async () => jest.advanceTimersByTime(2000));
      expect(thumb()).toBe(seen[0]);
      const laidOut = {
        nativeEvent: { layout: { x: 0, y: 0, width: 51, height: 31 } },
      };
      await act(async () => box.props.onLayout(laidOut));
      seen.push(thumb());
      await act(async () => jest.advanceTimersByTime(1));
      seen.push(thumb());
      let at = 1;
      for (const ms of RETINT_AFTER_MS) {
        await act(async () => jest.advanceTimersByTime(ms - at));
        at = ms;
        seen.push(thumb());
      }
      // Each is a change, so React Native sends each to the switch.
      for (let index = 1; index < seen.length; index += 1) {
        expect(seen[index]).not.toBe(seen[index - 1]);
      }
      // Its first render, its layout, the next frame, then each settle.
      expect(seen).toHaveLength(3 + RETINT_AFTER_MS.length);
      // A later layout, as the section around it grows, starts no more.
      const last = thumb();
      await act(async () => box.props.onLayout(laidOut));
      await act(async () => jest.advanceTimersByTime(2000));
      expect(thumb()).toBe(last);
      await unmount(tree);
    } finally {
      jest.useRealTimers();
    }
  });

  test('its thumb is cream on every showing, to the eye', () => {
    const channels = (hex: string) =>
      [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
    const cream = channels(palette.cream);
    for (const epoch of [0, 1, 2, 3]) {
      const tint = thumbTint(epoch);
      channels(tint).forEach((value, index) =>
        expect(Math.abs(value - cream[index])).toBeLessThanOrEqual(1),
      );
      expect(thumbTint(epoch + 1)).not.toBe(tint);
    }
  });
});
