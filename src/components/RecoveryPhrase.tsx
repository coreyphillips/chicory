import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { haptics } from '../design/haptics';
import { dropOut, riseIn } from '../motion/presets';
import { HoldConfirm } from '../scenes/settings/HoldConfirm';
import { RecoveryWords } from '../scenes/settings/RecoveryWords';
import { Action, Body, Note, Section } from '../scenes/settings/ui';
import { requireUnlock } from '../services/lock';
import { space } from '../theme';

const words = copy.settings.recovery;

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
 *
 * With `onSaved` it is the backup still to be done (REDESIGN.md 6): the
 * section turns honey, and once the words are shown, a 900ms hold confirms
 * they are written down. `index` places it in a page of sections, and
 * `focus` lands a screen reader on its heading as it arrives.
 */
export function RecoveryPhrase({
  initialPhrase,
  loadPhrase,
  onSaved,
  index,
  focus = false,
}: {
  initialPhrase?: string;
  loadPhrase?: () => Promise<string>;
  onSaved?: () => void;
  index?: number;
  focus?: boolean;
}) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Where a screen reader lands once the control it was on goes away: the
  // words land it themselves, hiding them returns it to the reveal, and
  // saving them to the heading.
  const [landing, setLanding] = useState<'reveal' | 'heading' | null>(
    focus ? 'heading' : null,
  );
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
      const allowed = await requireUnlock(words.prompt);
      if (!allowed) {
        haptics.warning();
        setError(words.refused);
        return;
      }
      const value = initialPhrase || (await loadPhrase?.());
      if (!value) {
        throw new Error(words.unavailable);
      }
      setPhrase(value);
      setLanding(null);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : words.unreadable);
    } finally {
      setBusy(false);
    }
  }
  const pending = !!onSaved;
  const shown = phrase ? phrase.trim().split(/\s+/) : [];
  return (
    <Section
      glyph={pending ? 'shieldAlert' : 'key'}
      title={pending ? words.pending : words.heading}
      tone={pending ? 'honey' : 'plain'}
      index={index}
      focus={landing === 'heading'}
    >
      <Body>{words.intro}</Body>
      {error ? <Note tone="error">{error}</Note> : null}
      {phrase ? (
        <Reanimated.View
          entering={riseIn()}
          exiting={dropOut(8)}
          style={styles.stack}
        >
          <RecoveryWords words={shown} />
          <Note tone="warning" glyph="bolt">
            {words.channels}
          </Note>
          {onSaved ? (
            <HoldConfirm
              label={words.saved}
              hint={words.savedHint}
              onCommit={() => {
                setPhrase('');
                setLanding('heading');
                haptics.success();
                announce(words.savedDone);
                onSaved();
              }}
            />
          ) : null}
          <Action
            label={words.hide}
            glyph="eyeOff"
            tone="quiet"
            onPress={() => {
              setPhrase('');
              setLanding('reveal');
            }}
          />
        </Reanimated.View>
      ) : (
        <Action
          label={words.reveal}
          glyph="eye"
          tone={pending ? 'primary' : 'quiet'}
          busy={busy}
          focus={landing === 'reveal'}
          accessibilityHint={busy ? words.revealing : undefined}
          onPress={reveal}
        />
      )}
    </Section>
  );
}

const styles = StyleSheet.create({ stack: { gap: space.md } });
