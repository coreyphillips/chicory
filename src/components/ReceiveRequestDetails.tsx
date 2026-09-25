import React, { useEffect, useRef, useState } from 'react';
import {
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Reanimated from 'react-native-reanimated';
import type { Activity, ReceiveRequest } from '@beignet/wallet-core';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { QrBloom } from '../glyphs/QrBloom';
import { riseIn, sceneOut } from '../motion/presets';
import { ErrorPip, GlyphButton } from '../scenes/receive/controls';
import { detailFace, requestRails } from '../scenes/receive/model';
import { useNow } from '../services/clock';
import { recordDiagnostic } from '../services/diagnosticLog';
import { usePaneActive } from '../stage/panes/Pane';
import { radius, space, type as typography } from '../theme';
import type { WalletAdapter } from '../services/wallet';
import { useToast } from './Toast';

/**
 * The request a payment was asked for with, as its detail keeps it
 * (REDESIGN.md 6, Detail). While it can still be paid its code blooms and it
 * can be shared or copied; once it is paid, expired or its address reused,
 * the code goes and so do share and copy, and the request string stays as
 * the record. How it can be paid is a row of glyphs whose label says it.
 *
 * An older request saved only its Lightning invoice. Its original request
 * can be linked back with the chain and plus, which opens a well to paste
 * the original into.
 */
export function ReceiveRequestDetails({
  item,
  client,
  onRefresh,
  onBusy,
}: {
  item: Activity;
  client?: WalletAdapter;
  onRefresh?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const live = usePaneActive();
  const [original, setOriginal] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<ReceiveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const working = useRef(false);
  const generation = useRef({ active: true });
  const { width } = useWindowDimensions();
  useEffect(() => {
    const lifetime = { active: true };
    generation.current = lifetime;
    return () => {
      lifetime.active = false;
    };
  }, [client, item.id]);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const request =
    item.receiveRequest && !item.receiveRequest.legacy
      ? item.receiveRequest
      : linked || item.receiveRequest;
  // The countdown only runs while there is a request to count down.
  const now = useNow(1000, !!request);
  if (!request) return null;
  const legacy = 'legacy' in request && !!request.legacy;
  const face = detailFace(item, request, now);
  const { shareable } = face;
  const reused = request.bitcoinTracking === 'ambiguous';
  const how = legacy
    ? copy.receive.legacy
    : reused
    ? copy.receive.reusedAddress
    : requestRails(request).length > 1
    ? copy.receive.unified
    : copy.receive.lightningOnly;

  /**
   * A link or a share that failed: the bang beside the controls, an error
   * haptic, the whole message at once for a screen reader, and the log.
   */
  function fail(said: string, code?: string) {
    haptics.error();
    setError(said);
    announce(said, { assertive: true });
    recordDiagnostic({ phase: 'ui', message: said, code });
  }

  async function link() {
    if (!client || !item.paymentHash || working.current || !original.trim())
      return;
    working.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    try {
      const result = await client.importReceiveRequest(
        original.trim(),
        item.paymentHash,
      );
      if (!current.active) return;
      setLinked(result);
      setOriginal('');
      setLinking(false);
      onRefresh?.();
    } catch (e) {
      if (current.active)
        fail(
          e instanceof Error ? e.message : copy.receive.linkFailed,
          (e as { code?: string })?.code,
        );
    } finally {
      working.current = false;
      if (current.active) setBusy(false);
    }
  }

  async function paste() {
    const current = generation.current;
    const text = await Clipboard.getString();
    if (current.active && text) setOriginal(text.trim());
  }

  return (
    <View style={styles.card}>
      {face.qr ? (
        <View style={styles.qr}>
          <QrBloom
            value={request.uri}
            size={Math.min(220, Math.max(150, width - 160))}
            state={face.qr}
            accessibilityLabel={
              legacy ? copy.receive.legacyQr : copy.receive.originalQr
            }
          />
        </View>
      ) : null}
      <View accessible accessibilityLabel={how} style={styles.rails}>
        {requestRails({ ...request, legacy }).map(rail => (
          <Glyph key={rail} name={rail} size={16} color={palette.steam} />
        ))}
        {reused ? <Glyph name="twin" size={16} color={palette.honey} /> : null}
      </View>
      <View
        accessible
        accessibilityLabel={
          legacy ? copy.receive.legacyInvoice : copy.receive.original
        }
        accessibilityValue={{ text: request.uri }}
      >
        <Text
          selectable={shareable}
          style={[styles.request, !shareable && styles.kept]}
        >
          {request.uri}
        </Text>
      </View>
      {error ? <ErrorPip message={error} /> : null}
      <View style={styles.controls}>
        {shareable ? (
          <>
            <GlyphButton
              glyph="share"
              label={copy.receive.shareOriginal}
              size={48}
              disabled={busy}
              onPress={() => {
                if (!working.current)
                  Share.share({ message: request.uri }).catch(() =>
                    fail(copy.receive.shareFailed),
                  );
              }}
            />
            <GlyphButton
              glyph="copy"
              label={copy.receive.copyOriginal}
              size={48}
              disabled={busy}
              onPress={() => {
                if (working.current) return;
                Clipboard.setString(request.uri);
                toast(copy.receive.originalCopied, 'success', 'copy');
              }}
            />
          </>
        ) : null}
        {legacy && client && item.paymentHash && !linking ? (
          <GlyphButton
            glyph="linkPlus"
            label={copy.receive.linkOriginal}
            size={48}
            onPress={() => setLinking(true)}
          />
        ) : null}
        {linked ? (
          <Reanimated.View
            entering={riseIn(8)}
            accessible
            accessibilityLabel={copy.receive.linked}
            style={styles.linked}
          >
            <Glyph name="check" size={20} color={palette.sage} />
          </Reanimated.View>
        ) : null}
      </View>
      {legacy && client && item.paymentHash && linking ? (
        <Reanimated.View
          entering={riseIn(8)}
          exiting={sceneOut()}
          style={styles.linking}
        >
          <View style={styles.well}>
            <TextInput
              accessibilityLabel={copy.receive.original}
              accessibilityHint={copy.receive.originalHint}
              value={original}
              onChangeText={live ? setOriginal : undefined}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              editable={!busy}
              selectionColor={palette.bloom}
              style={styles.field}
            />
            <GlyphButton
              glyph="clipboard"
              label={copy.receive.paste}
              size={48}
              disabled={busy}
              onPress={() => {
                paste().catch(() => {});
              }}
            />
          </View>
          <View style={styles.controls}>
            <GlyphButton
              glyph="close"
              label={copy.receive.cancelLink}
              size={48}
              disabled={busy}
              onPress={() => {
                setLinking(false);
                setOriginal('');
                setError('');
              }}
            />
            <GlyphButton
              glyph="linkPlus"
              label={copy.receive.link}
              size={56}
              tone="primary"
              busy={busy}
              disabled={!original.trim()}
              onPress={link}
            />
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: palette.espresso,
    gap: space.md,
    alignItems: 'center',
  },
  qr: { alignItems: 'center' },
  rails: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  request: {
    ...typography.mono,
    fontSize: 11,
    lineHeight: 18,
    color: palette.cream,
  },
  kept: { color: palette.steam },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  linked: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.sageSoft,
  },
  linking: { alignSelf: 'stretch', gap: space.md },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.bark,
  },
  field: {
    ...typography.mono,
    flex: 1,
    minHeight: 88,
    paddingHorizontal: space.sm,
    color: palette.cream,
    textAlignVertical: 'top',
  },
});
