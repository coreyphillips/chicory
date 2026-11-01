/**
 * Development-only entry: the moments of Send and Receive that move, played
 * once each in real time with a blank slate between them, for a screen
 * recording of the phone. Build with ENTRY_FILE=native-tests/Reel.tsx, as
 * the gallery is built (README, State gallery), and record each shot
 * between its markers (scripts/reel-record.sh).
 *
 * It runs over the gallery's fake wallet, which here answers late where a
 * real one would: a payment lands after the hold's burst, and a request is
 * paid on a later poll. Each shot holds for as long as its motion takes
 * (`hold`) rather than the gallery's dwell. Every line it writes starts
 * with REEL: `REEL <index> <name>` as a shot's slate starts, `REEL DONE
 * <index>` as its hold ends, and REEL COMPLETE after the last, where it
 * stays blank rather than starting again.
 */
import 'react-native-url-polyfill/auto';
// First, so nothing drawn after it can reach the real store.
import { forgetFace, setBiometry } from './gallery/sealed';
import React, { useEffect, useRef, useState } from 'react';
import { AppRegistry, StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components/Toast';
import { wakeAmbient } from '../src/motion/ambient';
import { clearHeldRequests } from '../src/stage/heldRequests';
import { colors } from '../src/theme';
import { Probe, perform } from './gallery/drive';
import type { Take } from './gallery/shots';
import { REEL } from './reel/shots';

/**
 * The blank between shots: a recording started as the slate begins has the
 * whole of the shot that follows, however long the recorder takes to start.
 */
export const SLATE_MS = 1500;

/** How long a shot holds where it says nothing itself. */
export const HOLD_MS = 6000;

/** A line of the reel's own, which a recorder reads from the device log. */
export function mark(line: string) {
  console.log(`REEL ${line}`);
}

type Cursor = { index: number; slate: boolean } | 'complete';

export function Reel() {
  const [cursor, setCursor] = useState<Cursor>({ index: 0, slate: true });
  const [drawn, setDrawn] = useState<{
    take: Take;
    name: string;
    key: number;
  } | null>(null);
  const probe = useRef<Probe>(null);

  useEffect(() => {
    if (cursor === 'complete') return;
    const { index, slate } = cursor;
    const shot = REEL[index];
    if (slate) {
      mark(`${index} ${shot.name}`);
      setDrawn(null);
      const timer = setTimeout(
        () => setCursor({ index, slate: false }),
        SLATE_MS,
      );
      return () => clearTimeout(timer);
    }
    // Each shot starts from nothing held, the balance on its first face and
    // a phone with no biometry, with decoration awake, as the gallery does.
    clearHeldRequests();
    forgetFace();
    setBiometry(null);
    wakeAmbient();
    const take = shot.make();
    setDrawn(last => ({ take, name: shot.name, key: (last?.key ?? 0) + 1 }));
    const hold = shot.hold ?? HOLD_MS;
    return perform(probe, shot.name, take.steps ?? [], hold, () => {
      mark(`DONE ${index}`);
      if (index === REEL.length - 1) {
        mark('COMPLETE');
        setDrawn(null);
        setCursor('complete');
      } else {
        setCursor({ index: index + 1, slate: true });
      }
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
            {cursor === 'complete' ? '' : cursor.index}
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

AppRegistry.registerComponent('chicory', () => Reel);
