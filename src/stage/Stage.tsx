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
import { Notice } from '../components/ui';
import { RecoveryPhrase } from '../components/RecoveryPhrase';
import { copy } from '../design/copy';
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
import { colors, space } from '../theme';
import { Canvas, useCanvasView } from './Canvas';
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
  // The staleness gate trips on its own, at the one moment it can, rather than
  // by re-rendering the whole app every few seconds to ask whether it has.
  const stale = useStaleAfter(snapshot?.updatedAt, STALE_AFTER_MS);
  const savedWallet = useMemo(
    () => wallets.find(wallet => wallet.id === walletId),
    [wallets, walletId],
  );
  const walletsOnNetwork = useMemo(
    () => wallets.filter(wallet => wallet.network === activeProfile.network),
    [wallets, activeProfile.network],
  );
  const enter = useEnter(phase.kind);

  if (phase.kind === 'locked') {
    return (
      <LockScreen
        prompting={phase.prompting}
        error={phase.error}
        onUnlock={onUnlock}
      />
    );
  }

  // A pending backup sits above whatever is showing, the Activity list
  // included, rather than replacing it.
  const backup =
    backupPending(session) && client ? (
      <View style={styles.stack}>
        <Notice kind="warning" icon="alert">
          {copy.health.backupPending}
        </Notice>
        <RecoveryPhrase
          loadPhrase={() => client.getRecoveryPhrase()}
          onSaved={session.acknowledgeBackup}
        />
      </View>
    ) : null;

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
            banner={backup}
            view={view}
          />
        ) : null;
      break;
  }

  // Drawn once, here, above every phase. A phase change under it never
  // remounts it, so a new wallet's phrase that has not been saved yet cannot
  // be lost to one.
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
  // The whisper pill is drawn above every phase and the canvas alike, from
  // the window's own origin, so it lands where the finger is.
  return (
    <WhisperProvider>
      <SafeAreaView
        style={styles.root}
        edges={['top', 'bottom', 'left', 'right']}
      >
        <StatusBar barStyle="light-content" />
        <View style={styles.root}>
          {phase.kind === 'wallet' ? (
            content
          ) : (
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
                  {backup}
                  {content}
                </Animated.View>
              </SceneSlot>
            </View>
          )}
          {creating}
        </View>
      </SafeAreaView>
    </WhisperProvider>
  );
}
Stage.displayName = 'Stage';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  stack: { gap: space.lg },
});
