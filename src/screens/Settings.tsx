import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { DEFAULT_PRIMARY_URI } from '@beignet/wallet-core';
import type {
  CreatedWallet,
  HostConfig,
  Network,
  WalletDiagnostics,
  WalletRecord,
  WalletSnapshot,
} from '@beignet/wallet-core';
import {
  Body,
  Button,
  Card,
  Divider,
  Eyebrow,
  Field,
  Icon,
  LinkButton,
  ListRow,
  Notice,
  Row,
  Segmented,
  StatusDot,
  Title,
} from '../components/ui';
import { CopyValue } from '../components/CopyValue';
import { RecoveryPhrase } from '../components/RecoveryPhrase';
import { colors, number, radius, space, type as typography } from '../theme';
import type { WalletAdapter } from '../services/wallet';
import {
  NETWORKS,
  defaultProfile,
  loadNetworkPreferences,
} from '../services/networks';
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
import { seedSourceNetwork } from '../embedded/seed';
import { recentDiagnostics } from '../services/diagnosticLog';

export function WalletPicker({
  wallets,
  busy = false,
  onSelect,
  onCreate,
}: {
  wallets: WalletRecord[];
  busy?: boolean;
  onSelect: (wallet: WalletRecord) => void;
  onCreate: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Title>{wallets.length ? 'Choose your wallet.' : 'Create a wallet.'}</Title>
      {wallets.map(wallet => (
        <Pressable
          key={wallet.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${wallet.name}`}
          accessibilityHint="Starts this wallet and opens it."
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={() => onSelect(wallet)}
          style={({ pressed }) => [styles.wallet, pressed && styles.pressed]}
        >
          <View style={styles.walletIcon}>
            <Icon name="wallet" color={colors.primary} size={21} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.walletName}>{wallet.name}</Text>
            <Text style={styles.walletMeta}>
              {wallet.network} · {wallet.status}
            </Text>
          </View>
          <Icon name="chevron" size={17} color={colors.faint} />
        </Pressable>
      ))}
      {wallets.length === 0 ? (
        <Button
          label={busy ? 'Opening wallet…' : 'Create a wallet'}
          accessibilityLabel="Create a wallet"
          disabled={busy}
          busy={busy}
          secondary={wallets.length > 0}
          icon="plus"
          onPress={onCreate}
        />
      ) : null}
    </View>
  );
}

export function CreateWalletScreen({
  client,
  profile,
  initialRestoring = false,
  onCreated,
  onBusy,
}: {
  client: WalletAdapter;
  profile?: NetworkProfile;
  /** Open straight into the recovery-phrase form. */
  initialRestoring?: boolean;
  onCreated: (wallet: WalletRecord) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [name, setName] = useState('Everyday wallet');
  const [network, setNetwork] = useState<'mainnet' | 'regtest' | 'testnet'>(
    profile?.network || 'mainnet',
  );
  const [primary, setPrimary] = useState(
    profile?.primaryUri ?? DEFAULT_PRIMARY_URI,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedWallet | null>(null);
  // Restoring means the owner already holds the phrase: it is typed in here,
  // sent once, and never shown back.
  const [restoring, setRestoring] = useState(initialRestoring);
  const [phrase, setPhrase] = useState('');
  const phraseWords = phrase.trim().split(/\s+/).filter(Boolean).length;
  const phraseReady = phraseWords === 12 || phraseWords === 24;
  const [config, setConfig] = useState<HostConfig | null>(null);
  // Which existing wallet, if any, will supply this one's recovery phrase.
  // Creating a wallet on another network reuses the original seed, but the flow
  // said nothing about it, so it read as an entirely new wallet.
  const [seedSource, setSeedSource] = useState<'mainnet' | 'testnet' | 'regtest' | null>(null);
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    seedSourceNetwork()
      .then(value => active && setSeedSource(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const reusesPhrase = !restoring && !!seedSource && seedSource !== network;
  useEffect(() => {
    let active = true;
    client
      .getConfig()
      .then(value => {
        if (active) setConfig(value);
      })
      .catch(e => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Could not read this wallet's server settings.",
          );
      });
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    onBusy(busy || !!created);
    return () => onBusy(false);
  }, [busy, created, onBusy]);
  function chooseNetwork(value: 'mainnet' | 'regtest' | 'testnet') {
    setNetwork(value);
    // One source for what a network starts with, so this form and the network
    // settings cannot disagree about a default.
    setPrimary(defaultProfile(value).primaryUri);
  }
  async function create() {
    if (working.current) {
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const wallet = await client.createWallet({
        name: name.trim(),
        network,
        primaryUri: primary.trim(),
        // The engine is already configured for this network's server. The
        // record keeps it so a later open knows where this wallet was reading
        // the chain from.
        ...(profile?.electrum.host.trim()
          ? { electrum: profile.electrum }
          : {}),
        ...(restoring ? { mnemonic: phrase } : {}),
      });
      if (restoring) {
        // The phrase came from the owner; there is nothing new to write down.
        setPhrase('');
        const record = { ...wallet };
        delete record.mnemonic;
        if (record.warnings?.length) setCreated(record);
        else await onCreated(record);
      } else if (wallet.mnemonic) {
        setCreated(wallet);
      } else {
        // A wallet that committed without returning a phrase still carries any
        // warning the engine raised; surface it rather than dropping it.
        if (wallet.warnings?.length) setCreated(wallet);
        else await onCreated(wallet);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : restoring
          ? 'Could not restore the wallet.'
          : 'Could not create the wallet.',
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function finishBackup() {
    if (!created || working.current) {
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const record = { ...created };
      delete record.mnemonic;
      delete record.warnings;
      await onCreated(record);
      setCreated(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the wallet.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (created) {
    if (reusesPhrase)
      return (
        <View style={styles.stack}>
          <Title>Wallet created.</Title>
          <Body>
            {`Your ${network} wallet uses the same recovery phrase as your ${seedSource} wallet. A phrase does not restore Lightning channel state.`}
          </Body>
          {created.warnings?.map((warning, index) => (
            <Notice key={index} kind="warning" icon="alert">
              {warning}
            </Notice>
          ))}
          {error ? (
            <Notice kind="error" icon="alert">
              {error}
            </Notice>
          ) : null}
          <Button
            label={`Open ${network} wallet`}
            onPress={finishBackup}
            busy={busy}
          />
          <RecoveryPhrase initialPhrase={created.mnemonic} />
        </View>
      );
    return (
      <View style={styles.stack}>
        <Title>Save your recovery phrase.</Title>
        {created.warnings?.map((warning, index) => (
          <Notice key={index} kind="warning" icon="alert">
            {warning}
          </Notice>
        ))}
        {error ? (
          <Notice kind="error" icon="alert">
            {error}
          </Notice>
        ) : null}
        {created.mnemonic ? (
          <RecoveryPhrase
            initialPhrase={created.mnemonic}
            onSaved={finishBackup}
          />
        ) : (
          <Button label="Open wallet" onPress={finishBackup} busy={busy} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Title>{restoring ? 'Restore a wallet' : 'New wallet'}</Title>
      {restoring ? (
        <Body>A phrase restores keys and on-chain funds, not Lightning channel state.</Body>
      ) : null}
      {restoring ? (
        <Field
          label="Recovery phrase"
          placeholder="12 or 24 words, separated by spaces"
          value={phrase}
          onChangeText={setPhrase}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={false}
          editable={!busy}
          hint={
            phraseWords && !phraseReady
              ? `${phraseWords} words so far. A phrase has 12 or 24.`
              : undefined
          }
        />
      ) : null}
      <Field
        label="Wallet name"
        value={name}
        onChangeText={setName}
        maxLength={60}
        editable={!busy}
      />
      <Eyebrow>Network</Eyebrow>
      {profile ? (
        <Body>{network}</Body>
      ) : (
        <View style={styles.networks}>
          {(['mainnet', 'regtest', 'testnet'] as const).map(value => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={value}
              accessibilityState={{ selected: value === network }}
              disabled={busy}
              onPress={() => chooseNetwork(value)}
              style={[
                styles.network,
                value === network && styles.networkActive,
              ]}
            >
              <Text
                style={[
                  styles.networkText,
                  value === network && styles.networkTextActive,
                ]}
              >
                {value}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Field
        label="Primary node"
        value={primary}
        onChangeText={setPrimary}
        multiline
        autoCapitalize="none"
        editable={!busy}
      />
      {reusesPhrase ? (
        <Notice icon="key">
          {`Uses the same recovery phrase as your ${seedSource} wallet.`}
        </Notice>
      ) : null}
      <Notice kind={network === 'mainnet' ? 'warning' : 'info'} icon="info">
        {network === 'mainnet'
          ? 'This creates a real mainnet wallet. The primary node is trusted for instant funding.'
          : 'Use a primary node on this test network.'}
      </Notice>
      <Row
        label="Bitcoin server"
        value={
          config?.defaultElectrum
            ? `${config.defaultElectrum.host}:${config.defaultElectrum.port}`
            : 'Device setting'
        }
      />
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      <Button
        label={restoring ? `Restore ${network} wallet` : `Create ${network} wallet`}
        busy={busy}
        disabled={
          !name.trim() || !primary.trim() || (restoring && !phraseReady)
        }
        onPress={create}
      />
      <LinkButton
        label={
          restoring
            ? 'Create a new wallet instead'
            : 'I already have a recovery phrase'
        }
        disabled={busy}
        onPress={() => {
          setRestoring(!restoring);
          setPhrase('');
          setError('');
        }}
      />
    </View>
  );
}

/**
 * Start over on this phone. The action sits behind a link and a second,
 * explicit button, and behind the app lock when one is on, because it deletes
 * keys and channel state that a phrase alone does not bring back.
 */
function EraseWallet({ onErase }: { onErase: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!confirming)
    return (
      <LinkButton
        label="Erase wallet from this phone"
        tone="muted"
        onPress={() => setConfirming(true)}
      />
    );
  return (
    <Card>
      <Eyebrow>Erase wallet</Eyebrow>
      <Notice kind="warning" icon="alert">
        Deletes this wallet's keys, channel state and history from this phone,
        on every network. Without the recovery phrase and current channel
        state, funds are lost.
      </Notice>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      <Button
        label="Erase wallet"
        variant="danger"
        icon="alert"
        busy={busy}
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            if (!(await requireUnlock('Confirm to erase this wallet')))
              throw new Error('The wallet was not erased because this was not confirmed.');
            await onErase();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : 'Could not erase the wallet.',
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      <LinkButton
        label="Keep my wallet"
        tone="muted"
        disabled={busy}
        onPress={() => {
          setConfirming(false);
          setError('');
        }}
      />
    </Card>
  );
}

/** The persistent per-card result strip, as the browser app renders it. */
/**
 * What the engine reports about itself, on request. Figures only, the way
 * the shared client reads them: setup, the last channelize decision and the
 * last direct-funding offer, the chain tip, peers, channels, coins. It exists
 * so a stuck move or a refused payer can be read off the phone instead of
 * guessed at.
 */
function DiagnosticsCard({ client }: { client: WalletAdapter }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<WalletDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setReport(await client.diagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read diagnostics.');
    } finally {
      setBusy(false);
    }
  };
  // Serializing the whole report on every Settings render, collapsed or not.
  const text = useMemo(
    () =>
      open && report
        ? JSON.stringify({ ...report, events: recentDiagnostics() }, null, 1)
        : '',
    [open, report],
  );
  return (
    <Card>
      <View style={styles.cardHeading}>
        <Eyebrow>Diagnostics</Eyebrow>
        <LinkButton
          label={open ? 'Hide' : 'Show'}
          disabled={busy}
          onPress={() => {
            setOpen(!open);
            if (!open && !report) load();
          }}
        />
      </View>
      {open ? (
        <>
          {error ? (
            <Notice kind="error" icon="alert">
              {error}
            </Notice>
          ) : null}
          {report ? (
            <Text selectable style={styles.diagnostics}>
              {text}
            </Text>
          ) : null}
          <View style={styles.networks}>
            <LinkButton label="Refresh" disabled={busy} onPress={load} />
            <LinkButton
              label="Copy"
              disabled={!report}
              onPress={() => Clipboard.setString(text)}
            />
          </View>
        </>
      ) : null}
    </Card>
  );
}

function OutcomeStrip({ outcome }: { outcome: SettingsOutcome }) {
  if (outcome.phase === 'idle') return null;
  return (
    <Notice
      kind={
        outcome.phase === 'error'
          ? 'error'
          : outcome.phase === 'warning'
          ? 'warning'
          : outcome.phase === 'success'
          ? 'success'
          : 'info'
      }
      icon={
        outcome.phase === 'error'
          ? 'alert'
          : outcome.phase === 'warning'
          ? 'alert'
          : outcome.phase === 'success'
          ? 'check'
          : 'clock'
      }
    >
      {outcome.message}
    </Notice>
  );
}

function AppLockRow() {
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
  if (!kind)
    return (
      <Body>No biometric or passcode lock is available on this device.</Body>
    );
  const name = BIOMETRY_NAMES[kind];
  return (
    <>
      <View style={styles.switchRow}>
        <Text style={styles.walletName}>{`Require ${name}`}</Text>
        <Switch
          accessibilityLabel={`Require ${name} to open this wallet`}
          value={enabled}
          disabled={busy}
          trackColor={{ true: colors.primary, false: colors.line }}
          thumbColor={colors.text}
          onValueChange={async next => {
            setBusy(true);
            setError('');
            try {
              await setLockEnabled(next);
              setEnabled(next);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Could not change the lock.',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
    </>
  );
}

export function SettingsScreen({
  snapshot,
  client,
  switchError,
  onDisconnect,
  onChooseWallet,
  onRefresh,
  onNetwork,
  onErase,
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
}) {
  const [editingNetwork, setEditingNetwork] = useState(false);
  const [editingPrimary, setEditingPrimary] = useState(false);
  const [primary, setPrimary] = useState(
    snapshot.primary.uri || DEFAULT_PRIMARY_URI,
  );
  // null while the wallet is being asked; '' when it reports no version.
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  // Switching networks used to mean opening a settings sub-form, filling in
  // server fields and pressing apply. The network itself is the thing people
  // want to change, so it lives here; the servers stay behind the editor.
  const [target, setTarget] = useState<Network>(snapshot.wallet.network);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    setTarget(snapshot.wallet.network);
  }, [snapshot.wallet.network]);
  // The node field follows the wallet it describes: a wallet whose primary is
  // filled in once setup completes, or a different wallet altogether, must not
  // leave the previous address one tap from being saved.
  useEffect(() => {
    setPrimary(snapshot.primary.uri || DEFAULT_PRIMARY_URI);
  }, [snapshot.primary.uri]);
  const { outcome, run, busy } = useSettingsOutcome();

  async function switchTo(network: Network) {
    if (switching || network === snapshot.wallet.network) return;
    setSwitching(true);
    try {
      const preferences = await loadNetworkPreferences();
      await onNetwork(preferences.profiles[network]);
    } catch {
      // The reason is held by the session, which outlives this screen: a
      // switch replaces it with a full-page wait, so anything set here would
      // be unmounted before it could be read.
      setTarget(snapshot.wallet.network);
    } finally {
      setSwitching(false);
    }
  }

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

  async function savePrimary() {
    await run('Saving your primary node…', async () => {
      await client.updatePrimary(primary.trim());
      setEditingPrimary(false);
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
        ? {
            phase: 'success' as const,
            message:
              'Primary node updated. Existing channels remain available.',
          }
        : {
            phase: 'warning' as const,
            message:
              'Primary node saved. Your wallet has not reconnected to it yet; existing channels remain available.',
          };
    });
  }

  async function retry() {
    await run('Reconnecting…', async () => {
      await client.retrySetup();
      onRefresh();
      return {
        phase: 'success' as const,
        message: 'Connection setup requested. Your wallet will update shortly.',
      };
    });
  }

  return (
    <View style={styles.stack}>
      <Title>Settings</Title>

      <Card>
        <Eyebrow>Wallet</Eyebrow>
        <Row label="Name" value={snapshot.wallet.name} />
        <Row
          label="Ready to receive"
          value={`${number(snapshot.balance.receivableSats)} sats`}
        />
        <Divider />
        <Eyebrow>Network</Eyebrow>
        <Segmented
          options={NETWORKS}
          value={target}
          disabled={switching || busy}
          onChange={setTarget}
        />
        {target !== snapshot.wallet.network ? (
          <>
            <Body>
              {`${target} keeps its own balance and history. Same recovery phrase.`}
            </Body>
            <Button
              label={`Switch to ${target}`}
              icon="refresh"
              busy={switching}
              onPress={() => switchTo(target)}
            />
          </>
        ) : null}
        {switchError ? (
          <Notice kind="error" icon="alert">
            {switchError}
          </Notice>
        ) : null}
        <ListRow
          label="Network & servers"
          icon="settings"
          value={editingNetwork ? 'Open' : undefined}
          accessibilityLabel="Change network or Bitcoin server"
          onPress={() => setEditingNetwork(!editingNetwork)}
        />
        <ListRow
          label="Choose another wallet"
          icon="wallet"
          onPress={onChooseWallet}
        />
      </Card>

      {editingNetwork ? (
        <NetworkSettings
          initialNetwork={snapshot.wallet.network}
          busy={busy}
          onApply={onNetwork}
        />
      ) : null}

      <Card>
        <Eyebrow>Your connection</Eyebrow>
        <Row
          label="Wallet runs"
          value="On this device"
        />
        <Row
          label="Keys stored"
          value="Encrypted on this device"
        />
      </Card>

      <Card>
        <View style={styles.cardHeading}>
          <Eyebrow>Primary node</Eyebrow>
          <View style={styles.statusPill}>
            <StatusDot tone={snapshot.primary.connected ? 'good' : 'wait'} />
            <Text style={styles.statusText}>
              {snapshot.primary.connected ? 'Connected' : 'Connecting'}
            </Text>
          </View>
        </View>
        <Row label="Setup" value={snapshot.primary.setup || 'Waiting'} />
        {snapshot.primary.setupError ? (
          <Notice kind="error" icon="alert">
            {snapshot.primary.setupError}
          </Notice>
        ) : null}
        <OutcomeStrip outcome={outcome} />
        {editingPrimary ? (
          <>
            <Field
              label="Node address"
              value={primary}
              onChangeText={setPrimary}
              autoCapitalize="none"
              multiline
              editable={!busy}
            />
            <Notice icon="info">
              Existing channels and funds stay. The new node is trusted for
              instant funding.
            </Notice>
            <Button
              label="Save primary node"
              onPress={savePrimary}
              busy={busy}
              disabled={!primary.trim()}
            />
            <LinkButton
              label="Cancel"
              tone="muted"
              disabled={busy}
              onPress={() => setEditingPrimary(false)}
            />
          </>
        ) : (
          <>
            <CopyValue
              label="Node address"
              value={snapshot.primary.uri || 'No primary configured'}
            />
            <LinkButton
              label="Change primary node"
              disabled={busy}
              onPress={() => setEditingPrimary(true)}
            />
            {!snapshot.primary.connected ? (
              <Button
                label="Retry connection"
                secondary
                onPress={retry}
                busy={busy}
              />
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <Eyebrow>Security</Eyebrow>
        <AppLockRow />
      </Card>

      <RecoveryPhrase loadPhrase={() => client.getRecoveryPhrase()} />

      <DiagnosticsCard client={client} />

      <Card>
        <Eyebrow>About</Eyebrow>
        <Row label="App" value={APP_VERSION} />
        {engineVersion !== '' ? (
          <Row label="Engine" value={engineVersion ?? 'Checking…'} />
        ) : null}
      </Card>

      <Button
        label="Lock device wallet"
        variant="danger"
        icon="lock"
        onPress={onDisconnect}
      />
      {onErase ? <EraseWallet onErase={onErase} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs + 2,
    minHeight: 44,
  },
  cardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs + 2,
    backgroundColor: colors.raised,
    paddingHorizontal: space.xs + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  statusText: { ...typography.micro, fontSize: 10, color: colors.muted },
  networks: { flexDirection: 'row', gap: space.xs },
  network: {
    flex: 1,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  networkActive: { backgroundColor: colors.cream, borderColor: colors.cream },
  networkText: { ...typography.caption, color: colors.muted },
  networkTextActive: { color: colors.ink, fontWeight: '700' },
  wallet: {
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    minHeight: 72,
  },
  walletIcon: {
    height: 42,
    width: 42,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.65 },
  walletName: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  walletMeta: { ...typography.caption, color: colors.muted, marginTop: 4 },
  diagnostics: {
    ...typography.caption,
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
});
