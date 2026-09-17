import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, Eyebrow, Notice } from './ui';
import { colors, radius, space, type } from '../theme';
import { requireUnlock } from '../services/lock';

/**
 * The recovery phrase, shown only when deliberately asked for.
 *
 * Three protections, in order of how much they actually buy:
 *  - When the app lock is on, revealing requires the device biometric or
 *    passcode. That is the one that matters if the phone is unlocked and in
 *    someone else's hands.
 *  - The words are cleared the moment the app stops being active, so they are
 *    not in the app switcher.
 *  - They are never copied to the clipboard and never written to app state
 *    that outlives the screen.
 *
 * Screenshot blocking is deliberately not claimed: neither platform offers it
 * through React Native core, and a partial version would be worse than none.
 */
export function RecoveryPhrase({
  initialPhrase,
  loadPhrase,
  onSaved,
}: {
  initialPhrase?: string;
  loadPhrase?: () => Promise<string>;
  onSaved?: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        setPhrase('');
      }
    });
    return () => subscription.remove();
  }, []);
  async function reveal() {
    setBusy(true);
    setError('');
    try {
      const allowed = await requireUnlock(
        'Confirm to reveal your recovery phrase',
      );
      if (!allowed) {
        setError('The recovery phrase stays hidden until this is confirmed.');
        return;
      }
      const value = initialPhrase || (await loadPhrase?.());
      if (!value) {
        throw new Error(
          'Recovery phrase is unavailable. Open your host dashboard to check backups.',
        );
      }
      setPhrase(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the phrase.');
    } finally {
      setBusy(false);
    }
  }
  const words = phrase ? phrase.trim().split(/\s+/) : [];
  return (
    <Card>
      <Eyebrow>Recovery phrase</Eyebrow>
      <Body>
        Write these words down in order and keep them somewhere private. Anyone
        with the phrase can take your funds.
      </Body>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      {phrase ? (
        <>
          <Notice kind="warning" icon="eye">
            Make sure nobody is looking over your shoulder or recording your
            screen.
          </Notice>
          <View style={styles.words}>
            {words.map((word, index) => (
              <View key={index} style={styles.word}>
                <Text style={styles.wordNumber}>{index + 1}</Text>
                <Text style={styles.wordText}>{word}</Text>
              </View>
            ))}
          </View>
          <Body>
            Keep your wallet’s current channel state too. The recovery phrase
            alone does not restore active Lightning channels.
          </Body>
          <Button label="Hide phrase" secondary onPress={() => setPhrase('')} />
          {onSaved ? (
            <Button
              label="I saved my recovery phrase"
              icon="check"
              onPress={() => {
                setPhrase('');
                onSaved();
              }}
            />
          ) : null}
        </>
      ) : (
        <Button
          label="Reveal recovery phrase"
          icon="key"
          secondary
          onPress={reveal}
          busy={busy}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  word: {
    width: '47%',
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.raised,
    flexDirection: 'row',
    gap: space.xs,
    alignItems: 'baseline',
  },
  wordNumber: {
    ...type.micro,
    fontSize: 11,
    color: colors.faint,
    minWidth: 16,
    fontVariant: ['tabular-nums'],
  },
  wordText: { ...type.caption, fontSize: 14, color: colors.text, fontWeight: '600' },
});
