import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  Modal,
  Platform,
  StyleSheet,
} from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { mount } from '../../../test-support/guard';
import { find, press, visibleText } from '../../../test-support/query';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { WHISPER_DELAY } from '../../glyphs/Whisper';
import { durations } from '../../motion/tokens';
import { TARGET } from '../../scenes/receive/controls';
import { Pane } from '../../stage/panes/Pane';
import { RequestCopyControl } from '../RequestCopyControl';

const touch = { nativeEvent: { pageX: 140, pageY: 320 } };
const props = {
  copyScope: 'first',
  formats: ['lightning', 'bitcoin'] as const,
  copies: 0,
  onCopy: jest.fn(),
};
const copyLabel = copy.receive.copy;
const longPress = (tree: ReactTestRenderer, label = copyLabel) =>
  act(async () => find(tree, label)!.props.onLongPress(touch));

beforeEach(() => {
  jest.useFakeTimers();
  props.onCopy.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a tap copies the complete request, and named actions copy each format directly', async () => {
  const tick = jest.spyOn(haptics, 'tick');
  const tree = await mount(<RequestCopyControl {...props} />);
  const trigger = find(tree, copyLabel)!;
  expect(trigger.props.accessibilityActions).toEqual([
    { name: 'lightning', label: copy.receive.copyLightning },
    { name: 'bitcoin', label: copy.receive.copyBitcoin },
  ]);
  await press(tree, copyLabel);
  await act(async () => {
    for (const actionName of ['lightning', 'bitcoin', 'unavailable']) {
      trigger.props.onAccessibilityAction({ nativeEvent: { actionName } });
    }
  });
  expect(props.onCopy.mock.calls).toEqual([
    ['request'],
    ['lightning'],
    ['bitcoin'],
  ]);
  // The write handler supplies feedback once it has checked the request.
  expect(tick).not.toHaveBeenCalled();
  expect(find(tree, copy.receive.copyLightning)).toBeUndefined();
  await act(async () => tree.unmount());
});

test('holding the trigger opens two finger-sized glyphs, and holding a glyph only whispers its name', async () => {
  const tree = await mount(<RequestCopyControl {...props} />);
  const trigger = find(tree, copyLabel)!;
  expect(trigger.props.delayLongPress).toBe(WHISPER_DELAY);
  await longPress(tree);
  await act(async () => trigger.props.onPress());
  expect(props.onCopy).not.toHaveBeenCalled();
  for (const label of [copy.receive.copyLightning, copy.receive.copyBitcoin]) {
    const option = find(tree, label)!;
    expect(
      StyleSheet.flatten(option.props.style({ pressed: false })),
    ).toMatchObject({
      width: TARGET,
      height: TARGET,
    });
  }
  expect(visibleText(tree)).not.toContain(copy.receive.copyBitcoin);
  await longPress(tree, copy.receive.copyBitcoin);
  expect(visibleText(tree)).toContain(copy.receive.copyBitcoin);
  expect(props.onCopy).not.toHaveBeenCalled();
  const select = find(tree, copy.receive.copyBitcoin)!.props.onPress;
  await act(async () => {
    select();
    select();
  });
  expect(props.onCopy.mock.calls).toEqual([['bitcoin']]);
  expect(find(tree, copy.receive.copyBitcoin)).toBeUndefined();
  await act(async () => tree.unmount());
});

test.each(['outside', 'named close', 'back', 'accessibility escape'])(
  '%s dismisses without copying and restores focus to the trigger',
  async way => {
    const tree = await mount(<RequestCopyControl {...props} />);
    const focus = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
    await longPress(tree);
    const modal = tree.root.findByType(Modal);
    await act(async () => modal.props.onShow());
    await act(async () => jest.advanceTimersByTime(500));
    expect(focus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          accessibilityLabel: copy.receive.copyLightning,
        }),
      }),
      'focus',
    );
    if (way === 'outside') {
      const [backdrop] = modal.findAll(
        node =>
          node.props.accessible === false &&
          typeof node.props.onPress === 'function',
      );
      expect(backdrop.props.importantForAccessibility).toBe(
        'no-hide-descendants',
      );
      await act(async () => backdrop.props.onPress());
    } else if (way === 'named close') {
      for (const label of [
        copy.receive.copyLightning,
        copy.receive.copyBitcoin,
      ]) {
        expect(find(tree, label)!.props.accessibilityActions).toEqual([
          { name: 'dismiss', label: copy.receive.closeCopyChoices },
        ]);
      }
      await act(async () =>
        find(tree, copy.receive.copyBitcoin)!.props.onAccessibilityAction({
          nativeEvent: { actionName: 'dismiss' },
        }),
      );
    } else if (way === 'back') {
      await act(async () => modal.props.onRequestClose());
    } else {
      const [group] = tree.root.findAll(
        node => node.props.accessibilityViewIsModal,
      );
      await act(async () => group.props.onAccessibilityEscape());
    }
    expect(find(tree, copy.receive.copyLightning)).toBeUndefined();
    await act(async () => jest.advanceTimersByTime(durations.exit + 1));
    expect(modal.props.visible).toBe(false);
    focus.mockClear();
    await act(async () => modal.props.onDismiss());
    await act(async () => jest.advanceTimersByTime(500));
    expect(focus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ accessibilityLabel: copyLabel }),
      }),
      'focus',
    );
    expect(props.onCopy).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  },
);

test('VoiceOver can activate a focused format and then the returning Copy button', async () => {
  const tree = await mount(<RequestCopyControl {...props} />);
  await longPress(tree);
  await act(async () =>
    find(tree, copy.receive.copyLightning)!.props.onAccessibilityTap(),
  );
  await act(async () => jest.advanceTimersByTime(durations.exit + 1));
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  await act(async () => find(tree, copyLabel)!.props.onAccessibilityTap());
  expect(props.onCopy.mock.calls).toEqual([['lightning'], ['request']]);
  await act(async () => tree.unmount());
});

test('the open chooser cannot survive a change of request or pane', async () => {
  const control = (scope: string, active: boolean) => (
    <Pane active={active}>
      <RequestCopyControl {...props} copyScope={scope} />
    </Pane>
  );
  const tree = await mount(control('first', true));
  await longPress(tree);
  const stale = find(tree, copy.receive.copyLightning)!.props.onPress;
  await act(async () => tree.update(control('second', true)));
  expect(find(tree, copy.receive.copyLightning)).toBeUndefined();
  await act(async () => stale());
  await longPress(tree);
  await act(async () => tree.update(control('second', false)));
  expect(find(tree, copy.receive.copyBitcoin)).toBeUndefined();
  expect(props.onCopy).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('returning from the background cannot reopen an old chooser', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener').mockClear();
  const tree = await mount(<RequestCopyControl {...props} />);
  await longPress(tree);
  const stale = find(tree, copy.receive.copyBitcoin)!.props.onPress;
  const change = (state: 'background' | 'active') =>
    act(async () => {
      for (const [event, listener] of listeners.mock.calls) {
        if (event === 'change') listener(state);
      }
    });
  await change('background');
  expect(find(tree, copy.receive.copyBitcoin)).toBeUndefined();
  await change('active');
  await act(async () => stale());
  expect(props.onCopy).not.toHaveBeenCalled();
  expect(find(tree, copy.receive.copyBitcoin)).toBeUndefined();
  await act(async () => tree.unmount());
});

test('a dialog dismissed by Android on Escape can reopen on the next hold', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const events = jest.spyOn(AppState, 'addEventListener');
  const tree = await mount(<RequestCopyControl {...props} />);
  await longPress(tree);
  const focus = events.mock.calls.find(([event]) => event === 'focus')![1];
  await act(async () => {
    focus('active');
    jest.advanceTimersByTime(durations.exit + 1);
  });
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  await longPress(tree);
  expect(find(tree, copy.receive.copyBitcoin)).toBeDefined();
  expect(props.onCopy).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('the ordinary copy button has no hold or custom actions without alternative formats', async () => {
  const tree = await mount(<RequestCopyControl {...props} formats={[]} />);
  const trigger = find(tree, copyLabel)!;
  expect(trigger.props.onLongPress).toBeUndefined();
  expect(trigger.props.accessibilityActions).toBeUndefined();
  expect(trigger.props.accessibilityHint).toBeUndefined();
  await press(tree, copyLabel);
  expect(props.onCopy.mock.calls).toEqual([['request']]);
  await act(async () => tree.unmount());
});
