import React, {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode, Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HostInstance } from 'react-native';
import Reanimated from 'react-native-reanimated';
import Clipboard from '@react-native-clipboard/clipboard';
import { parseSats } from '@beignet/wallet-core';
import type {
  Activity,
  SendResult,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { Scanner } from '../components/Scanner';
import { copy } from '../design/copy';
import { Glyph, HISTORY_GLYPH } from '../design/glyphs';
import type { GlyphName } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { CopyChip } from '../glyphs/CopyChip';
import { sceneIn, sceneOut, smooth } from '../motion/presets';
import { announceSafety } from '../motion/speech';
import { AmountReadout } from '../scenes/keypad/AmountReadout';
import { digitsOnly, grouped } from '../scenes/keypad/keys';
import type { AmountTone } from '../scenes/keypad/keys';
import { Amount } from '../scenes/send/Amount';
import { Commit } from '../scenes/send/Commit';
import { CircleControl } from '../scenes/send/Controls';
import { FailureMark } from '../scenes/send/FailureMark';
import { GlyphButton } from '../scenes/send/GlyphButton';
import {
  HOME_AFTER_MS,
  SEND_GRACE_MS,
  alreadySubmitted,
  amountTone,
  amountWords,
  errorCode,
  fixedAmount,
  heldVisual,
  isUncertain,
  resultVisual,
  reviewRail,
  requestRefusal,
  reviewWords,
  sendFailure,
} from '../scenes/send/model';
import type { Failure } from '../scenes/send/model';
import { RequestEntry } from '../scenes/send/RequestEntry';
import type { Origin } from '../scenes/send/RequestEntry';
import { ResultMark } from '../scenes/send/ResultMark';
import { LINE_SCALE, ReviewLines } from '../scenes/send/ReviewLines';
import { useLanding } from '../scenes/send/useLanding';
import { useScreenReader } from '../scenes/send/useScreenReader';
import { TestNetwork } from '../scenes/send/tone';
import type { Landing } from '../scenes/send/useLanding';
import { recordDiagnostic } from '../services/diagnosticLog';
import { errorMessage } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import {
  heldRequest,
  heldVersion,
  holdRequest,
  subscribeHeld,
} from '../stage/heldRequests';
import { useLaunchLanding } from '../stage/panes/Launch';
import { usePaneActive } from '../stage/panes/Pane';
import { useFlashTint, useHoldTint } from '../stage/StageContext';
import {
  MASK,
  amountIn,
  space,
  statusLabel,
  type as typography,
} from '../theme';
import type { Unit } from '../theme';

/** What a Send on the canvas asks of the screen inside it. */
export interface SendHandle {
  /** Android back: a step back inside Send, or false for the stage's own. */
  back: () => boolean;
  /** A code the scan overlay read for this Send. */
  receive: (code: string) => void;
}

/** An amount as the screen shows it, in `unit`, with its suffix. */
const shownIn = (sats: number, unit: Unit) => {
  const { value, suffix } = amountIn(sats, unit);
  return `${value} ${suffix}`;
};

/**
 * The control under a result that opens the history. An orbit there would
 * read as money still moving, under a payment that is done or held, so it
 * is the history's own glyph, as Receive's receipt draws it.
 */
const ACTIVITY_GLYPH: GlyphName = HISTORY_GLYPH;

/** A quote this close to running out is said aloud once. */
const LATE_MS = 10_000;

/**
 * A quote that ran out on its clock. An expired quote is a safety state
 * (REDESIGN.md rule 4): the hold gives way to a refresh, and the change is
 * felt and logged as it happens, and said through `announceSafety` once a
 * screen reader has landed on the refresh. Returns the withdrawal, for a
 * quote refreshed, or a Send gone, before it is heard.
 */
function quoteExpired(): () => void {
  haptics.warning();
  recordDiagnostic({
    phase: 'ui',
    code: 'QUOTE_EXPIRED',
    message: copy.send.quoteExpired,
  });
  return announceSafety(copy.send.quoteExpired, 'expired');
}

/**
 * Paying a request (REDESIGN.md 6, Send). Compose takes the request in a
 * well and the amount on the keypad; review lays out the sum and holds the
 * payment behind a 700ms hold inside the quote's countdown; the result is a
 * mark that says how it went. A request whose earlier payment is pending or
 * unknown never reaches a review: it lands on the held ring (rule 6). The
 * request holds its place from step to step while what is under it
 * crossfades, so each step blends into the next rather than replacing it.
 *
 * The screen says nothing in words. Each state is a glyph, a ring, a colour
 * and a motion, and its words are what a screen reader hears and what a long
 * press shows.
 *
 * As each step settles a screen reader lands on its primary element
 * (REDESIGN.md 9), and what the step says aloud waits until it has: a review
 * lands on its amount, at the head of the sum, never on the hold; a quote
 * running out or the balance going stale lands on the control that takes
 * the hold's place, and a fresh quote back on the amount; a result or the
 * held ring on its mark; and back in compose, on the amount.
 *
 * Amounts are shown in `unit`, the one the balance is in. While amounts are
 * hidden (`masked`) a result and the held ring show theirs as dots, as the
 * fee paid; a review never does, since it is where the payment is checked
 * before it is sent. A screen reader always hears sats.
 *
 * A payment holds the stage busy for SEND_GRACE_MS at most. One still out
 * after that lets the stage go and moves to the held ring, so Close works
 * and the history is a tap away while the call goes on; its answer is
 * recorded whenever it comes, and shown here if the held ring still is.
 *
 * On the canvas, `onScan` opens the scan overlay and the Send scene hands the
 * code back through `receive`. Rendered on its own, with no `onScan`, the
 * camera opens inside it instead. `onDone` takes a completed payment home
 * once it has been seen, and `onDetail` opens the payment a held request is
 * waiting on.
 */
export function SendScreen({
  client,
  initialRequest = '',
  disabled = false,
  onActivity,
  onRefresh,
  onBusy,
  initialScanning = false,
  balance,
  activity,
  onScan,
  onDetail,
  onDone,
  masked = false,
  unit = 'sats',
  test = false,
  ref,
}: {
  client: WalletAdapter;
  /** Prefilled by a scanned code or a bitcoin:/lightning: link. Never auto-sent. */
  initialRequest?: string;
  /** Set when the wallet's balance is too old to spend against. */
  disabled?: boolean;
  onActivity: () => void;
  onRefresh: () => void;
  onBusy: (busy: boolean) => void;
  /** Open straight onto the camera, when rendered without the overlay. */
  initialScanning?: boolean;
  /** What the amount is measured against. */
  balance?: WalletSnapshot['balance'];
  /** The history, which holds a request whose payment is still open. */
  activity?: Activity[];
  onScan?: (origin: Origin | null) => void;
  onDetail?: (item: Activity) => void;
  onDone?: () => void;
  /** Amounts are hidden, as the balance is. */
  masked?: boolean;
  /** The unit the balance is shown in. */
  unit?: Unit;
  /** A test network, where slate stands in for bloom throughout. */
  test?: boolean;
  ref?: Ref<SendHandle>;
}) {
  const live = usePaneActive();
  const launchLanding = useLaunchLanding();
  const [request, setRequest] = useState(initialRequest);
  // A request that arrived whole shows as a chip; one being typed as text,
  // and one the parser refuses stays in the well with its cross, so it never
  // takes the accepted look first.
  const [collapsed, setCollapsed] = useState(
    () => initialRequest !== '' && !requestRefusal(initialRequest),
  );
  // Without the overlay, the camera is a view inside this screen, so a typed
  // request or amount survives a scan that is cancelled or replaces it.
  const [scanning, setScanning] = useState(initialScanning);
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<SendReview | null>(null);
  const [reviewedAt, setReviewedAt] = useState(0);
  const [expired, setExpired] = useState(false);
  // The hold has committed on the review's quote, which is spent from then
  // on: nothing about it can expire, be refreshed or be reviewed again for
  // this payment, however long the payment takes.
  const [spent, setSpent] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [rail, setRail] = useState<GlyphName>('bolt');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(() =>
    requestRefusal(initialRequest),
  );
  // Each refusal of the amount shakes it, the same one again included.
  const [amountShakes, setAmountShakes] = useState(0);
  // A completed payment goes home on its own unless the screen is touched or
  // focused, and never while a screen reader is running: its user reaches
  // the result a swipe at a time, and no timer should take it away.
  const [stayed, setStayed] = useState(false);
  const reader = useScreenReader();
  // A request that names its amount sets it and locks it, so the amount
  // cannot be changed by accident. What was typed stays for a request that
  // names none.
  const fixedSats = useMemo(() => fixedAmount(request), [request]);
  // A request is checked once it is taken, as a chip, rather than letter by
  // letter as it is typed; prepare checks again, so one reviewed straight
  // from the well is held all the same. Read afresh on every render, and
  // drawn again whenever this app holds or lets go of a request, wherever
  // that happens: a payment an earlier Send left going out answers into the
  // same set.
  useSyncExternalStore(subscribeHeld, heldVersion);
  const held =
    review || result || !collapsed ? null : heldRequest(request, activity);
  // The request whose held ring is on screen, if one is, for a payment's
  // late answer to follow.
  const watching = useRef('');
  useLayoutEffect(() => {
    watching.current = held && !result ? request.trim() : '';
  });

  // Where a screen reader lands as a step settles: the review's amount, the
  // control in the ring, the amount in compose, and a result's mark.
  const { land, say } = useLanding();
  const summary = useRef<HostInstance>(null);
  const control = useRef<HostInstance>(null);
  const readout = useRef<HostInstance>(null);
  const mark = useRef<HostInstance>(null);
  // Whether the hold is up, for the balance's gate to read as it turns.
  const reviewing = useRef(false);
  useLayoutEffect(() => {
    reviewing.current = review !== null && !expired && !spent;
  });

  // A request brought by a scan or a link is taken as a pasted one is, and
  // refused as it arrives when it cannot be paid.
  const entered = useRef(accept);
  useLayoutEffect(() => {
    entered.current = accept;
  });
  useEffect(() => {
    if (initialRequest) entered.current(initialRequest);
  }, [initialRequest]);
  // The stage is told busy by the handlers that send, as a request goes out
  // (`goingOut` below), and let go as its answer comes back or its grace
  // runs out, whichever is first, and as Send goes, whatever is still in
  // flight.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => () => onBusy(false), [onBusy]);
  // Calls to the engine are numbered, so an answer only lets go of what its
  // own call took. `stageFor` is the call the stage is held busy for, never
  // longer than its grace; `waitingFor` is the call this screen waits on,
  // with its controls off, until it answers or, for a payment, until the
  // screen moves on to the held ring.
  const calls = useRef(0);
  const stageFor = useRef(0);
  const waitingFor = useRef(0);
  const graces = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = graces.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // What is still to be said of a quote that ran out, taken back as a fresh
  // quote replaces it or Send goes (REDESIGN.md 9: a state that ends before
  // it is heard is not said).
  const expiredSaid = useRef<(() => void) | null>(null);
  const sayExpired = useRef(() => {
    expiredSaid.current?.();
    expiredSaid.current = quoteExpired();
  });
  useEffect(() => {
    if (expired) return;
    expiredSaid.current?.();
    expiredSaid.current = null;
  }, [expired]);
  useEffect(() => () => expiredSaid.current?.(), []);

  // A quote runs out on its own clock, and is said aloud once as it gets
  // close, until the hold commits on it.
  useEffect(() => {
    if (!review || expired || spent) return;
    const left = review.expiresAt - Date.now();
    const timers = [
      setTimeout(() => {
        setExpired(true);
        land(control);
        sayExpired.current();
      }, Math.max(0, left)),
    ];
    if (left > LATE_MS) {
      timers.push(
        setTimeout(
          () => say(copy.send.quoteExpires(LATE_MS / 1000)),
          left - LATE_MS,
        ),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [review, expired, spent, land, say]);

  // The stale gate closing on the payment is a safety state (REDESIGN.md
  // rule 4): felt and logged as it closes, and said once a screen reader
  // has landed, unless it opens again first. On a review it takes the hold's
  // place, and a screen reader lands on it; as it opens again, back on the
  // review's amount above the hold.
  const gateWas = useRef(disabled);
  useEffect(() => {
    const opened = gateWas.current && !disabled;
    gateWas.current = disabled;
    if (opened && reviewing.current) land(summary);
    if (!disabled) return;
    haptics.warning();
    if (reviewing.current) land(control);
    recordDiagnostic({ phase: 'ui', code: 'STALE', message: copy.send.stale });
    return announceSafety(copy.send.stale, 'stale');
  }, [disabled, land]);

  // Landing on the held ring is felt, said and logged, once for each time.
  // It is said once a screen reader has landed on the ring's mark and
  // settled there (REDESIGN.md 9), unless the ring or Send goes first.
  const heldFor = held ? request.trim() : '';
  useEffect(() => {
    if (!heldFor) return;
    haptics.held();
    land(mark);
    recordDiagnostic({ phase: 'ui', code: 'HELD', message: copy.send.held });
    return announceSafety(copy.send.heldAnnouncement, 'held');
  }, [heldFor, land]);

  // The ground behind the canvas holds honey while an outcome is unknown,
  // here before the wallet's own read of it says so, and flashes radish as a
  // payment fails (REDESIGN.md 3.2, G3).
  useHoldTint(result?.status === 'uncertain' || held ? 'honey' : null);
  const flash = useFlashTint();

  // A result is felt as it lands, and said once its mark has taken a screen
  // reader's focus, so the move never cuts an assertive message short. An
  // unknown one is a safety state, said through `announceSafety` once the
  // landing has settled, unless the result or Send goes first.
  useEffect(() => {
    if (!result) return;
    land(mark);
    let withdraw: (() => void) | undefined;
    switch (result.status) {
      case 'completed':
        haptics.success();
        say(copy.send.sent);
        break;
      case 'pending':
        haptics.soft();
        say(copy.send.onItsWay);
        break;
      case 'uncertain':
        haptics.held();
        withdraw = announceSafety(copy.send.heldAnnouncement, 'held');
        break;
      case 'failed':
        haptics.error();
        flash('radish');
        say(`${copy.send.failed} ${result.message}`, true);
        break;
    }
    return withdraw;
  }, [result, flash, land, say]);

  useEffect(() => {
    if (result?.status !== 'completed' || !onDone || stayed || reader) return;
    const timer = setTimeout(onDone, HOME_AFTER_MS);
    return () => clearTimeout(timer);
  }, [result, onDone, stayed, reader]);

  const stay = () => setStayed(true);

  /**
   * Marks a request to the engine as going out, and returns its number. The
   * stage hears it now, in the handler that sends it, rather than from an
   * effect a render later: until then a close or a back could still take
   * Send away under a payment in flight, and its result would never be
   * shown.
   */
  function goingOut(): number {
    calls.current += 1;
    const call = calls.current;
    stageFor.current = call;
    waitingFor.current = call;
    onBusy(true);
    setBusy(true);
    return call;
  }

  /**
   * Lets the stage go, if `call` still holds it. A Send that has already
   * gone leaves the stage alone, which it released as it went and may since
   * be holding for another.
   */
  function letStageGo(call: number) {
    if (stageFor.current !== call) return;
    stageFor.current = 0;
    if (mounted.current) onBusy(false);
  }

  /** The answer to `call` is back. */
  function cameBack(call: number) {
    letStageGo(call);
    if (waitingFor.current !== call) return;
    waitingFor.current = 0;
    if (mounted.current) setBusy(false);
  }

  /**
   * The stage waits SEND_GRACE_MS for `call` at most, then is let go, and
   * `then` runs. Returns the cancel, for an answer that comes first.
   */
  function grace(call: number, then?: () => void): () => void {
    const timer = setTimeout(() => {
      graces.current.delete(timer);
      letStageGo(call);
      then?.();
    }, SEND_GRACE_MS);
    graces.current.add(timer);
    return () => {
      clearTimeout(timer);
      graces.current.delete(timer);
    };
  }

  /**
   * Takes a request as it is entered, pasted, scanned or brought by a link,
   * as a chip. One the parser refuses is refused here, before an amount is
   * keyed for it: it stays in the well with a cross (REDESIGN.md 6, Engine
   * errors). Returns whether it was taken.
   */
  function accept(code: string): boolean {
    setRequest(code);
    setScanning(false);
    const refused = requestRefusal(code);
    if (refused) {
      refuse(refused);
      return false;
    }
    setCollapsed(true);
    setFailure(null);
    return true;
  }

  /** Typing is done: a request is taken as a chip, or refused in the well. */
  function collapse() {
    if (!request.trim()) {
      setCollapsed(false);
      return;
    }
    if (failure?.target === 'request') return;
    const refused = requestRefusal(request);
    if (refused) refuse(refused);
    else setCollapsed(true);
  }

  /**
   * A refusal: felt and logged as it comes, and said once a screen reader has
   * landed where `landing` says, when the refusal moves it on.
   */
  function refuse(
    next: Failure,
    landing?: (next: Failure) => Landing | null,
  ): Failure {
    haptics[next.haptic]();
    const target = landing?.(next);
    if (target) land(target);
    say(next.message, true);
    recordDiagnostic({
      phase: 'ui',
      code: next.code || undefined,
      message: next.message,
    });
    if (next.target === 'request') setCollapsed(false);
    if (next.target === 'amount' && next.shake) setAmountShakes(n => n + 1);
    setFailure(next);
    return next;
  }

  /** An engine refusal, drawn where its code says. */
  function fail(
    error: unknown,
    landing?: (next: Failure) => Landing | null,
  ): Failure {
    return refuse(
      sendFailure(error, {
        message: errorMessage(error),
        amountSats: fixedSats ?? (amount ? Number(amount) : null),
        balance,
      }),
      landing,
    );
  }

  /**
   * Where a screen reader lands as a refusal takes a review back to compose:
   * the amount, unless the request was refused, whose well takes focus as it
   * opens.
   */
  const backToCompose = (next: Failure) =>
    next.target === 'request' ? null : readout;

  /** Lands a held request on its ring, whatever step it was on. */
  function toHeld() {
    setReview(null);
    setExpired(false);
    setSpent(false);
    setFailure(null);
    setCollapsed(true);
  }

  /** Shows how a payment came out. */
  function show(outcome: SendResult) {
    setResult(outcome);
    setStayed(false);
    setReview(null);
    setExpired(false);
    setSpent(false);
  }

  /**
   * A payment still out once its grace has run: the stage has let go, so
   * Close works, and the screen moves to the held ring for `paying`, which is
   * felt, said and logged as any held request's is. The call goes on.
   */
  function overdue(call: number, paying: string) {
    if (!mounted.current || waitingFor.current !== call) return;
    waitingFor.current = 0;
    watching.current = paying.trim();
    setBusy(false);
    toHeld();
  }

  async function prepare() {
    if (waitingFor.current) return;
    // Rule 6 holds however the request came, typed, pasted or refreshed.
    if (heldRequest(request, activity)) {
      toHeld();
      return;
    }
    // A refresh is asked for from a review whose quote ran out.
    const fromReview = review !== null;
    const asking = request;
    const call = goingOut();
    // Preparing pays nothing, so a Send left while it waits loses nothing.
    const cancelGrace = grace(call);
    setFailure(null);
    try {
      const next = await client.prepareSend({
        request: request.trim(),
        amountSats:
          fixedSats === null && amount.trim() ? parseSats(amount) : undefined,
      });
      if (!mounted.current) return;
      setReview(next);
      setReviewedAt(Date.now());
      setCollapsed(true);
      const late = next.expiresAt <= Date.now();
      setExpired(late);
      land(late ? control : summary);
      if (late) sayExpired.current();
    } catch (e) {
      if (alreadySubmitted(e)) {
        // The engine has a payment for this request out already.
        holdRequest(asking, { status: 'uncertain' });
        if (!mounted.current) return;
        recordDiagnostic({
          phase: 'ui',
          code: errorCode(e),
          message: errorMessage(e),
        });
        toHeld();
      } else if (!mounted.current) {
        return;
      } else if (
        // A refresh refused beside its control keeps the spent quote on
        // screen, to try again; anything else is fixed back in compose.
        fail(e, next =>
          fromReview && next.target !== 'control' ? backToCompose(next) : null,
        ).target !== 'control'
      ) {
        setReview(null);
        setExpired(false);
      }
    } finally {
      cancelGrace();
      cameBack(call);
    }
  }

  async function pay() {
    if (!review || waitingFor.current || expired || disabled) return;
    // The quote's own clock has the last word, not the render the hold began
    // in, and a request held since the review never pays twice.
    if (review.expiresAt <= Date.now()) {
      setExpired(true);
      land(control);
      sayExpired.current();
      return;
    }
    if (heldRequest(request, activity)) {
      toHeld();
      return;
    }
    const paying = request;
    const quote = review;
    // The request is held before the payment goes out, and nothing the
    // history shows lets it go until this call answers, so however Send is
    // left from here, and however the request comes back, it is never paid
    // twice (REDESIGN.md rule 6).
    holdRequest(paying, { status: 'pending', calling: true });
    const call = goingOut();
    setSpent(true);
    setFailure(null);
    setRail(reviewRail(quote).glyph);
    let late = false;
    const cancelGrace = grace(call, () => {
      late = waitingFor.current === call;
      overdue(call, paying);
    });
    let outcome: SendResult | null = null;
    let code = '';
    let refusal: unknown = null;
    try {
      outcome = await client.send(quote);
    } catch (e) {
      code = errorCode(e);
      if (isUncertain(e)) {
        // The payment may have gone out. It is never an error to retry.
        outcome = {
          id: quote.id,
          status: 'uncertain',
          amountSats: quote.amountSats,
          feeSats: quote.feeSats,
          feeEstimated: true,
          message: errorMessage(e),
        };
      } else {
        refusal = e;
      }
    } finally {
      cancelGrace();
    }
    // Recorded whether or not anyone still watches: the held set is what
    // keeps the request from being paid twice. A refusal moved no money, so
    // it lets the request go.
    holdRequest(paying, outcome ?? { status: 'failed' });
    if (outcome) onRefresh();
    const unseen = !mounted.current || late;
    if (outcome?.status === 'uncertain' || outcome?.status === 'failed') {
      recordDiagnostic({
        phase: 'ui',
        code: code || outcome.status.toUpperCase(),
        message: outcome.message,
      });
    } else if (refusal && unseen) {
      recordDiagnostic({
        phase: 'ui',
        code: code || 'FAILED',
        message: errorMessage(refusal),
      });
    }
    cameBack(call);
    if (!mounted.current) return;
    if (late) {
      // Past its grace the screen moved on to the held ring, and follows the
      // payment only while that is still what it shows. A refusal this late
      // is shown as the payment failing, since the review it came from has
      // gone.
      if (watching.current !== paying.trim()) return;
      show(
        outcome ?? {
          id: quote.id,
          status: 'failed',
          amountSats: quote.amountSats,
          feeSats: 0,
          message: errorMessage(refusal),
        },
      );
    } else if (outcome) {
      show(outcome);
    } else if (code === 'QUOTE_EXPIRED') {
      // The engine refused the quote, so nothing went out on it.
      setSpent(false);
      setExpired(true);
      fail(refusal, () => control);
    } else {
      setSpent(false);
      setReview(null);
      fail(refusal, backToCompose);
    }
  }

  /** Back to compose from the review, keeping the request and amount. */
  function edit() {
    setReview(null);
    setExpired(false);
    setFailure(null);
    land(readout);
  }

  /** A new quote for the same payment, which takes the spent one's place. */
  function refreshQuote() {
    setFailure(null);
    prepare();
  }

  /** A failed payment tapped: back to compose with the request kept. */
  function retry() {
    setResult(null);
    setFailure(null);
    land(readout);
  }

  async function paste(): Promise<boolean> {
    try {
      const pasted = (await Clipboard.getString())?.trim();
      if (!pasted) {
        haptics.error();
        say(copy.send.clipboardEmpty);
        return false;
      }
      // A refused paste is said with its refusal instead.
      if (accept(pasted)) say(copy.send.pasted);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  function scan(origin: Origin | null) {
    if (onScan) onScan(origin);
    else setScanning(true);
  }

  useImperativeHandle(ref, () => ({
    back: () => {
      // Sent but not yet rendered as busy counts too: the stage refuses it.
      if (busy || waitingFor.current) return false;
      if (review) {
        edit();
        return true;
      }
      if (result?.status === 'failed') {
        retry();
        return true;
      }
      return false;
    },
    receive: accept,
  }));

  if (scanning) {
    return (
      <Scanner
        onDetected={accept}
        onCancel={() => setScanning(false)}
        test={test}
      />
    );
  }

  function typed(text: string) {
    setRequest(text);
    setCollapsed(false);
    setFailure(null);
  }

  const step = result
    ? 'result'
    : held
    ? 'held'
    : review
    ? 'review'
    : 'compose';
  let content: ReactNode;

  if (result) {
    const visual = resultVisual(result.status);
    const reference = result.txid || result.paymentHash;
    const item =
      activity?.find(
        payment =>
          (!!result.paymentHash &&
            payment.paymentHash === result.paymentHash) ||
          (!!result.txid && payment.txid === result.txid),
      ) ?? null;
    const failed = result.status === 'failed';
    const uncertain = result.status === 'uncertain';
    content = (
      <>
        <View style={styles.body}>
          <ResultMark
            ref={mark}
            visual={visual}
            accessibilityLabel={visual.title}
            accessibilityValue={statusLabel(result.status)}
            accessibilityHint={[
              result.message,
              uncertain ? copy.send.checkActivity : null,
              failed ? copy.send.retry : null,
              uncertain && item && onDetail ? copy.send.showPayment : null,
            ]
              .filter(Boolean)
              .join(' ')}
            onPress={
              !live
                ? undefined
                : failed
                ? retry
                : uncertain && item && onDetail
                ? () => onDetail(item)
                : undefined
            }
          />
          <Amount
            sats={result.amountSats}
            unit={unit}
            masked={masked}
            color={uncertain ? palette.honey : palette.cream}
          />
          <View
            accessible
            accessibilityLabel={
              result.feeEstimated ? copy.send.reviewedFee : copy.send.feePaid
            }
            accessibilityValue={{
              text:
                result.feeKnown === false
                  ? copy.send.feeUnavailable
                  : copy.amount.spoken(result.feeSats),
            }}
            style={styles.fee}
          >
            <Glyph name={rail} size={16} color={palette.steam} />
            <Text style={styles.feeText} maxFontSizeMultiplier={LINE_SCALE}>
              {result.feeEstimated ? '+ ≈' : '+'}
            </Text>
            {result.feeKnown === false ? (
              <Glyph name="question" size={16} color={palette.steam} />
            ) : (
              <Text style={styles.feeText} maxFontSizeMultiplier={LINE_SCALE}>
                {masked ? MASK : shownIn(result.feeSats, unit)}
              </Text>
            )}
          </View>
          {reference ? (
            <CopyChip label={copy.send.reference} value={reference} />
          ) : null}
        </View>
        <View style={[styles.controls, styles.centred]}>
          <GlyphButton
            glyph={ACTIVITY_GLYPH}
            accessibilityLabel={copy.send.viewActivity}
            onPress={live ? onActivity : undefined}
          />
        </View>
      </>
    );
  } else if (held) {
    const item = held.item;
    // A payment this screen sent shows what it sent, amount typed or not.
    const shown = item?.amountSats ?? fixedSats ?? (Number(amount) || null);
    const visual = heldVisual(held.status);
    // Once the history shows the payment, the way to it is the payment
    // itself; until then, the history it will show in.
    const openItem =
      live && item && onDetail ? () => onDetail(item) : undefined;
    content = (
      <>
        <View style={styles.body}>
          <ResultMark
            ref={mark}
            visual={visual}
            accessibilityLabel={visual.title}
            accessibilityValue={statusLabel(held.status)}
            accessibilityHint={[
              copy.send.held,
              openItem ? copy.send.showPayment : null,
            ]
              .filter(Boolean)
              .join(' ')}
            onPress={openItem}
          />
          {shown ? (
            <Amount
              sats={shown}
              unit={unit}
              masked={masked}
              color={palette.honey}
            />
          ) : null}
        </View>
        <View style={[styles.controls, styles.centred]}>
          <GlyphButton
            glyph={ACTIVITY_GLYPH}
            accessibilityLabel={copy.send.viewActivity}
            accessibilityHint={openItem ? copy.send.showPayment : undefined}
            onPress={live ? openItem ?? onActivity : undefined}
          />
        </View>
      </>
    );
  } else if (review) {
    content = (
      <>
        <View style={styles.body}>
          <Amount ref={summary} sats={review.amountSats} unit={unit} />
          {review.description ? (
            <Text
              style={styles.note}
              numberOfLines={2}
              maxFontSizeMultiplier={LINE_SCALE}
            >
              {review.description}
            </Text>
          ) : null}
          <ReviewLines review={review} unit={unit} spent={spent} />
        </View>
        <View style={styles.controls}>
          <View style={[styles.side, styles.start]}>
            <GlyphButton
              glyph="pencil"
              accessibilityLabel={copy.send.edit}
              onPress={live && !busy ? edit : undefined}
              disabled={busy}
            />
          </View>
          <Commit
            ref={control}
            accessibilityLabel={copy.send.sendSats(review.amountSats)}
            summary={reviewWords(review)}
            expiresAt={review.expiresAt}
            createdAt={reviewedAt}
            warning={review.warnings.length > 0}
            expired={expired}
            stale={disabled}
            busy={busy}
            spent={spent}
            onCommit={pay}
            onRefreshQuote={live && !busy ? refreshQuote : undefined}
            onRefresh={live ? onRefresh : undefined}
          />
          <View style={[styles.side, styles.end]}>
            {failure ? <FailureMark failure={failure} /> : null}
          </View>
        </View>
      </>
    );
  } else {
    const amountFailure = failure?.target === 'amount' ? failure : null;
    const shownAmount = fixedSats === null ? amount : String(fixedSats);
    const tone: AmountTone = amountFailure
      ? amountFailure.tone === 'honey'
        ? 'over-spendable'
        : 'over-total'
      : amountTone(Number(shownAmount) || 0, balance);
    const hint = [
      fixedSats === null ? null : copy.amount.fixed,
      amountWords(tone, Number(shownAmount) || 0, balance),
      amountFailure?.message,
    ]
      .filter(Boolean)
      .join(' ');
    content = (
      <>
        <AmountReadout
          ref={readout}
          accessibilityLabel={copy.amount.field}
          value={grouped(shownAmount)}
          onChangeText={
            live
              ? text => {
                  setAmount(digitsOnly(text));
                  if (amountFailure) setFailure(null);
                }
              : undefined
          }
          hint={hint || undefined}
          editable={fixedSats === null}
          busy={busy}
          tone={tone}
          shake={amountShakes}
        />
        <View style={styles.controls}>
          <View style={styles.side} />
          {/* Home's Send circle lands exactly on it (REDESIGN.md 7, T1). */}
          <View
            ref={launchLanding.ref}
            onLayout={launchLanding.onLayout}
            collapsable={false}
          >
            <CircleControl
              accessibilityLabel={copy.send.review}
              accessibilityHint={
                disabled
                  ? copy.send.stale
                  : busy
                  ? copy.send.preparing
                  : request.trim()
                  ? undefined
                  : copy.send.reviewWaits
              }
              onPress={
                !live || busy
                  ? undefined
                  : disabled
                  ? onRefresh
                  : request.trim()
                  ? prepare
                  : undefined
              }
              busy={busy}
              stale={disabled}
            />
          </View>
          <View style={[styles.side, styles.end]}>
            {failure && failure.target !== 'request' ? (
              <FailureMark failure={failure} />
            ) : null}
          </View>
        </View>
      </>
    );
  }

  const composing = step === 'compose';
  return (
    <TestNetwork.Provider value={test}>
      <View style={styles.screen}>
        {/* The request stays in place from step to step, a well while it is
          composed and a chip after, so only what changes crossfades. A
          chip past compose opens back to compose: from a review to edit
          the payment, from the held ring to take another request. */}
        {result ? null : (
          <RequestEntry
            accessibilityLabel={copy.send.request}
            value={request}
            onChangeText={composing && live ? typed : undefined}
            collapsed={!composing || collapsed}
            onExpand={
              busy ? undefined : review ? edit : () => setCollapsed(false)
            }
            onCollapse={collapse}
            fixed={fixedSats !== null}
            refused={
              composing && failure?.target === 'request' ? failure : null
            }
            busy={busy}
            onPaste={composing ? paste : undefined}
            onScan={composing ? scan : undefined}
          />
        )}
        {/* The step slides, rather than jumps, as the request above it opens
          into the well or closes into a chip. */}
        <Reanimated.View
          key={step}
          entering={sceneIn()}
          exiting={sceneOut()}
          layout={smooth()}
          onTouchStart={result ? stay : undefined}
          onFocus={result ? stay : undefined}
          style={styles.step}
        >
          {content}
        </Reanimated.View>
      </View>
    </TestNetwork.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.lg },
  step: { flexGrow: 1, gap: space.lg },
  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingVertical: space.lg,
  },
  note: { ...typography.row, color: palette.steam, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.xs,
  },
  centred: { justifyContent: 'center' },
  // A side slot holds its control against the page edge, as the pencil and
  // a refusal's mark sit at the edges the rest of the scene keeps.
  side: { width: 56 },
  start: { alignItems: 'flex-start' },
  end: { alignItems: 'flex-end' },
  fee: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  feeText: { ...typography.line, color: palette.steam },
});
