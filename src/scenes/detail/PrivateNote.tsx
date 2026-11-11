import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HostInstance } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { Glyph } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { riseIn } from '../../motion/presets';
import { useSceneBack } from '../../stage/StageContext';
import { usePaneActive } from '../../stage/panes/Pane';
import { radius, space, type as typography } from '../../theme';
import { ErrorPip, GlyphButton, TARGET } from '../receive/controls';
import { useFocusOn } from '../receive/focus';

export function PrivateNote({
  note,
  memo,
  save,
  test,
}: {
  note: string;
  memo: (withGlyph: boolean) => ReactNode;
  test: boolean;
  save: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const editing = draft !== null;
  const live = usePaneActive();
  const mounted = useRef(false);
  const session = useRef<symbol | null>(null);
  const edit = session.current;
  useLayoutEffect(() => {
    mounted.current = live;
    return () => {
      session.current = null;
      mounted.current = false;
    };
  }, [live]);
  const pencil = useRef<HostInstance>(null);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusOn(editing ? field : pencil, editing ? 'editing' : 'reading');

  function close() {
    session.current = null;
    Keyboard.dismiss();
    setDraft(null);
    setFailed(false);
  }
  useSceneBack(() => {
    close();
    return true;
  }, editing && live);
  function commit() {
    if (!mounted.current || draft === null || session.current !== edit) return;
    try {
      save(draft);
      close();
      announce(draft.trim() ? copy.detail.noteSaved : copy.detail.noteRemoved);
    } catch {
      setFailed(true);
      haptics.error();
      announce(copy.detail.noteFailed, { assertive: true });
    }
  }
  return (
    <View onAccessibilityEscape={editing ? close : undefined}>
      {(editing || !!note) && memo(true)}
      {editing ? (
        <Reanimated.View entering={riseIn(4)} style={styles.editor}>
          <TextInput
            ref={field}
            autoFocus
            multiline
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            accessibilityLabel={copy.detail.privateNote}
            maxFontSizeMultiplier={1.4}
            value={draft}
            onChangeText={text => {
              if (session.current === edit) setDraft(text);
            }}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === 'Escape') close();
            }}
            selectionColor={test ? palette.slate : palette.bloom}
            style={styles.input}
          />
          <View style={styles.actions}>
            {failed && <ErrorPip message={copy.detail.noteFailed} />}
            <GlyphButton
              size={TARGET}
              tone="bare"
              glyph="close"
              label={copy.detail.cancelNote}
              onPress={close}
            />
            <GlyphButton
              size={TARGET}
              tone="raised"
              glyph="check"
              label={copy.detail.saveNote}
              onPress={commit}
            />
          </View>
        </Reanimated.View>
      ) : (
        <View style={styles.row}>
          {note ? (
            <View
              accessible
              accessibilityLabel={copy.detail.privateValue(note)}
              style={[styles.row, styles.fill]}
            >
              <Glyph name="lock" size={20} color={palette.dust} />
              <Text maxFontSizeMultiplier={1.4} style={styles.note}>
                {note}
              </Text>
            </View>
          ) : null}
          <View style={!note && styles.leadingPencil}>
            <GlyphButton
              focusRef={pencil}
              align={note ? 'center' : 'start'}
              size={TARGET}
              tone="bare"
              glyph="pencil"
              label={note ? copy.detail.editNote : copy.detail.addNote}
              onPress={() => {
                session.current = Symbol();
                setDraft(note);
              }}
            />
          </View>
          {!note && <View style={styles.fill}>{memo(false)}</View>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Reserve one detail glyph column. The full button stays above the
  // beginning of the noninteractive memo and inside the row's bounds.
  leadingPencil: { marginEnd: 20 - TARGET, zIndex: 1 },
  fill: { flex: 1 },
  note: { ...typography.row, flex: 1, color: palette.steam },
  editor: { gap: space.xs },
  input: {
    ...typography.row,
    color: palette.cream,
    backgroundColor: palette.mocha,
    borderRadius: radius.md,
    padding: space.sm,
    minHeight: TARGET,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.xs,
  },
});
