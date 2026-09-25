import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from 'react-native-gesture-handler';

/**
 * The animation and gesture stack loads under Jest: a shared value drives a
 * style, a layout animation mounts, and a gesture detector renders. Every
 * other suite depends on this holding.
 */
function Probe() {
  const offset = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.get() }],
  }));
  const pan = usePanGesture({
    onUpdate: event => {
      'worklet';
      offset.set(event.translationY);
    },
  });
  React.useEffect(() => {
    offset.set(withTiming(24, { duration: 200 }));
  }, [offset]);
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
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(tree.root.findByProps({ testID: 'probe' })).toBeDefined();
  jest.useRealTimers();
});
