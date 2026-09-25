import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
  usePanGesture,
} from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';

/**
 * The animation and gesture stack loads under Jest: a timing drives a style
 * to where it was going, a layout animation mounts, and a gesture detector
 * holds a pan that drives a shared value. Every other suite depends on this
 * holding.
 *
 * The Reanimated mock runs a style's worklet as the component renders and
 * builds a fresh shared value on every render, so a value set after a render
 * reaches no style. The lift is therefore timed inside the style, where the
 * mock lands it on its end at once, and the pan is read from the value it
 * writes.
 */
const LIFT = 24;
let finished: boolean | undefined;
let dragged: SharedValue<number> | undefined;

function Probe({ lifted }: { lifted: boolean }) {
  const drag = useSharedValue(0);
  dragged = drag;
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(lifted ? LIFT : 0, { duration: 200 }, done => {
          finished = done;
        }),
      },
    ],
  }));
  const pan = usePanGesture({
    testID: 'probe-pan',
    onUpdate: event => {
      'worklet';
      drag.set(event.translationY);
    },
  });
  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeIn} style={style} testID="probe">
          <Text>1</Text>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

test('reanimated and gesture handler render under Jest', async () => {
  jest.useFakeTimers();
  let tree: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = create(<Probe lifted={false} />);
    });
    const probe = () =>
      tree!.root.find(
        node => typeof node.type === 'string' && node.props.testID === 'probe',
      );
    const lift = () =>
      StyleSheet.flatten(probe().props.style).transform?.[0] as {
        translateY: number;
      };
    // The view a layout animation brings in mounted, with what it holds.
    expect(probe().findByType(Text).props.children).toBe('1');
    expect(lift()).toEqual({ translateY: 0 });

    finished = undefined;
    await act(async () => tree!.update(<Probe lifted />));
    // The timing lands where it was going at once, and says it finished.
    expect(lift()).toEqual({ translateY: LIFT });
    expect(finished).toBe(true);

    // The detector holds the pan by its tag, and the pan is registered for
    // as long as it is drawn.
    const pan = tree!.root.findByType(GestureDetector).props.gesture;
    const detector = tree!.root.find(
      node =>
        typeof node.type === 'string' && Array.isArray(node.props.handlerTags),
    );
    expect(detector.props.handlerTags).toEqual([pan.handlerTag]);
    expect(getByGestureTestId('probe-pan')).toBe(pan);
    // A drag runs the pan's worklet, which moves the value it drives.
    await act(async () =>
      fireGestureHandler(pan, [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 10 },
        { state: State.ACTIVE, translationY: 40 },
        { state: State.END, translationY: 40 },
      ]),
    );
    expect(dragged!.get()).toBe(40);

    await act(async () => tree!.unmount());
    tree = undefined;
    expect(() => getByGestureTestId('probe-pan')).toThrow();
  } finally {
    if (tree) await act(async () => tree!.unmount());
    jest.useRealTimers();
  }
});
