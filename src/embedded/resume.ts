import { AppState } from 'react-native';

/**
 * How long the app can stay in the background before the connections it left
 * open are taken to be dead. The phone suspends an app in the background, and
 * Android 14 on freezes one, and its sockets can go silent without a close
 * event: writes still seem to go out and nothing comes back, so the engine
 * keeps counting a primary as connected that no longer answers. Past this the
 * transports start again rather than wait for something to notice.
 */
export const LONG_BACKGROUND_MS = 30000;

/**
 * Call `listener` with how long the app was away each time it comes back to
 * the front after at least LONG_BACKGROUND_MS in the background. The time
 * away starts at the first move to the background and ends at the next move
 * to the front; a pass through 'inactive' on the way does not count as away.
 * Returns the AppState subscription, to remove when the caller closes.
 */
export function onLongResume(listener: (awayMs: number) => void) {
  let since: number | null =
    AppState.currentState === 'background' ? Date.now() : null;
  return AppState.addEventListener('change', state => {
    if (state === 'background' && since === null) since = Date.now();
    if (state !== 'active' || since === null) return;
    const away = Date.now() - since;
    since = null;
    if (away >= LONG_BACKGROUND_MS) listener(away);
  });
}
