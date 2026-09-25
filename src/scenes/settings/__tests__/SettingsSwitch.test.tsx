import React from 'react';
import { AppState, StyleSheet, Switch } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { palette } from '../../../design/palette';
import { mount } from '../../../../test-support/guard';
import { Toggle, thumbTint } from '../ui';

/**
 * A Settings switch on the phone (the P7 device pass): it sits level with its
 * label, and its thumb stays cream (REDESIGN.md 3.1), which iOS 26 forgets.
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
