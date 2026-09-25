import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  RefreshControl,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WhisperProvider } from '../glyphs/Whisper';
import { useStaleAfter } from '../services/clock';
import { useEnter } from '../services/motion';
import { STALE_AFTER_MS } from '../services/useWalletSession';
import type { useWalletSession } from '../services/useWalletSession';
import { LockScreen } from '../scenes/phases/Locked';
import { Transit } from '../scenes/phases/Transit';
import { Opening } from '../scenes/phases/Opening';
import { Saved } from '../scenes/phases/Saved';
import { Welcome } from '../scenes/phases/Welcome';
import { Picker } from '../scenes/phases/Picker';
import { OpeningWallet } from '../scenes/phases/Loading';
import { OfflineWallet } from '../scenes/phases/Offline';
import { BackupBanner } from '../scenes/shared/BackupBanner';
import { colors, space } from '../theme';
import { Canvas, useCanvasView } from './Canvas';
import type { Backup } from './Canvas';
import { CreateSheet } from './layers/CreateSheet';
import { SceneSlot } from './panes/SceneSlot';
import { backupPending } from './phase';
import type { Phase } from './phase';
import { useBackHandler } from './useBackHandler';
import { useStage } from './StageContext';

type Session = ReturnType<typeof useWalletSession>;

/**
 * The whole app below the providers: the view for the shell phase, or the
 * wallet canvas once there is a wallet to show, and the new wallet sheet
 * above either.
 */
export function Stage({
  phase,
  session,
  onUnlock,
}: {
  phase: Phase;
  session: Session;
  onUnlock: () => void;
}) {
  const { state, actions } = useStage();
  useBackHandler(phase.kind);
  const view = useCanvasView();
  const {
    snapshot,
    client,
    wallets,
    walletId,
    error,
    closing,
    switching,
    connecting,
    selecting,
    refreshing,
    networkEditor,
    activeProfile,
  } = session;
  const stale = useStale(snapshot?.updatedAt);
  const savedWallet = useMemo(
    () => wallets.find(wallet => wallet.id === walletId),
    [wallets, walletId],
  );
  const walletsOnNetwork = useMemo(
    () => wallets.filter(wallet => wallet.network === activeProfile.network),
    [wallets, activeProfile.network],
  );
  const enter = useEnter(phase.kind);

  // The whisper pill is drawn above every phase and the canvas alike, the
  // lock included, from the window's own origin, so it lands where the
  // finger is.
  if (phase.kind === 'locked') {
    return (
      <WhisperProvider>
        <LockScreen
          prompting={phase.prompting}
          error={phase.error}
          onUnlock={onUnlock}
        />
      </WhisperProvider>
    );
  }

  // A pending backup sits above whatever is showing, the Activity list
  // included, rather than replacing it. Each surface draws it its own way.
  const backup: Backup | null = client
    ? {
        pending: backupPending(session),
        loadPhrase: () => client.getRecoveryPhrase(),
        onSaved: session.acknowledgeBackup,
      }
    : null;

  let content: ReactNode = null;
  switch (phase.kind) {
    case 'transit':
      content = (
        <Transit
          erasing={session.erasing}
          closing={closing}
          switchTarget={session.switchTarget}
        />
      );
      break;
    case 'opening':
      content = <Opening />;
      break;
    case 'saved':
      content = (
        <Saved
          name={savedWallet?.name}
          network={activeProfile.network}
          error={error}
          switchError={session.switchError}
          connecting={connecting}
          networkEditor={networkEditor}
          openWallet={session.openWallet}
          setError={session.setError}
          setNetworkEditor={session.setNetworkEditor}
          setDeviceVisible={session.setDeviceVisible}
          switchNetwork={session.switchNetwork}
        />
      );
      break;
    case 'welcome':
      content = (
        <Welcome
          error={error}
          connecting={connecting}
          initializing={session.initializing}
          deviceVisible={session.deviceVisible}
          deviceHint={session.deviceHint}
          rememberedSession={session.rememberedSession}
          openDevice={session.openDevice}
          openWallet={session.openWallet}
          setError={session.setError}
          setDeviceVisible={session.setDeviceVisible}
          onCreateWallet={actions.openCreate}
        />
      );
      break;
    case 'picker':
      content = (
        <Picker
          wallets={walletsOnNetwork}
          activeProfile={activeProfile}
          error={error}
          switchError={session.switchError}
          networkEditor={networkEditor}
          selecting={selecting}
          switchNetwork={session.switchNetwork}
          setNetworkEditor={session.setNetworkEditor}
          selectWallet={session.selectWallet}
          createDefaultWallet={session.createDefaultWallet}
          disconnect={session.disconnect}
          onCreateWallet={actions.openCreate}
        />
      );
      break;
    case 'loading':
      content = (
        <OpeningWallet
          name={savedWallet?.name}
          network={savedWallet?.network || activeProfile.network}
          busy={connecting || selecting || refreshing}
          onDisconnect={session.disconnect}
        />
      );
      break;
    // The phase already promises a client, and a snapshot for the wallet. The
    // checks below only carry that promise to the compiler.
    case 'offline':
      content = client ? (
        <OfflineWallet
          name={savedWallet?.name}
          network={savedWallet?.network || activeProfile.network}
          setupError={savedWallet?.lfbw?.setupError}
          error={session.switchError || error}
          busy={refreshing || connecting || selecting}
          networkEditor={networkEditor}
          onRetryConnection={session.manualRefresh}
          onRetrySetup={session.retrySetup}
          onToggleNetwork={() => session.setNetworkEditor(!networkEditor)}
          onApplyNetwork={session.switchNetwork}
          onChooseWallet={session.chooseWallet}
          onDisconnect={session.disconnect}
          loadPhrase={() => client.getRecoveryPhrase()}
        />
      ) : null;
      break;
    case 'wallet':
      content =
        client && snapshot ? (
          <Canvas
            scene={state.scene}
            overlay={state.overlay}
            client={client}
            snapshot={snapshot}
            session={session}
            stale={stale}
            backup={backup}
            view={view}
          />
        ) : null;
      break;
  }

  // Drawn once, here, above every phase but the lock. A change between those
  // phases never remounts it, so a new wallet's phrase that has not been
  // saved yet is not lost to one. Locking the app does unmount it, as on
  // main: nothing of a wallet stays drawn under the lock.
  const overlay = state.overlay;
  const creating =
    overlay?.name === 'create' && client ? (
      <CreateSheet
        key={overlay.key}
        client={client}
        profile={activeProfile}
        restoring={overlay.restoring}
        onCreated={wallet => session.selectWallet(wallet, true)}
      />
    ) : null;
  return (
    <WhisperProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        {phase.kind === 'wallet' ? (
          // The canvas draws edge to edge, under the system bars, and keeps
          // its own content clear of them.
          content
        ) : (
          <SafeAreaView style={styles.root} edges={EDGES}>
            <View
              style={styles.root}
              importantForAccessibility={
                creating ? 'no-hide-descendants' : 'auto'
              }
              accessibilityElementsHidden={!!creating}
            >
              <SceneSlot
                refreshControl={
                  client && walletId && !closing && !switching ? (
                    // The phase views show their own wait, so the pull only
                    // starts a refresh.
                    <RefreshControl
                      refreshing={false}
                      onRefresh={session.manualRefresh}
                      tintColor={colors.primary}
                      colors={[colors.primary]}
                    />
                  ) : undefined
                }
              >
                <Animated.View style={[enter, styles.stack]}>
                  <BackupBanner backup={backup} />
                  {content}
                </Animated.View>
              </SceneSlot>
            </View>
          </SafeAreaView>
        )}
        {creating ? (
          <SafeAreaView style={styles.layer} edges={EDGES}>
            <View style={styles.flex}>{creating}</View>
          </SafeAreaView>
        ) : null}
      </View>
    </WhisperProvider>
  );
}
Stage.displayName = 'Stage';

/**
 * Whether the balance read at `updatedAt` is too old to spend against
 * (REDESIGN.md 6, stale), as of this render.
 *
 * The gate trips on its own, at the one moment it can, rather than by
 * re-rendering the whole app every few seconds to ask whether it has: the
 * timer only draws the stage again once the read goes old. Its flag is set
 * in an effect, a render behind each new read, so the answer is the read's
 * own age, and a fresh read is never drawn as stale.
 */
export function useStale(updatedAt: number | undefined): boolean {
  useStaleAfter(updatedAt, STALE_AFTER_MS);
  return updatedAt !== undefined && Date.now() - updatedAt >= STALE_AFTER_MS;
}

/** Every edge of the window that the phase views and the sheet keep clear of. */
const EDGES = ['top', 'bottom', 'left', 'right'] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  layer: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
  flex: { flex: 1 },
  stack: { gap: space.lg },
});
