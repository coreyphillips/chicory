import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { DEFAULT_PRIMARY_URI } from '@beignet/wallet-core';
import type { Network, WalletSnapshot } from '@beignet/wallet-core';
import { RecoveryPhrase } from '../components/RecoveryPhrase';
import { announce } from '../design/announce';
import { copy } from '../design/copy';
import { haptics } from '../design/haptics';
import { palette } from '../design/palette';
import { dropOut, riseIn } from '../motion/presets';
import { Diagnostics } from '../scenes/settings/Diagnostics';
import {
  Action,
  Body,
  Breathe,
  CopyLine,
  Field,
  Line,
  Link,
  NetworkChoice,
  Note,
  Row,
  Section,
  SettingsNetwork,
  Toggle,
  testNetwork,
} from '../scenes/settings/ui';
import { duringSystemPrompt } from '../stage/systemPrompt';
import { useHapticsPreference } from '../services/hapticsPreference';
import type { WalletAdapter } from '../services/wallet';
import { NETWORKS, loadNetworkPreferences } from '../services/networks';
import type { NetworkProfile } from '../services/networks';
import { NetworkSettings } from './NetworkSettings';
import { useSettingsOutcome } from '../services/settingsOutcome';
import type { SettingsOutcome } from '../services/settingsOutcome';
import {
  BIOMETRY_NAMES,
  isLockEnabled,
  requireUnlock,
  setLockEnabled,
  supportedBiometry,
} from '../services/lock';
import type { BiometryKind } from '../services/lock';
import { APP_VERSION } from '../version';
import { space, type } from '../theme';

// The new wallet sheet and the picker are drawn in the Settings language
// too, and the suites find them here.
export { CreateWalletScreen } from '../scenes/settings/CreateWallet';
export { WalletPicker } from '../scenes/settings/WalletPicker';

const words = copy.settings;

/**
 * A setting's result, as the browser app reports it: in flight, saved, saved
 * with a caveat, or refused with the reason. It rises in with its glyph
 * drawing, is felt, and is read out, since it may land well after the tap.
 */
function Outcome({ outcome }: { outcome: SettingsOutcome }) {
  useEffect(() => {
    if (outcome.phase === 'success') haptics.success();
    if (outcome.phase === 'warning') haptics.warning();
    if (outcome.phase === 'error') haptics.error();
    if (outcome.phase === 'success' || outcome.phase === 'warning')
      announce(outcome.message);
  }, [outcome]);
  if (outcome.phase === 'idle') return null;
  return (
    <Note key={`${outcome.phase}:${outcome.message}`} tone={outcome.phase}>
      {outcome.message}
    </Note>
  );
}

/**
 * The wallet this is: its name, the network it is on, and the way to another
 * network. Choosing a network only proposes it; the switch is its own press,
 * with the line about what the other network keeps. The servers behind each
 * network open below, in place.
 */
function WalletSection({
  snapshot,
  index,
  busy,
  switchError,
  onNetwork,
}: {
  snapshot: WalletSnapshot;
  index: number;
  busy: boolean;
  switchError: string;
  onNetwork: (profile: NetworkProfile) => Promise<void>;
}) {
  const current = snapshot.wallet.network;
  const [editing, setEditing] = useState(false);
  // Switching networks used to mean opening a settings sub-form, filling in
  // server fields and pressing apply. The network itself is the thing people
  // want to change, so it lives here; the servers stay behind the editor.
  const [target, setTarget] = useState<Network>(current);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    setTarget(current);
  }, [current]);
  async function switchTo(network: Network) {
    if (switching || network === current) return;
    setSwitching(true);
    try {
      const preferences = await loadNetworkPreferences();
      await onNetwork(preferences.profiles[network]);
    } catch {
      // The reason is held by the session, which outlives this screen: a
      // switch replaces it with a full-page wait, so anything set here would
      // be unmounted before it could be read.
      setTarget(current);
    } finally {
      setSwitching(false);
    }
  }
  return (
    <Section glyph="wallet" title={words.wallet.heading} index={index}>
      <Line label={words.wallet.name} value={snapshot.wallet.name} />
      {editing ? null : (
        <NetworkChoice
          options={NETWORKS}
          value={target}
          disabled={switching || busy}
          onChange={setTarget}
        />
      )}
      {!editing && target !== current ? (
        <Reanimated.View
          entering={riseIn()}
          exiting={dropOut(8)}
          style={styles.stack}
        >
          <Note glyph={testNetwork(target) ? 'flask' : 'info'}>
            {words.wallet.switchNote(target)}
          </Note>
          <Action
            label={words.wallet.switchTo(target)}
            glyph="swap"
            busy={switching}
            onPress={() => switchTo(target)}
          />
        </Reanimated.View>
      ) : null}
      {switchError ? <Note tone="error">{switchError}</Note> : null}
      <Row
        glyph="cog"
        label={words.wallet.servers}
        accessibilityLabel={words.wallet.serversLabel}
        expanded={editing}
        onPress={() => setEditing(!editing)}
      />
      {editing ? (
        <Reanimated.View entering={riseIn()} exiting={dropOut(8)}>
          <NetworkSettings
            initialNetwork={current}
            busy={busy}
            onApply={onNetwork}
          />
        </Reanimated.View>
      ) : null}
    </Section>
  );
}

/** Whether the primary node is connected: a sage dot, or a breathing honey one. */
function Connection({ connected }: { connected: boolean }) {
  return (
    <View style={styles.connection}>
      <Breathe on={!connected}>
        <View
          style={[
            styles.dot,
            { backgroundColor: connected ? palette.sage : palette.honey },
          ]}
        />
      </Breathe>
      <Text style={styles.connectionText}>
        {connected ? words.primary.connected : words.primary.connecting}
      </Text>
    </View>
  );
}

/**
 * The node trusted for instant funding: whether it is connected, how its
 * setup went, its address, and a change that reports saving and reconnecting
 * as two separate outcomes.
 */
function PrimarySection({
  snapshot,
  index,
  outcome,
  busy,
  onSave,
  onRetry,
}: {
  snapshot: WalletSnapshot;
  index: number;
  outcome: SettingsOutcome;
  busy: boolean;
  onSave: (uri: string, done: () => void) => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  // Closing the editor removes the field a screen reader was on, so it goes
  // back to the control that opened it.
  const [closed, setClosed] = useState(false);
  const close = () => {
    setEditing(false);
    setClosed(true);
  };
  const [primary, setPrimary] = useState(
    snapshot.primary.uri || DEFAULT_PRIMARY_URI,
  );
  // The node field follows the wallet it describes: a wallet whose primary is
  // filled in once setup completes, or a different wallet altogether, must not
  // leave the previous address one tap from being saved.
  useEffect(() => {
    setPrimary(snapshot.primary.uri || DEFAULT_PRIMARY_URI);
  }, [snapshot.primary.uri]);
  const p = words.primary;
  return (
    <Section
      glyph="bolt"
      title={p.heading}
      index={index}
      accessory={<Connection connected={snapshot.primary.connected} />}
    >
      <Line label={p.setup} value={snapshot.primary.setup || p.waiting} />
      {snapshot.primary.setupError ? (
        <Note tone="error">{snapshot.primary.setupError}</Note>
      ) : null}
      <Outcome outcome={outcome} />
      {editing ? (
        <Reanimated.View
          entering={riseIn()}
          exiting={dropOut(8)}
          style={styles.stack}
        >
          <Field
            label={p.address}
            value={primary}
            onChangeText={setPrimary}
            autoCapitalize="none"
            multiline
            editable={!busy}
            focus
          />
          <Note>{p.keeps}</Note>
          <Action
            label={p.save}
            glyph="check"
            onPress={() => onSave(primary.trim(), close)}
            busy={busy}
            disabled={!primary.trim()}
          />
          <Link label={p.cancel} tone="steam" disabled={busy} onPress={close} />
        </Reanimated.View>
      ) : (
        <>
          <CopyLine
            label={p.address}
            value={snapshot.primary.uri || p.none}
            copyLabel={p.copy}
            copiedLabel={p.copied}
          />
          <Link
            label={p.change}
            glyph="pencil"
            disabled={busy}
            focus={closed}
            onPress={() => {
              setEditing(true);
              setClosed(false);
            }}
          />
          {!snapshot.primary.connected ? (
            <Action
              label={p.retry}
              glyph="refresh"
              tone="quiet"
              onPress={onRetry}
              busy={busy}
            />
          ) : null}
        </>
      )}
    </Section>
  );
}

/**
 * The app lock, when this device can offer one. Turning it on asks for the
 * biometric at once (`setLockEnabled`), and that prompt is one the app raised
 * (`duringSystemPrompt`), so Settings stays in view behind it rather than
 * going under the privacy cover. Turning it off asks for nothing.
 */
function AppLock() {
  const [kind, setKind] = useState<BiometryKind | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([supportedBiometry(), isLockEnabled()])
      .then(([supported, on]) => {
        if (!active) return;
        setKind(supported);
        setEnabled(on);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!kind) return <Body>{words.phone.noLock}</Body>;
  const name = BIOMETRY_NAMES[kind];
  return (
    <>
      <Toggle
        label={words.phone.require(name)}
        accessibilityLabel={words.phone.requireLabel(name)}
        value={enabled}
        disabled={busy}
        onValueChange={async next => {
          setBusy(true);
          setError('');
          try {
            await (next
              ? duringSystemPrompt(() => setLockEnabled(true))
              : setLockEnabled(false));
            setEnabled(next);
          } catch (e) {
            setError(e instanceof Error ? e.message : words.phone.lockFailed);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <Note tone="error">{error}</Note> : null}
    </>
  );
}

/**
 * Settings > Haptics (REDESIGN.md rule 7), the only thing that silences
 * them. Reading it here also applies it, until the app does so at launch.
 */
function Haptics() {
  const { on, set } = useHapticsPreference();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <Toggle
        label={words.phone.haptics}
        accessibilityLabel={words.phone.haptics}
        value={on}
        disabled={busy}
        onValueChange={async next => {
          setBusy(true);
          setError('');
          try {
            await set(next);
            // Turning them back on is felt at once, so it is known to work.
            if (next) haptics.tick();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : words.phone.hapticsFailed,
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <Note tone="error">{error}</Note> : null}
    </>
  );
}

/**
 * Start over on this phone. The action sits behind a link and a second,
 * explicit button, and behind the app lock when one is on, because it deletes
 * keys and channel state that a phrase alone does not bring back. The lock's
 * prompt is one the app raised (`duringSystemPrompt`), so the warning stays
 * in view behind it.
 */
function EraseWallet({ onErase }: { onErase: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  // Keeping the wallet removes the button a screen reader was on, so it goes
  // back to the link that asked.
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const e = words.erase;
  if (!confirming)
    return (
      <Link
        label={e.link}
        tone="radish"
        focus={kept}
        onPress={() => {
          haptics.warning();
          setConfirming(true);
        }}
      />
    );
  return (
    <Reanimated.View
      entering={riseIn()}
      exiting={dropOut(8)}
      style={styles.stack}
    >
      <Note tone="warning" focus>
        {e.warning}
      </Note>
      {error ? <Note tone="error">{error}</Note> : null}
      <Action
        label={e.confirm}
        tone="danger"
        glyph="alert"
        busy={busy}
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const confirmed = await duringSystemPrompt(() =>
              requireUnlock(e.prompt),
            );
            if (!confirmed) throw new Error(e.unconfirmed);
            await onErase();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : e.failed);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Link
        label={e.keep}
        tone="steam"
        disabled={busy}
        onPress={() => {
          setConfirming(false);
          setKept(true);
          setError('');
        }}
      />
    </Reanimated.View>
  );
}

/** Settings' sections, top to bottom, when no backup is waiting. */
const ORDER = [
  'wallet',
  'recovery',
  'primary',
  'phone',
  'diagnostics',
  'leave',
] as const;
type Part = (typeof ORDER)[number];

/**
 * Settings, the one scene that keeps words (REDESIGN.md rule 2), trimmed to
 * what a person comes here to do: the wallet and its network, the recovery
 * phrase, the primary node, this phone's lock and haptics, diagnostics, and
 * the ways out of this wallet. Every safety line stays.
 *
 * While the recovery phrase still has to be saved, its section leads the
 * page in honey. Once the hold confirms it, it slides back to its place and
 * the others close up around it, the same instance throughout.
 *
 * On a test network the page draws in slate wherever it would draw bloom.
 */
export function SettingsScreen({
  snapshot,
  client,
  switchError,
  onDisconnect,
  onChooseWallet,
  onRefresh,
  onNetwork,
  onErase,
  backupPending = false,
  onBackupSaved,
}: {
  snapshot: WalletSnapshot;
  client: WalletAdapter;
  /** Why the last network switch failed. It outlives the screen that ran it. */
  switchError: string;
  onDisconnect: () => void;
  onChooseWallet: () => void;
  onRefresh: () => void;
  onNetwork: (profile: NetworkProfile) => Promise<void>;
  /** Erase every device wallet from this phone. Device mode only. */
  onErase?: () => Promise<void>;
  /** The recovery phrase has not been confirmed as saved yet. */
  backupPending?: boolean;
  /** The owner held to confirm the phrase is written down. */
  onBackupSaved?: () => void;
}) {
  // null while the wallet is being asked; '' when it reports no version.
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const { outcome, run, busy } = useSettingsOutcome();

  useEffect(() => {
    let active = true;
    // A version label is a courtesy. It must never be able to take Settings
    // down, which is the one screen someone reaches for when things are wrong.
    Promise.resolve()
      .then(() => client.getConfig?.())
      .then(config => {
        if (active) setEngineVersion(config?.engineVersion || '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  async function savePrimary(uri: string, done: () => void) {
    await run(words.primary.saving, async () => {
      await client.updatePrimary(uri);
      done();
      onRefresh();
      // The change has committed. Whether the wallet has reconnected to it is a
      // separate question, answered by a fresh read rather than the snapshot
      // this screen rendered with, which still describes the old node. Saying
      // "saved" when it has not reconnected would invite a second change that
      // is not needed.
      let connected = false;
      try {
        const fresh = await client.snapshot();
        connected =
          fresh.primary.connected && fresh.wallet.lfbw?.setup !== 'failed';
      } catch {
        // The change is committed either way; an unreadable snapshot is a
        // warning, never an unsaved setting.
      }
      return connected
        ? { phase: 'success' as const, message: words.primary.updated }
        : { phase: 'warning' as const, message: words.primary.notReconnected };
    });
  }

  async function retry() {
    await run(words.primary.reconnecting, async () => {
      await client.retrySetup();
      onRefresh();
      return { phase: 'success' as const, message: words.primary.retried };
    });
  }

  const saving = backupPending && !!onBackupSaved;
  const order: Part[] = saving
    ? ['recovery', ...ORDER.filter(part => part !== 'recovery')]
    : [...ORDER];
  const at = (part: Part) => order.indexOf(part);
  const parts: Record<Part, ReactNode> = {
    wallet: (
      <WalletSection
        key="wallet"
        snapshot={snapshot}
        index={at('wallet')}
        busy={busy}
        switchError={switchError}
        onNetwork={onNetwork}
      />
    ),
    recovery: (
      <RecoveryPhrase
        key="recovery"
        index={at('recovery')}
        loadPhrase={() => client.getRecoveryPhrase()}
        onSaved={saving ? onBackupSaved : undefined}
      />
    ),
    primary: (
      <PrimarySection
        key="primary"
        snapshot={snapshot}
        index={at('primary')}
        outcome={outcome}
        busy={busy}
        onSave={savePrimary}
        onRetry={retry}
      />
    ),
    phone: (
      <Section
        key="phone"
        glyph="lock"
        title={words.phone.heading}
        index={at('phone')}
      >
        <AppLock />
        <Haptics />
      </Section>
    ),
    diagnostics: (
      <Diagnostics
        key="diagnostics"
        client={client}
        index={at('diagnostics')}
      />
    ),
    leave: (
      <Section key="leave" index={at('leave')}>
        <Row
          glyph="wallet"
          label={words.wallet.chooseAnother}
          onPress={onChooseWallet}
        />
        <Row glyph="lock" label={words.wallet.lock} onPress={onDisconnect} />
        {onErase ? <EraseWallet onErase={onErase} /> : null}
      </Section>
    ),
  };

  return (
    <SettingsNetwork network={snapshot.wallet.network}>
      <View style={styles.page}>
        {order.map(part => parts[part])}
        <Text style={styles.about}>
          {engineVersion
            ? `${words.about.app(APP_VERSION)} · ${words.about.engine(
                engineVersion,
              )}`
            : words.about.app(APP_VERSION)}
        </Text>
      </View>
    </SettingsNetwork>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.md },
  stack: { gap: space.md },
  connection: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  connectionText: { ...type.meta, color: palette.steam },
  about: {
    ...type.meta,
    color: palette.steam,
    textAlign: 'center',
    marginTop: space.xs,
  },
});
