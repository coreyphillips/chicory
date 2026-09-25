import React from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '../../theme';

// Padding on both platforms. The app draws edge to edge on Android, where the
// window no longer shrinks for the keyboard (adjustResize does nothing), so
// without it the keyboard covered the lower fields: the Send amount sits under
// a long request. Padding only adds what the keyboard actually overlaps, so a
// window that does resize gets none.
const KEYBOARD_AVOIDING = 'padding' as const;

/**
 * A scrolling place for a whole scene, that keeps its fields above the
 * keyboard.
 *
 * `label` names the scene for a screen reader where a title bar used to.
 * `offset` is how far below the top of the safe area the slot's parent
 * starts, for a slot the canvas places lower down.
 */
export function SceneSlot({
  label,
  offset = 0,
  refreshControl,
  children,
}: PropsWithChildren<{
  label?: string;
  offset?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
}>) {
  // The view measures itself against its parent, and the keyboard against the
  // window. Every slot's parent starts below the top inset, and `offset` below
  // that, so together they are the distance between the two.
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.slot}
      behavior={KEYBOARD_AVOIDING}
      keyboardVerticalOffset={insets.top + offset}
      accessibilityLabel={label}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxxl,
    flexGrow: 1,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
});
