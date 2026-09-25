import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Reanimated from 'react-native-reanimated';
import { parseSats } from '@beignet/wallet-core';
import type {
  ReceiveQuote,
  ReceiveRequest,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { useToast } from '../components/Toast';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { haptics } from '../design/haptics';
import { qrSide } from '../glyphs/QrBloom';
import { sceneIn, sceneOut } from '../motion/presets';
import { useFocusOn } from '../scenes/receive/focus';
import type { Focus } from '../scenes/receive/focus';
import { FormStep } from '../scenes/receive/FormStep';
import { useReceiveHost } from '../scenes/receive/host';
import { LiftedQr } from '../scenes/receive/LiftedQr';
import { amountCue, remainderSats, requestFace } from '../scenes/receive/model';
import { QuoteStep } from '../scenes/receive/QuoteStep';
import { RequestStep } from '../scenes/receive/RequestStep';
import { useNow } from '../services/clock';
import { recordDiagnostic } from '../services/diagnosticLog';
import { useReceiveStatus } from '../services/useReceiveStatus';
import { errorMessage as message } from '../services/useWalletSession';
import type { WalletAdapter } from '../services/wallet';
import { usePaneActive } from '../stage/panes/Pane';
import type { Unit } from '../theme';

const codeOf = (e: unknown) => (e as { code?: string })?.code;

/**
 * Receive (REDESIGN.md 6): an amount, a quote for it, and the request it
 * becomes, which then shows what arrives for it. Everything a screen used
 * to say in sentences is said by glyphs, rings and motion here, and in the
 * labels a screen reader reads.
 */
export function ReceiveScreen({
  client,
  receivableSats = 0,
  offlineReceivableSats,
  disabled = false,
  hidden = false,
  unit = 'sats',
  onActivity,
  onRefresh,
  onBusy,
}: {
  client: WalletAdapter;
  receivableSats?: number;
  /**
   * The most an offline receive can take right now, 0 when no channel can
   * hold one. Undefined when the engine does not say.
   */
  offlineReceivableSats?: number;
  /** Set when the wallet's balance is too old to quote against. */
  disabled?: boolean;
  /** Amounts that arrive are masked, as the balance is. */
  hidden?: boolean;
  /** The unit amounts that arrive are shown in. */
  unit?: Unit;
  onActivity: () => void;
  onRefresh?: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { useBack, setTint } = useReceiveHost();
  const live = usePaneActive();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [capacityChanged, setCapacityChanged] = useState(false);
  // Receiving offline is an opt-in, never the default: the ordinary request
  // is paid over the home channel or provisioned by the primary just in
  // time. The switch is offered only when the engine advertises offline
  // receiving; the primary still has to offer settlement, and the engine
  // says so at quote time when it does not.
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let active = true;
    // Read through a promise so a client without the method (the demo
    // client, older hosts) leaves the switch off rather than breaking the
    // form.
    Promise.resolve()
      .then(() => client.getConfig())
      .then(config => {
        if (active)
          setOfflineAvailable(config?.offlineReceiveAvailable === true);
      })
      .catch(() => {
        if (active) setOfflineAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  // Nor is it offered when no channel can hold one: an offline receive needs
  // a channel with the primary that holds none of this wallet's balance. An
  // engine that does not say how much fits leaves that to the quote.
  const offlineOffered =
    offlineAvailable &&
    (offlineReceivableSats === undefined || offlineReceivableSats > 0);
  // An amount is needed when the primary has to provide the capacity (a
  // just-in-time receive is quoted on it), when it changed under a quote, and
  // for an offline receive, whose slot holds one fixed amount.
  const amountRequired = receivableSats <= 0 || capacityChanged || offline;
  const [amount, setAmount] = useState('');
  const cue = amountCue({
    amount,
    required: amountRequired,
    offline,
    cap: offlineReceivableSats,
  });
  const ready = !(amountRequired && cue.empty) && !cue.over && !cue.under;
  const [description, setDescription] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [quote, setQuote] = useState<ReceiveQuote | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [request, setRequest] = useState<ReceiveRequest | null>(null);
  const [createdAt, setCreatedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Each refusal of a control shakes it once.
  const [refusals, setRefusals] = useState(0);
  const [lifted, setLifted] = useState(false);
  const amountError = useRef('');
  useEffect(() => {
    if (receivableSats > 0) {
      setCapacityChanged(false);
      const previousAmountError = amountError.current;
      if (previousAmountError)
        setError(previous =>
          previous === previousAmountError ? '' : previous,
        );
      amountError.current = '';
    }
  }, [receivableSats]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const working = useRef(false);
  const tracking = useReceiveStatus(client, request, onRefresh || (() => {}));
  const receipt =
    tracking?.status && tracking.status.phase !== 'waiting'
      ? tracking.status
      : null;
  // The clock is only read by the expiry checks below, so it runs only while
  // there is something that can expire; a request that has been paid no
  // longer can.
  const now = useNow(1000, (!!request && !receipt) || !!quote);
  const face = request
    ? requestFace({
        request,
        now,
        paid: !!receipt,
        ambiguous: !!tracking?.ambiguous,
        createdAt: request.createdAt ?? createdAt,
      })
    : null;
  const quoteExpired = quote ? now >= quote.expiresAt : false;
  const step = request ? 'request' : quote ? 'quote' : 'form';
  // Back to the ordinary request when an offline one no longer fits, but only
  // on the form: creating an offline request reserves its channel, which takes
  // the figure to 0 while that request is still on screen.
  useEffect(() => {
    if (step === 'form' && !offlineOffered) setOffline(false);
  }, [step, offlineOffered]);

  // The night tint while the request being made, or shown, is an offline one.
  const night = request ? !!request.offlineReceive && !face?.expired : offline;
  useEffect(() => {
    setTint(night ? 'night' : null);
  }, [night, setTint]);
  useEffect(() => () => setTint(null), [setTint]);

  useArrival(receipt, request);
  useWarning(!!face?.expired && !receipt && !tracking?.ambiguous, () => {
    announce(copy.receive.expired, { assertive: true });
    recordDiagnostic({ phase: 'ui', message: copy.receive.expired });
  });
  useWarning(!!tracking?.ambiguous, () => {
    const said = tracking?.error ?? copy.receive.reusedAddress;
    announce(`${said} ${copy.receive.reusedShare}`, { assertive: true });
    recordDiagnostic({
      phase: 'ui',
      message: said,
      code: 'AMBIGUOUS_RECEIVE_ADDRESS',
    });
  });
  useWarning(quoteExpired, () => announce(copy.receive.quoteExpired));

  /**
   * Something asked for failed: the control that asked shakes, unless the
   * amount cue answers for it, and a screen reader hears why at once.
   */
  function refuse(e: unknown, shake = true) {
    const said = message(e);
    haptics.error();
    setError(said);
    if (shake) setRefusals(count => count + 1);
    announce(said, { assertive: true });
    recordDiagnostic({ phase: 'ui', message: said, code: codeOf(e) });
  }

  async function price() {
    if (working.current || disabled || !ready) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await client.quoteReceive({
        amountSats: amount.trim() ? parseSats(amount) : undefined,
        description: description.trim(),
        ...(offline ? { mode: 'offline' as const } : {}),
      });
      setQuote(next);
      setQuotedAt(Date.now());
    } catch (e) {
      // The infinity shakes to a sprout instead: an amount is needed after all.
      const needsAmount = codeOf(e) === 'AMOUNT_REQUIRED';
      amountError.current = needsAmount ? message(e) : '';
      if (needsAmount) setCapacityChanged(true);
      refuse(e, !needsAmount);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (!quote || working.current || quoteExpired || disabled) {
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      setRequest(await client.receive(quote));
      setCreatedAt(Date.now());
      setQuote(null);
      onRefresh?.();
    } catch (e) {
      refuse(e);
      setQuote(null);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  /** A stale balance holds a control back: it shakes, and the wallet refreshes. */
  function blocked() {
    haptics.warning();
    setRefusals(count => count + 1);
    onRefresh?.();
  }

  const shareable = !!face?.shareable;
  const uri = request?.uri;
  const lift = useCallback(() => {
    if (!shareable) return;
    haptics.tick();
    setLifted(true);
  }, [shareable]);
  const copyRequest = useCallback(() => {
    if (!shareable || !uri) return;
    haptics.tick();
    Clipboard.setString(uri);
    toast(copy.receive.copied, 'success', 'copy');
  }, [shareable, uri, toast]);
  function share() {
    if (!shareable || !uri) return;
    Share.share({ message: uri }).catch(refuse);
  }
  /**
   * Another request, or the rest of this one: a partly paid request starts
   * the next at exactly what is still owed, and keeps its note.
   */
  function again() {
    const remainder = request
      ? remainderSats(request.amountSats, receipt)
      : null;
    setRequest(null);
    setLifted(false);
    setCapacityChanged(false);
    setError('');
    setAmount(remainder !== null ? String(remainder) : '');
    if (receipt?.phase !== 'partial') {
      setDescription('');
      setNoteOpen(false);
    }
  }

  // Android back sets a lifted code down, and takes a quote back to the
  // amount it was for.
  const showLift = lifted && shareable;
  useBack(() => {
    if (showLift) {
      setLifted(false);
      return true;
    }
    if (step === 'quote' && !busy) {
      setQuote(null);
      setError('');
      return true;
    }
    return false;
  }, live && (showLift || step === 'quote'));

  // A screen reader follows each step to what it is about.
  const focus: Focus = useRef(null);
  useFocusOn(focus, `${step} ${face?.qr ?? ''} ${receipt?.phase ?? ''}`);

  const qr = Math.min(240, Math.max(150, width - 120));
  const amountMessage = error && error === amountError.current ? error : '';
  return (
    <View style={styles.root}>
      <Reanimated.View key={step} entering={sceneIn()} exiting={sceneOut()}>
        {request && face ? (
          <RequestStep
            request={request}
            createdAt={request.createdAt ?? createdAt}
            face={face}
            minutesLeft={Math.ceil(
              Math.max(0, request.expiresAt - now) / 60000,
            )}
            receipt={receipt}
            trackingError={tracking?.error}
            hidden={hidden}
            unit={unit}
            qr={qr}
            error={error}
            onLift={lift}
            onCopy={copyRequest}
            onShare={share}
            onAgain={again}
            onActivity={onActivity}
            focus={focus}
          />
        ) : quote ? (
          <QuoteStep
            quote={quote}
            quotedAt={quotedAt}
            offline={offline}
            receivableSats={receivableSats}
            expired={quoteExpired}
            busy={busy}
            stale={disabled}
            error={error}
            shake={refusals}
            onCreate={create}
            onRequote={() => {
              setQuote(null);
              price();
            }}
            onEdit={() => {
              setQuote(null);
              setError('');
            }}
            onBlocked={blocked}
            focus={focus}
          />
        ) : (
          <FormStep
            amount={amount}
            onAmount={setAmount}
            cue={cue}
            cap={offlineReceivableSats}
            amountMessage={amountMessage}
            note={description}
            onNote={setDescription}
            noteOpen={noteOpen}
            onNoteOpen={setNoteOpen}
            offlineOffered={offlineOffered}
            offline={offline}
            onOffline={next => {
              setOffline(next);
              setError('');
            }}
            busy={busy}
            stale={disabled}
            ready={ready}
            error={amountMessage ? '' : error}
            shake={refusals}
            onContinue={price}
            onBlocked={blocked}
            focus={focus}
          />
        )}
      </Reanimated.View>
      {showLift && request ? (
        <LiftedQr
          value={request.uri}
          from={qrSide(qr)}
          onClose={() => setLifted(false)}
        />
      ) : null}
    </View>
  );
}

/**
 * Money arriving (REDESIGN.md 3.6 and 5): the incoming haptic the first time
 * a request sees any, a success when it completes after that, and each new
 * phase said to a screen reader.
 */
function useArrival(
  receipt: ReceiveStatus | null,
  request: ReceiveRequest | null,
) {
  const heard = useRef<{
    request: ReceiveRequest | null;
    phase: ReceiveStatus['phase'] | null;
  }>({ request: null, phase: null });
  useEffect(() => {
    if (!receipt || !request) return;
    const last = heard.current;
    const first = last.request !== request;
    if (!first && last.phase === receipt.phase) return;
    heard.current = { request, phase: receipt.phase };
    if (first) haptics.incoming();
    else if (receipt.phase === 'completed') haptics.success();
    announce(
      receipt.phase === 'completed'
        ? copy.receive.received
        : receipt.phase === 'partial'
        ? copy.receive.partial
        : copy.receive.detected,
    );
  }, [receipt, request]);
}

/**
 * A safety state starting (REDESIGN.md rule 4): the warning haptic, once,
 * and whatever else it says, each time `on` turns true.
 */
function useWarning(on: boolean, say: () => void) {
  const said = useRef(say);
  said.current = say;
  const was = useRef(false);
  useEffect(() => {
    if (on && !was.current) {
      haptics.warning();
      said.current();
    }
    was.current = on;
  }, [on]);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
