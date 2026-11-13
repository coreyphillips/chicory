import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { copy } from '../../design/copy';
import { recordDiagnostic } from '../../services/diagnosticLog';
import { tapPresenter } from '../../services/tapPresenter';
import type { TapStatus } from '../../services/tapReader';
import { useAppActive } from '../home/useAppActive';

/**
 * What the request step draws of the tap (docs/TAP-TO-PAY.md): the mark of a
 * request that a phone held to this one reads, the way to switch NFC on, or
 * nothing, where the phone cannot act as a tag or the request is not
 * presented.
 */
export type Presenting = 'presenting' | 'off' | null;

/**
 * How often the phone is asked whether its NFC is still on while a request
 * is presented. Nothing tells the app when it is switched off from the
 * shade, and the mark must not go on saying what is no longer so.
 */
export const PRESENT_CHECK_MS = 2_000;

/**
 * Presents `request` over NFC for as long as it is given and the app is in
 * front, and withdraws it the moment either ends: as the request is paid,
 * expires or is replaced, as Receive is left, and as the app leaves the
 * front or locks, which unmounts it. Receive passes a request only while it
 * is one it would let you share, so the tag follows the code (REDESIGN.md
 * rule 4). A new request is presented in place of the old one.
 *
 * Native code withdraws by itself too, as the app leaves the front and as
 * the request runs out, so nothing here needs a timer to be on time. Since
 * it does, every return to the front presents again, including one after a
 * pause too brief for a render to have seen the app leave.
 *
 * A phone that says it can present and then does not draws no mark, and the
 * diagnostic log keeps why, by its code. Nothing of the request is logged.
 */
export function usePresenting(
  request: string | undefined,
  expiresAt: number,
): { presenting: Presenting; openSettings: () => void } {
  const presenter = tapPresenter();
  const foreground = useAppActive();
  const wanted = !!presenter && foreground && !!request;
  const [status, setStatus] = useState<TapStatus>('missing');
  const [presented, setPresented] = useState<string | null>(null);
  const [returns, setReturns] = useState(0);

  // Counted, where `foreground` only says where the app is now: leaving and
  // coming back inside one render leaves it unchanged, and native code has
  // withdrawn all the same.
  useEffect(() => {
    if (!presenter) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setReturns(count => count + 1);
    });
    return () => subscription.remove();
  }, [presenter]);

  // What the phone's NFC can do is asked as a request shows and each time
  // the app comes back to the front, which is how someone returns from
  // switching it on, and again every little while after.
  useEffect(() => {
    if (!presenter || !wanted) return;
    let active = true;
    const ask = () =>
      presenter.status().then(
        answer => active && setStatus(answer),
        () => active && setStatus('missing'),
      );
    ask();
    const timer = setInterval(ask, PRESENT_CHECK_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [presenter, wanted]);

  useEffect(() => {
    if (!presenter || !wanted || !request || status !== 'ready') return;
    let active = true;
    setPresented(null);
    presenter.present(request, expiresAt).then(
      outcome => {
        if (!active) return;
        if (outcome === 'presented') setPresented(request);
        else
          recordDiagnostic({
            phase: 'ui',
            code: outcome,
            message: copy.receive.tapNotPresented,
          });
      },
      () => {},
    );
    return () => {
      active = false;
      presenter.withdraw().catch(() => {});
    };
  }, [presenter, wanted, request, expiresAt, status, returns]);

  const openSettings = useCallback(() => {
    presenter?.openSettings().catch(() => {});
  }, [presenter]);

  const presenting: Presenting = !wanted
    ? null
    : status === 'off'
    ? 'off'
    : status === 'ready' && presented === request
    ? 'presenting'
    : null;
  return { presenting, openSettings };
}
