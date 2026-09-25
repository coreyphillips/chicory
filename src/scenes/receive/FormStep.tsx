import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { AmountField } from '../../components/AmountField';
import { copy } from '../../design/copy';
import { palette } from '../../design/palette';
import { riseIn, sceneOut, stagger } from '../../motion/presets';
import { usePaneActive } from '../../stage/panes/Pane';
import { radius, space, type as typography } from '../../theme';
import { AmountCue, AmountFace } from './AmountCue';
import { ErrorPip, GlyphButton } from './controls';
import type { Focus } from './focus';
import type { AmountCue as Cue } from './model';
import { PRESETS } from './model';
import { OfflineSwitch } from './OfflineSwitch';

/** The longest note a request carries. */
const NOTE_MAX = 180;

/**
 * The amount to ask for (REDESIGN.md 6, Receive): the amount with its cue
 * over it and the preset chips, the pencil that opens a note, the moon that
 * makes the request payable offline when that is offered, and the control
 * that asks for a quote. No words: the cue, the switch and the controls
 * carry them for a screen reader.
 *
 * The amount shows an infinity while it is empty and the sender may choose,
 * and a dust 0 with a caret while one is needed. It turns radish past an
 * offline receive's cap and dust under its floor, and shakes when an amount
 * turns out to be needed after all, as the infinity gives way to the 0.
 */
export function FormStep({
  amount,
  onAmount,
  cue,
  cap,
  amountMessage,
  note,
  onNote,
  noteOpen,
  onNoteOpen,
  offlineOffered,
  offline,
  offlineRefused,
  onOffline,
  busy,
  stale,
  ready,
  error,
  shake,
  onContinue,
  onBlocked,
  focus,
}: {
  amount: string;
  onAmount: (next: string) => void;
  cue: Cue;
  cap?: number;
  /** What the engine said when it asked for an amount. */
  amountMessage: string;
  note: string;
  onNote: (next: string) => void;
  noteOpen: boolean;
  onNoteOpen: (open: boolean) => void;
  offlineOffered: boolean;
  offline: boolean;
  /** Counts the engine's refusals of an offline receive: each shakes the moon. */
  offlineRefused: number;
  onOffline: (next: boolean) => void;
  busy: boolean;
  stale: boolean;
  /** The amount is one that can be quoted. */
  ready: boolean;
  error: string;
  shake: number;
  onContinue: () => void;
  onBlocked: () => void;
  focus: Focus;
}) {
  const live = usePaneActive();
  const showNote = noteOpen || note !== '';
  // Each time an amount turns out to be needed, the amount shakes once.
  const needed = cue.kind === 'required';
  const [asked, setAsked] = useState({ needed, times: 0 });
  if (asked.needed !== needed) {
    setAsked({ needed, times: asked.times + (needed ? 1 : 0) });
  }
  return (
    <View style={styles.form}>
      <AmountCue cue={cue} cap={cap} message={amountMessage || undefined} />
      <AmountField
        value={amount}
        onChangeText={onAmount}
        presets={PRESETS}
        busy={busy}
        hint={cue.kind === 'any' && cue.empty ? copy.amount.any : undefined}
        empty={<AmountFace cue={cue} />}
        tone={cue.over ? 'radish' : cue.under ? 'dust' : undefined}
        shake={asked.times}
      />
      <Reanimated.View entering={stagger(2)} style={styles.options}>
        <GlyphButton
          glyph="pencil"
          label={copy.receive.addNote}
          size={48}
          expanded={showNote}
          disabled={busy}
          onPress={() => onNoteOpen(!noteOpen)}
        />
        {offlineOffered ? (
          <OfflineSwitch
            on={offline}
            cap={cap}
            disabled={busy}
            shake={offlineRefused}
            onToggle={onOffline}
          />
        ) : null}
      </Reanimated.View>
      {showNote ? (
        <Reanimated.View entering={riseIn(8)} exiting={sceneOut()}>
          <TextInput
            accessibilityLabel={copy.receive.note}
            accessibilityHint={copy.receive.noteHint}
            value={note}
            onChangeText={live ? onNote : undefined}
            editable={!busy}
            maxLength={NOTE_MAX}
            autoFocus={noteOpen && note === ''}
            autoCorrect={false}
            returnKeyType="done"
            selectionColor={palette.bloom}
            style={styles.note}
          />
        </Reanimated.View>
      ) : null}
      <Reanimated.View entering={stagger(3)} style={styles.go}>
        <GlyphButton
          glyph="receive"
          label={copy.receive.continue}
          hint={stale ? copy.receive.stale : undefined}
          size={72}
          tone="primary"
          disabled={!stale && !ready}
          blocked={stale}
          busy={busy}
          shake={shake}
          onPress={onContinue}
          onBlocked={onBlocked}
          focusRef={focus}
        />
        {error ? <ErrorPip message={error} /> : null}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  options: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
  },
  note: {
    ...typography.row,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: palette.mocha,
    color: palette.cream,
  },
  go: {
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
});
