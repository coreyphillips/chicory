import React, {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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
import { Glyph } from '../design/glyphs';
import type { GlyphName } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { CopyChip } from '../glyphs/CopyChip';
import { sceneIn, sceneOut } from '../motion/presets';
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
  alreadySubmitted,
  amountTone,
  errorCode,
  fixedAmount,
  isUncertain,
  resultVisual,
  reviewRail,
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
import type { Landing } from '../scenes/send/useLanding';
import { recordDiagnostic } from '../services/diagnosticLog';
import { errorMessage } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { heldRequest, holdRequest } from '../stage/heldRequests';
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

/** A quote this close to running out is said aloud once. */
const LATE_MS = 10_000;

const TONE_WORDS: Record<AmountTone, string | null> = {
  plain: null,
  'over-spendable': copy.amount.overSpendable,
  'over-total': copy.amount.overTotal,
  under: null,
};

/**
 * A quote that ran out on its clock. An expired quote is a safety state
 * (REDESIGN.md rule 4): the hold gives way to a refresh, and the change is
 * felt, said and logged as it happens. It is said through `say`, once a
 * screen reader has landed on the refresh.
 */
function quoteExpired(say: (text: string, assertive?: boolean) => void) {
  haptics.warning();
  say(copy.send.quoteExpired, true);
  recordDiagnostic({
    phase: 'ui',
    code: 'QUOTE_EXPIRED',
    message: copy.send.quoteExpired,
  });
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
  ref?: Ref<SendHandle>;
}) {
  const live = usePaneActive();
  const [request, setRequest] = useState(initialRequest);
  // A request that arrived whole shows as a chip; one being typed as text.
  const [collapsed, setCollapsed] = useState(initialRequest !== '');
  // Without the overlay, the camera is a view inside this screen, so a typed
  // request or amount survives a scan that is cancelled or replaces it.
  const [scanning, setScanning] = useState(initialScanning);
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<SendReview | null>(null);
  const [reviewedAt, setReviewedAt] = useState(0);
  const [expired, setExpired] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [rail, setRail] = useState<GlyphName>('bolt');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
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
  // from the well is held all the same. Read afresh on every render: the
  // held set changes outside React, so a change made here asks for a render
  // of its own.
  const held =
    review || result || !collapsed ? null : heldRequest(request, activity);
  const [, heldChanged] = useReducer((count: number) => count + 1, 0);

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
    reviewing.current = review !== null && !expired;
  });

  useEffect(() => {
    if (!initialRequest) return;
    setRequest(initialRequest);
    setCollapsed(true);
  }, [initialRequest]);
  // The stage is told busy by the handlers that send, as a request goes out
  // and as its answer comes back (`goingOut` and `cameBack` below), and
  // released as Send goes, whatever is still in flight.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => () => onBusy(false), [onBusy]);

  // A quote runs out on its own clock, and is said aloud once as it gets
  // close.
  useEffect(() => {
    if (!review || expired) return;
    const left = review.expiresAt - Date.now();
    const timers = [
      setTimeout(() => {
        setExpired(true);
        land(control);
        quoteExpired(say);
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
  }, [review, expired, land, say]);

  // The stale gate closing on the payment is a safety state (REDESIGN.md
  // rule 4): felt, said and logged as it closes. On a review it takes the
  // hold's place, and a screen reader lands on it; as it opens again, back
  // on the review's amount above the hold.
  const gateWas = useRef(disabled);
  useEffect(() => {
    const opened = gateWas.current && !disabled;
    gateWas.current = disabled;
    if (opened && reviewing.current) land(summary);
    if (!disabled) return;
    haptics.warning();
    if (reviewing.current) land(control);
    say(copy.send.stale, true);
    recordDiagnostic({ phase: 'ui', code: 'STALE', message: copy.send.stale });
  }, [disabled, land, say]);

  // Landing on the held ring is felt, said and logged, once for each time.
  const heldFor = held ? request.trim() : '';
  useEffect(() => {
    if (!heldFor) return;
    haptics.held();
    land(mark);
    say(copy.send.heldAnnouncement, true);
    recordDiagnostic({ phase: 'ui', code: 'HELD', message: copy.send.held });
  }, [heldFor, land, say]);

  // The ground behind the canvas holds honey while an outcome is unknown,
  // here before the wallet's own read of it says so, and flashes radish as a
  // payment fails (REDESIGN.md 3.2, G3).
  useHoldTint(result?.status === 'uncertain' || held ? 'honey' : null);
  const flash = useFlashTint();

  // A result is felt as it lands, and said once its mark has taken a screen
  // reader's focus, so the move never cuts an assertive message short.
  useEffect(() => {
    if (!result) return;
    land(mark);
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
        say(copy.send.heldAnnouncement, true);
        break;
      case 'failed':
        haptics.error();
        flash('radish');
        say(`${copy.send.failed} ${result.message}`, true);
        break;
    }
  }, [result, flash, land, say]);

  useEffect(() => {
    if (result?.status !== 'completed' || !onDone || stayed || reader) return;
    const timer = setTimeout(onDone, HOME_AFTER_MS);
    return () => clearTimeout(timer);
  }, [result, onDone, stayed, reader]);

  const stay = () => setStayed(true);

  const sending = useRef(false);

  /**
   * Marks a request to the engine as going out. The stage hears it now, in
   * the handler that sends it, rather than from an effect a render later:
   * until then a close or a back could still take Send away under a payment
   * in flight, and its result would never be shown.
   */
  function goingOut() {
    sending.current = true;
    onBusy(true);
    setBusy(true);
  }

  /**
   * The answer is back. A Send that has already gone leaves the stage alone,
   * which it released as it went and may since be holding for another.
   */
  function cameBack() {
    sending.current = false;
    if (mounted.current) onBusy(false);
    setBusy(false);
  }

  function accept(code: string) {
    setRequest(code);
    setCollapsed(true);
    setFailure(null);
    setScanning(false);
  }

  /**
   * An engine refusal: felt and logged as it comes, and said once a screen
   * reader has landed where `landing` says, when the refusal moves it on.
   */
  function fail(
    error: unknown,
    landing?: (next: Failure) => Landing | null,
  ): Failure {
    const message = errorMessage(error);
    const next = sendFailure(error, {
      message,
      amountSats: fixedSats ?? (amount ? Number(amount) : null),
      balance,
    });
    haptics[next.haptic]();
    const target = landing?.(next);
    if (target) land(target);
    say(message, true);
    recordDiagnostic({ phase: 'ui', code: next.code || undefined, message });
    if (next.target === 'request') setCollapsed(false);
    if (next.target === 'amount' && next.shake) setAmountShakes(n => n + 1);
    setFailure(next);
    return next;
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
    setFailure(null);
    setCollapsed(true);
    heldChanged();
  }

  function settle(outcome: SendResult, code?: string) {
    holdRequest(request, outcome);
    setResult(outcome);
    setStayed(false);
    setReview(null);
    onRefresh();
    if (outcome.status === 'uncertain' || outcome.status === 'failed') {
      recordDiagnostic({
        phase: 'ui',
        code: code || outcome.status.toUpperCase(),
        message: outcome.message,
      });
    }
  }

  async function prepare() {
    if (sending.current) return;
    // Rule 6 holds however the request came, typed, pasted or refreshed.
    if (heldRequest(request, activity)) {
      toHeld();
      return;
    }
    // A refresh is asked for from a review whose quote ran out.
    const fromReview = review !== null;
    goingOut();
    setFailure(null);
    try {
      const next = await client.prepareSend({
        request: request.trim(),
        amountSats:
          fixedSats === null && amount.trim() ? parseSats(amount) : undefined,
      });
      setReview(next);
      setReviewedAt(Date.now());
      setCollapsed(true);
      const late = next.expiresAt <= Date.now();
      setExpired(late);
      land(late ? control : summary);
      if (late) quoteExpired(say);
    } catch (e) {
      if (alreadySubmitted(e)) {
        // The engine has a payment for this request out already.
        holdRequest(request, { status: 'uncertain' });
        recordDiagnostic({
          phase: 'ui',
          code: errorCode(e),
          message: errorMessage(e),
        });
        toHeld();
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
      cameBack();
    }
  }

  async function pay() {
    if (!review || sending.current || expired || disabled) return;
    // The quote's own clock has the last word, not the render the hold began
    // in, and a request held since the review never pays twice.
    if (review.expiresAt <= Date.now()) {
      setExpired(true);
      land(control);
      quoteExpired(say);
      return;
    }
    if (heldRequest(request, activity)) {
      toHeld();
      return;
    }
    goingOut();
    setFailure(null);
    setRail(reviewRail(review).glyph);
    try {
      settle(await client.send(review));
    } catch (e) {
      if (isUncertain(e)) {
        // The payment may have gone out. It is never an error to retry.
        settle(
          {
            id: review.id,
            status: 'uncertain',
            amountSats: review.amountSats,
            feeSats: review.feeSats,
            feeEstimated: true,
            message: errorMessage(e),
          },
          errorCode(e),
        );
      } else if (errorCode(e) === 'QUOTE_EXPIRED') {
        setExpired(true);
        fail(e, () => control);
      } else {
        setReview(null);
        fail(e, backToCompose);
      }
    } finally {
      cameBack();
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
      accept(pasted);
      say(copy.send.pasted);
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
      if (busy || sending.current) return false;
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
    return <Scanner onDetected={accept} onCancel={() => setScanning(false)} />;
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
            glyph="orbit"
            accessibilityLabel={copy.send.viewActivity}
            onPress={live ? onActivity : undefined}
          />
        </View>
      </>
    );
  } else if (held) {
    const item = held.item;
    const shown = item?.amountSats ?? fixedSats;
    content = (
      <>
        <View style={styles.body}>
          <ResultMark
            ref={mark}
            visual={resultVisual('uncertain')}
            accessibilityLabel={
              held.status === 'pending' ? copy.send.onItsWay : copy.send.unknown
            }
            accessibilityValue={statusLabel(held.status)}
            accessibilityHint={[
              copy.send.held,
              item && onDetail ? copy.send.showPayment : null,
            ]
              .filter(Boolean)
              .join(' ')}
            onPress={
              live && item && onDetail ? () => onDetail(item) : undefined
            }
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
            glyph="orbit"
            accessibilityLabel={copy.send.viewActivity}
            onPress={live ? onActivity : undefined}
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
          <ReviewLines review={review} unit={unit} />
        </View>
        <View style={styles.controls}>
          <View style={styles.side}>
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
            onCommit={pay}
            onRefreshQuote={live && !busy ? refreshQuote : undefined}
            onRefresh={live ? onRefresh : undefined}
          />
          <View style={styles.side}>
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
      TONE_WORDS[tone],
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
          <View style={styles.side}>
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
          onCollapse={() => setCollapsed(request.trim() !== '')}
          fixed={fixedSats !== null}
          refused={composing && failure?.target === 'request' ? failure : null}
          busy={busy}
          onPaste={composing ? paste : undefined}
          onScan={composing ? scan : undefined}
        />
      )}
      <Reanimated.View
        key={step}
        entering={sceneIn()}
        exiting={sceneOut()}
        onTouchStart={result ? stay : undefined}
        onFocus={result ? stay : undefined}
        style={styles.step}
      >
        {content}
      </Reanimated.View>
    </View>
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
  side: { width: 56, alignItems: 'center' },
  fee: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  feeText: { ...typography.line, color: palette.steam },
});
