import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';

/**
 * `bitcoin:` and `lightning:` links handed to the app by another app, a browser
 * or a scanned code elsewhere on the phone.
 *
 * A link only ever *fills in* the send form. It never prepares or sends a
 * payment: the amount and fee still go through the same review the user has to
 * confirm, so an app that can open a URL cannot move money.
 *
 * Links that arrive before a wallet is open are dropped rather than queued.
 * Holding one across an unlock would mean acting on an intent from a moment the
 * user may not remember, and the sender can simply tap it again.
 */
const PAYMENT_SCHEME = /^(bitcoin|lightning):/i;

// The URL the app was launched with is one intent. Reading it again after a
// network switch or a wallet change would reopen Send with a request the user
// already dealt with, so it is consumed once.
//
// Once for the process on an iPhone, which keeps the URL it was launched
// with for as long as it runs.
//
// Once for each time the app is mounted on Android, where the launch URL is
// the activity's, and an app can outlive its activity: Back at Home closes
// the activity on Android 7 to 11 and leaves the app running, and the tap or
// link that comes next makes a new activity, which the running app is not
// told of. React Native mounts the app once for each activity, stopping it
// as one is destroyed, so a mount is a new activity with a launch URL of
// its own. `MainActivity` sees to it that this is never a request already
// dealt with: an activity built again from saved state or from the recents
// list forgets its request (docs/TAP-TO-PAY.md).
let initialConsumed = false;

export function normalizePaymentLink(url: string | null | undefined) {
  if (!url) return '';
  const value = url.trim();
  if (!PAYMENT_SCHEME.test(value)) return '';
  // A bare `lightning:` prefix is not part of the invoice the parser reads.
  return value.replace(/^lightning:/i, '');
}

/**
 * How long a request the scanner read from a tag is remembered, so the same
 * tap is not taken twice.
 */
export const TAP_ECHO_MS = 5000;

let tapped: { request: string; at: number } | null = null;

/**
 * The scanner has just read `request` from an NFC tag. While the scanner is
 * open the radio is the app's alone. As it closes, Android may find the tag
 * still there and offer it as a link (docs/TAP-TO-PAY.md), which would open a
 * second Send over the one the tap opened. The scanner's reader asks Android
 * not to. This is for a phone that offers it anyway.
 */
export function tookByTap(request: string) {
  tapped = { request: request.toLowerCase(), at: Date.now() };
}

/** Whether `request` is the one a tap brought a moment ago. */
function echoesTap(request: string): boolean {
  if (!tapped || Date.now() - tapped.at >= TAP_ECHO_MS) return false;
  return tapped.request === request.toLowerCase();
}

export function usePaymentLinks(
  ready: boolean,
  onRequest: (value: string) => void,
) {
  // Whether this mount of the app has read its launch URL.
  const consumedHere = useRef(false);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const handle = (url: string | null | undefined) => {
      const request = normalizePaymentLink(url);
      if (active && request && !echoesTap(request)) onRequest(request);
    };
    const consumed =
      Platform.OS === 'android' ? consumedHere.current : initialConsumed;
    if (!consumed) {
      consumedHere.current = true;
      initialConsumed = true;
      Linking.getInitialURL()
        .then(handle)
        .catch(() => {});
    }
    const subscription = Linking.addEventListener('url', ({ url }) =>
      handle(url),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, onRequest]);
}
