/**
 * Development-only entry: every visual state the app draws, one after
 * another, on the real UI thread. Build with
 * ENTRY_FILE=native-tests/Gallery.tsx; see the README.
 *
 * Under Jest, worklets run on the JS thread through Reanimated's mock, so a
 * worklet that reads a value the UI thread never received only fails on a
 * device. This walks every glyph in every mode, tone, variant and event,
 * then every surface of the wallet but the scanner, which would ask for
 * the camera. It runs over fake data and a wallet that answers at once,
 * holds each state for DWELL_MS once reached, and never opens a vault,
 * starts the engine or reaches the secure store or the clipboard
 * (gallery/sealed.ts). A state reached by steps takes as long as the phone
 * does: each step waits for its control before it acts (gallery/drive.ts).
 *
 * The number in the corner is the state's index. Each state is logged as it
 * comes up, as `GALLERY <index> <name>`, so the last line before a crash
 * names the state that caused it. After the last it logs GALLERY COMPLETE
 * and starts again.
 */
import 'react-native-url-polyfill/auto';
// First, so nothing drawn after it can reach the real store.
import { setBiometry } from './gallery/sealed';
import React, { useEffect, useRef, useState } from 'react';
import { AppRegistry, StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components/Toast';
import { wakeAmbient } from '../src/motion/ambient';
import { clearHeldRequests } from '../src/stage/heldRequests';
import { colors } from '../src/theme';
import { Probe, perform, report } from './gallery/drive';
import { GLYPHS } from './gallery/glyphs';
import { PAYMENTS } from './gallery/payments';
import { SCENES } from './gallery/scenes';
import type { Take } from './gallery/shots';

/** How long a state holds once its steps have brought it about. */
export const DWELL_MS = 1200;

export const SHOTS = [...GLYPHS, ...SCENES, ...PAYMENTS];

export function Gallery() {
  const [cursor, setCursor] = useState({ index: 0, lap: 0 });
  const [drawn, setDrawn] = useState<{
    take: Take;
    name: string;
    key: number;
  } | null>(null);
  const probe = useRef<Probe>(null);

  useEffect(() => {
    const { index, lap } = cursor;
    const shot = SHOTS[index];
    report(`${index} ${shot.name}`);
    // Each state starts from nothing held and a phone with no biometry,
    // whatever the state before it set up. It also wakes decoration, as the
    // stage does for a new scene (REDESIGN.md 3.5): nothing touches the
    // gallery, and its loops would otherwise rest a few states in.
    clearHeldRequests();
    setBiometry(null);
    wakeAmbient();
    const take = shot.make();
    setDrawn(last => ({ take, name: shot.name, key: (last?.key ?? 0) + 1 }));
    return perform(probe, shot.name, take.steps ?? [], DWELL_MS, () => {
      const last = index === SHOTS.length - 1;
      if (last) console.log('GALLERY COMPLETE');
      setCursor({ index: last ? 0 : index + 1, lap: last ? lap + 1 : lap });
    });
  }, [cursor]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ToastProvider>
          {drawn ? (
            <Probe key={drawn.key} ref={probe} name={drawn.name}>
              {drawn.take.view}
            </Probe>
          ) : null}
          <Text style={styles.index} pointerEvents="none">
            {cursor.index}
          </Text>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  index: {
    position: 'absolute',
    left: 6,
    bottom: 2,
    fontSize: 9,
    color: colors.text,
    opacity: 0.5,
  },
});

AppRegistry.registerComponent('chicory', () => Gallery);
