import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated from 'react-native-reanimated';
import { formatSats, parsePayment } from '@beignet/wallet-core';
import type {
  DrainProgress,
  SendReview,
  WalletSnapshot,
} from '@beignet/wallet-core';
import { Scanner } from '../../components/Scanner';
import { copy } from '../../design/copy';
import { CopyChip } from '../../glyphs/CopyChip';
import { riseIn } from '../../motion/presets';
import type { WalletAdapter } from '../../services/wallet';
import { usePaneActive } from '../../stage/panes/Pane';
import { duringSystemPrompt } from '../../stage/systemPrompt';
import { space } from '../../theme';
import { HoldConfirm } from './HoldConfirm';
import { Action, Field, Line, Link, Note, Working } from './ui';

const words = copy.settings.empty;
const inProgress = (snapshot: WalletSnapshot) =>
  snapshot.activity.find(
    row => row.drain && !['completed', 'failed'].includes(row.status),
  )?.drain;
const mergeProgress = (old: DrainProgress | undefined, next: DrainProgress) =>
  !old || (old.requestId === next.requestId && next.revision >= old.revision)
    ? next
    : old;

/** The coordinator owns the money and retries. This surface owns only a review. */
export function EmptyWallet({
  client,
  snapshot,
  disabled = false,
  onRefresh,
}: {
  client: WalletAdapter;
  snapshot: WalletSnapshot;
  disabled?: boolean;
  onRefresh: () => void;
}) {
  const live = usePaneActive();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [scanning, setScanning] = useState(false);
  const [review, setReview] = useState<SendReview | null>(null);
  const [progress, setProgress] = useState<DrainProgress | undefined>(() =>
    inProgress(snapshot),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kept, setKept] = useState(false);
  const alive = useRef(true);
  const operation = useRef(0);
  const locked = useRef(false);
  const known = useRef(new Map<string, DrainProgress>());
  const remember = useCallback((next: DrainProgress) => {
    const latest = mergeProgress(known.current.get(next.requestId), next)!;
    known.current.set(next.requestId, latest);
    return latest;
  }, []);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    for (const row of snapshot.activity) if (row.drain) remember(row.drain);
    setProgress(old => {
      if (old) remember(old);
      const active = [...known.current.values()]
        .reverse()
        .filter(row => !['completed', 'cancelled'].includes(row.phase))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return active ?? (old && known.current.get(old.requestId));
    });
  }, [snapshot, remember]);
  const requestId = progress?.requestId;
  const settled =
    progress?.phase === 'completed' || progress?.phase === 'cancelled';
  useEffect(() => {
    if (!requestId || settled || !live) return;
    let active = true;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await client.getDrain(requestId);
        if (active) {
          setProgress(old => mergeProgress(old, remember(next)));
          refresh.current();
        }
      } catch {
        /* Activity retains the durable identity while disconnected. */
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => {
      void read();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, requestId, settled, live, remember]);

  const validate = (value: string) => {
    const parsed = parsePayment(value, { network: snapshot.wallet.network });
    if (parsed.kind !== 'onchain') throw new Error(words.addressOnly);
    if (parsed.amountSats != null) throw new Error(words.noAmount);
    return parsed.address;
  };
  const change = (value: string) => {
    operation.current++;
    setAddress(value);
    setReview(null);
    setError('');
  };
  const run = async (action: (revision: number) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    const revision = ++operation.current;
    setBusy(true);
    setError('');
    try {
      await action(revision);
    } catch (reason) {
      if (alive.current && revision === operation.current)
        setError(reason instanceof Error ? reason.message : words.failed);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const keep = () =>
    run(async revision => {
      const id = progress?.requestId ?? review?.id;
      if (id) remember(await client.cancelDrain(id));
      if (!alive.current || revision !== operation.current) return;
      setOpen(false);
      setReview(null);
      setProgress(old => (old?.requestId === id ? undefined : old));
      setKept(true);
      refresh.current();
    });
  const submit = () =>
    run(async revision => {
      if (!review) return;
      let result;
      try {
        result = await client.send(review);
      } catch (reason) {
        if (alive.current && revision === operation.current) setReview(null);
        throw reason;
      }
      if (!alive.current || revision !== operation.current) return;
      setReview(null);
      if (result.status === 'failed') throw new Error(result.message);
      if (result.drain) {
        const next = result.drain;
        setProgress(old => mergeProgress(old, remember(next)));
      }
      refresh.current();
    });

  if (scanning)
    return (
      <Modal
        visible
        animationType="slide"
        onRequestClose={() => setScanning(false)}
      >
        <GestureHandlerRootView style={styles.scanner}>
          <Scanner
            validate={validate}
            test={snapshot.wallet.network !== 'mainnet'}
            onDetected={value => {
              change(value);
              setScanning(false);
            }}
            onCancel={() => setScanning(false)}
          />
        </GestureHandlerRootView>
      </Modal>
    );
  if (progress)
    return (
      <Reanimated.View entering={riseIn()} style={styles.stack}>
        <Note
          key={`${progress.requestId}:${progress.phase}`}
          tone={progress.phase === 'review' ? 'warning' : 'success'}
          focus
        >
          {progress.phase === 'completed'
            ? words.completed
            : progress.phase === 'cancelled'
            ? words.cancelled
            : progress.phase === 'review'
            ? words.uncertain
            : words.pending}
        </Note>
        <CopyChip label={words.address} value={progress.address} glyph="pin" />
        {progress.residualSats ? (
          <Note>{words.residual(formatSats(progress.residualSats))}</Note>
        ) : null}
        {error ? <Note tone="error">{error}</Note> : null}
        {busy ? <Working accessibilityLabel={words.working} /> : null}
        {['review', 'preparing', 'cancelling'].includes(progress.phase) ? (
          <Link
            label={words.keep}
            tone="steam"
            disabled={busy}
            onPress={keep}
          />
        ) : null}
      </Reanimated.View>
    );
  if (!open)
    return (
      <Link
        label={words.link}
        glyph="send"
        disabled={disabled}
        focus={kept}
        onPress={() => {
          setOpen(true);
          setKept(false);
        }}
      />
    );
  return (
    <Reanimated.View entering={riseIn()} style={styles.stack}>
      <Note tone="warning" focus>
        {words.warning}
      </Note>
      {error ? <Note tone="error">{error}</Note> : null}
      {review ? (
        <>
          <Line
            label={words.arrives}
            value={words.sats(formatSats(review.amountSats))}
          />
          <Line
            label={words.fees}
            value={words.sats(formatSats(review.feeSats))}
          />
          <CopyChip
            label={words.address}
            value={review.destination}
            glyph="pin"
          />
          <Note>{words.estimate}</Note>
          {busy ? (
            <Working accessibilityLabel={words.working} />
          ) : (
            <HoldConfirm
              key={review.id}
              label={words.send}
              hint={words.hold}
              onCommit={submit}
            />
          )}
        </>
      ) : (
        <>
          <Field
            label={words.address}
            value={address}
            onChangeText={change}
            mono
            multiline
            autoCapitalize="none"
            editable={!busy}
            focus
          />
          <Action
            label={words.scan}
            glyph="scan"
            tone="quiet"
            disabled={busy}
            onPress={() => setScanning(true)}
          />
          <Action
            label={words.paste}
            glyph="copy"
            tone="quiet"
            disabled={busy}
            onPress={() =>
              run(async revision => {
                const value = await duringSystemPrompt(() =>
                  Clipboard.getString(),
                );
                if (alive.current && revision === operation.current)
                  change(validate(value));
              })
            }
          />
          <Action
            label={words.review}
            glyph="check"
            disabled={busy || disabled || !address.trim()}
            busy={busy}
            onPress={() =>
              run(async revision => {
                const next = await client.prepareDrain({
                  address: validate(address),
                });
                if (alive.current && revision === operation.current)
                  setReview(next);
              })
            }
          />
        </>
      )}
      <Link label={words.keep} tone="steam" disabled={busy} onPress={keep} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  scanner: { flex: 1 },
});
