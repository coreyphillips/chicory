import React from 'react';
import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * A gesture root around Home's own gestures: the pull on the home pane and
 * the whispers on the mark and on a gated action.
 *
 * The app's root already is one, and a root inside another is a plain view on
 * iOS and stands aside for the outer one on Android, so on a device this
 * changes nothing. It is here because a gesture detector refuses to render
 * outside any root, and the canvas and HomeScreen are also drawn on their own,
 * as the suites draw them.
 */
export function GestureRoot({
  style,
  children,
}: PropsWithChildren<{ style: StyleProp<ViewStyle> }>) {
  return (
    <GestureHandlerRootView style={style}>{children}</GestureHandlerRootView>
  );
}
