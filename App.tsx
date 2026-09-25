import 'react-native-url-polyfill/auto';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type { Activity } from '@beignet/wallet-core';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon, IconButton, IconName, Notice } from './src/components/ui';
import { ToastProvider } from './src/components/Toast';
import { HomeScreen, ActivityScreen, DetailScreen } from './src/screens/Wallet';
import { ReceiveScreen, SendScreen } from './src/screens/Payments';
import { CreateWalletScreen, SettingsScreen } from './src/screens/Settings';
import { colors, space, type as typography } from './src/theme';
import type { Unit } from './src/theme';
import { RecoveryPhrase } from './src/components/RecoveryPhrase';
import { useStaleAfter } from './src/services/clock';
import {
  useWalletSession,
  STALE_AFTER_MS,
} from './src/services/useWalletSession';
import type { Tab } from './src/services/useWalletSession';
import { useReducedMotion, useEnter } from './src/services/motion';
import { useAppLock } from './src/services/useAppLock';
import { usePaymentLinks } from './src/services/links';
import { LockScreen } from './src/scenes/phases/Locked';
import { Transit } from './src/scenes/phases/Transit';
import { Opening } from './src/scenes/phases/Opening';
import { Saved } from './src/scenes/phases/Saved';
import { Welcome } from './src/scenes/phases/Welcome';
import { Picker } from './src/scenes/phases/Picker';
import { OpeningWallet } from './src/scenes/phases/Loading';
import { OfflineWallet } from './src/scenes/phases/Offline';

type Sheet = 'send' | 'receive' | 'detail' | 'create' | null;

const SHEET_TITLES: Record<Exclude<Sheet, null>, string> = {
  send: 'Send',
  receive: 'Receive',
  detail: 'Payment details',
  create: 'New wallet',
};

const REFRESH_FAILED = 'Could not refresh. Showing the last known state.';

// Padding on both platforms. The app draws edge to edge on Android, where the
// window no longer shrinks for the keyboard (adjustResize does nothing, and a
// full-screen Modal is its own edge-to-edge window), so without it the keyboard
// covered the lower fields: the Send amount sits under a long request. Padding
// only adds what the keyboard actually overlaps, so a window that does resize
// gets none.
const KEYBOARD_AVOIDING = 'padding' as const;

function WalletApp() {
  useReducedMotion();
  const [tab, setTabState] = useState<Tab>('Wallet');
  const [sheet, setSheet] = useState<Sheet>(null);
  // The create sheet opens in restore mode from the two restore links.
  const [createRestoring, setCreateRestoring] = useState(false);
  const [detail, setDetail] = useState<Activity | null>(null);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [unit, setUnit] = useState<Unit>('sats');
  const [prefill, setPrefill] = useState('');
  const [scanOnOpen, setScanOnOpen] = useState(false);

  const onTab = useCallback((next: Tab) => setTabState(next), []);
  // Every way out of a sheet goes through here, so a request that was paid or
  // abandoned never greets the next Send.
  const onCloseSheet = useCallback(() => {
    setSheet(null);
    setPrefill('');
    setScanOnOpen(false);
  }, []);
  const lock = useAppLock();
  // A locked app does not restore: no engine is started and no balance is read
  // until whoever is holding the phone has authenticated.
  const session = useWalletSession({
    tab,
    onTab,
    onCloseSheet,
    paused: lock.checking || lock.locked,
  });
  const {
    snapshot,
    client,
    wallets,
    walletId,
    error,
    closing,
    erasing,
    switching,
    switchTarget,
    switchError,
    initializing,
    connecting,
    selecting,
    refreshing,
    networkEditor,
    deviceVisible,
    deviceHint,
    rememberedSession,
    activeProfile,
  } = session;

  // The staleness gate trips on its own, at the one moment it can, rather than
  // by re-rendering the whole app every few seconds to ask whether it has.
  const stale = useStaleAfter(snapshot?.updatedAt, STALE_AFTER_MS);

  /** A tapped bitcoin:/lightning: link goes to the reviewed send flow, never straight to a payment. */
  const openSendWith = useCallback((request: string) => {
    setPrefill(request);
    setSheet('send');
  }, []);
  usePaymentLinks(!!walletId && !!snapshot, openSendWith);

  // Stable identities: these are handed to the screens and the sheet, and a new
  // function on every render is a changed prop on every render.
  const openDetail = useCallback((item: Activity) => {
    setDetail(item);
    setSheet('detail');
  }, []);
  const showActivity = useCallback(() => {
    onCloseSheet();
    setTabState('Activity');
  }, [onCloseSheet]);
  const closeSheet = useCallback(() => {
    if (!sheetBusy) onCloseSheet();
  }, [sheetBusy, onCloseSheet]);
  const openScanner = useCallback(() => {
    setScanOnOpen(true);
    setSheet('send');
  }, []);
  const openCreate = useCallback((restoring: boolean) => {
    setCreateRestoring(restoring);
    setSheet('create');
  }, []);

  // Scanning the whole history on every render, including the renders where
  // nothing is open: without a detail, `item.id === undefined` matched nothing
  // and the search still ran to the end of the list.
  const currentDetail = useMemo(
    () =>
      detail
        ? snapshot?.activity.find(item => item.id === detail.id) || detail
        : null,
    [snapshot?.activity, detail],
  );
  const savedWallet = useMemo(
    () => wallets.find(wallet => wallet.id === walletId),
    [wallets, walletId],
  );
  const walletsOnNetwork = useMemo(
    () => wallets.filter(wallet => wallet.network === activeProfile.network),
    [wallets, activeProfile.network],
  );
  const enter = useEnter(`${tab}:${walletId}:${!!snapshot}`);
  /**
   * A device wallet actually exists here, so this launch is a return rather
   * than a first run. `deviceHint` is false for a vault that was prepared but
   * never got a wallet, which must keep offering setup rather than claiming
   * there is something saved to open.
   */
  const returning = deviceHint;
  const backupPending =
    !!client && !!rememberedSession?.backupPending && !closing && !switching;

  if (lock.locked) {
    return (
      <LockScreen
        prompting={lock.prompting}
        error={lock.error}
        onUnlock={lock.prompt}
      />
    );
  }

  let content;
  if (switching || closing) {
    content = (
      <Transit
        erasing={erasing}
        closing={closing}
        switchTarget={switchTarget}
      />
    );
  } else if (initializing) {
    content = <Opening />;
  } else if (!client && returning && !deviceVisible) {
    // A wallet already lives on this device. Whatever went wrong, first-run
    // setup is the wrong screen: it offers to put a wallet somewhere, which is
    // not the question. Show the wallet that is here and how to get back into
    // it.
    content = (
      <Saved
        name={savedWallet?.name}
        network={activeProfile.network}
        error={error}
        switchError={switchError}
        connecting={connecting}
        networkEditor={networkEditor}
        openWallet={session.openWallet}
        setError={session.setError}
        setNetworkEditor={session.setNetworkEditor}
        setDeviceVisible={session.setDeviceVisible}
        switchNetwork={session.switchNetwork}
      />
    );
  } else if (!client) {
    content = (
      <Welcome
        error={error}
        connecting={connecting}
        initializing={initializing}
        deviceVisible={deviceVisible}
        deviceHint={deviceHint}
        rememberedSession={rememberedSession}
        openDevice={session.openDevice}
        openWallet={session.openWallet}
        setError={session.setError}
        setDeviceVisible={session.setDeviceVisible}
        onCreateWallet={openCreate}
      />
    );
  } else if (!walletId) {
    content = (
      <Picker
        wallets={walletsOnNetwork}
        activeProfile={activeProfile}
        error={error}
        switchError={switchError}
        networkEditor={networkEditor}
        selecting={selecting}
        switchNetwork={session.switchNetwork}
        setNetworkEditor={session.setNetworkEditor}
        selectWallet={session.selectWallet}
        createDefaultWallet={session.createDefaultWallet}
        disconnect={session.disconnect}
        onCreateWallet={openCreate}
      />
    );
  } else if (!snapshot && !error) {
    // The engine is starting and nothing has gone wrong. This is a wallet
    // page that has not filled in yet, not a connection problem, so it does
    // not offer retries, network settings or the recovery phrase.
    content = (
      <OpeningWallet
        name={savedWallet?.name}
        network={savedWallet?.network || activeProfile.network}
        busy={connecting || selecting || refreshing}
        onDisconnect={session.disconnect}
      />
    );
  } else if (!snapshot) {
    content = (
      <OfflineWallet
        name={savedWallet?.name}
        network={savedWallet?.network || activeProfile.network}
        setupError={savedWallet?.lfbw?.setupError}
        error={switchError || error}
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
    );
  } else {
    content = (
      <View style={styles.stack}>
        {error ? (
          <Notice kind="error" icon="alert">
            {`${REFRESH_FAILED} ${error}`}
          </Notice>
        ) : null}
        {tab === 'Wallet' ? (
          <HomeScreen
            snapshot={snapshot}
            hidden={hidden}
            unit={unit}
            stale={stale}
            onSend={() => setSheet('send')}
            onReceive={() => setSheet('receive')}
            onScan={openScanner}
            onActivity={showActivity}
            onDetail={openDetail}
            onToggleUnit={() => setUnit(unit === 'sats' ? 'btc' : 'sats')}
          />
        ) : tab === 'Activity' ? null : (
          <SettingsScreen
            snapshot={snapshot}
            client={client}
            switchError={switchError}
            onDisconnect={() => {
              session.disconnect();
            }}
            onChooseWallet={session.chooseWallet}
            onRefresh={session.manualRefresh}
            onNetwork={session.switchNetwork}
            onErase={session.eraseDevice}
          />
        )}
      </View>
    );
  }

  // A pending backup sits above whatever screen is showing, the Activity list
  // included, rather than replacing it.
  const backupNotice =
    backupPending && client ? (
      <>
        <Notice kind="warning" icon="alert">
          Save your recovery phrase.
        </Notice>
        <RecoveryPhrase
          loadPhrase={() => client.getRecoveryPhrase()}
          onSaved={session.acknowledgeBackup}
        />
      </>
    ) : null;
  if (backupNotice) {
    content = (
      <View style={styles.stack}>
        {backupNotice}
        {content}
      </View>
    );
  }

  const showChrome = !!snapshot && !closing && !switching;
  // A FlatList cannot live inside a ScrollView, and Activity is the one screen
  // whose length is unbounded. It scrolls itself.
  const listOwnsScroll = showChrome && tab === 'Activity';
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <AppHeader
        walletName={showChrome ? snapshot?.wallet.name : undefined}
        network={showChrome ? snapshot?.wallet.network : undefined}
        connected={snapshot?.primary.connected}
        hidden={hidden}
        refreshing={refreshing || connecting}
        onToggleHidden={showChrome ? () => setHidden(!hidden) : undefined}
        onRefresh={showChrome ? session.manualRefresh : undefined}
      />
      {listOwnsScroll && snapshot ? (
        <View style={styles.flex}>
          {error ? (
            <View style={styles.listError}>
              <Notice kind="error" icon="alert">
                {`${REFRESH_FAILED} ${error}`}
              </Notice>
            </View>
          ) : null}
          <ActivityScreen
            snapshot={snapshot}
            hidden={hidden}
            unit={unit}
            onDetail={openDetail}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            refreshing={refreshing}
            onRefresh={session.manualRefresh}
            banner={backupNotice}
          />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={KEYBOARD_AVOIDING}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={
              client && walletId && !closing && !switching ? (
                <RefreshControl
                  refreshing={refreshing && !!snapshot}
                  onRefresh={session.manualRefresh}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                />
              ) : undefined
            }
          >
            <Animated.View style={enter}>{content}</Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      {showChrome ? <TabBar tab={tab} onTab={setTabState} /> : null}
      <SheetModal sheet={sheet} busy={sheetBusy} onClose={closeSheet}>
        {client && sheet === 'send' ? (
          <SendScreen
            client={client}
            initialRequest={prefill}
            disabled={stale}
            onActivity={showActivity}
            onRefresh={session.refresh}
            onBusy={setSheetBusy}
            initialScanning={scanOnOpen}
          />
        ) : client && sheet === 'receive' ? (
          <ReceiveScreen
            client={client}
            receivableSats={snapshot?.balance.receivableSats}
            offlineReceivableSats={snapshot?.balance.offlineReceivableSats}
            disabled={stale}
            onRefresh={session.refresh}
            onActivity={showActivity}
            onBusy={setSheetBusy}
          />
        ) : client && sheet === 'create' ? (
          <CreateWalletScreen
            client={client}
            profile={activeProfile}
            initialRestoring={createRestoring}
            onCreated={wallet => session.selectWallet(wallet, true)}
            onBusy={setSheetBusy}
          />
        ) : currentDetail && sheet === 'detail' ? (
          <DetailScreen
            key={currentDetail.id}
            item={currentDetail}
            client={client || undefined}
            hidden={hidden}
            unit={unit}
            onRefresh={session.refresh}
            onBusy={setSheetBusy}
          />
        ) : null}
      </SheetModal>
    </SafeAreaView>
  );
}

/** Brand, the wallet you are looking at, and the two controls that belong at the top. */
function AppHeader({
  walletName,
  network,
  connected,
  hidden,
  refreshing,
  onToggleHidden,
  onRefresh,
}: {
  walletName?: string;
  network?: string;
  connected?: boolean;
  hidden: boolean;
  refreshing: boolean;
  onToggleHidden?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.brand}>
          beignet<Text style={styles.brandDot}>.</Text>
        </Text>
        {walletName ? (
          <Text numberOfLines={1} style={styles.headerWallet}>
            {walletName}
            {network ? (
              <Text style={styles.headerNetwork}>
                {'  ·  '}
                {network.toUpperCase()}
                {connected === false ? ' · RECONNECTING' : ''}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {onToggleHidden ? (
          <IconButton
            name={hidden ? 'eyeOff' : 'eye'}
            tone="plain"
            accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}
            accessibilityHint="Masks every amount on screen."
            onPress={onToggleHidden}
          />
        ) : null}
        {onRefresh ? (
          <IconButton
            name="refresh"
            tone="plain"
            disabled={refreshing}
            accessibilityLabel="Refresh wallet"
            onPress={onRefresh}
          />
        ) : null}
      </View>
    </View>
  );
}

function TabBar({ tab, onTab }: { tab: Tab; onTab: (next: Tab) => void }) {
  const insets = useSafeAreaInsets();
  const items: { label: Tab; icon: IconName }[] = [
    { label: 'Wallet', icon: 'wallet' },
    { label: 'Activity', icon: 'activity' },
    { label: 'Settings', icon: 'settings' },
  ];
  return (
    <View
      style={[
        styles.tabBar,
        // The inset is the safe area, not an extra cushion on top of a guess.
        { paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {items.map(item => (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === item.label }}
          accessibilityLabel={item.label}
          key={item.label}
          onPress={() => onTab(item.label)}
          style={styles.tab}
        >
          <Icon
            name={item.icon}
            size={22}
            color={tab === item.label ? colors.primary : colors.muted}
          />
          <Text
            style={[styles.tabLabel, tab === item.label && styles.selectedTab]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SheetModal({
  sheet,
  busy,
  onClose,
  children,
}: React.PropsWithChildren<{
  sheet: Sheet;
  busy: boolean;
  onClose: () => void;
}>) {
  return (
    <Modal
      visible={!!sheet}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <SafeAreaView
        style={styles.root}
        edges={['top', 'bottom', 'left', 'right']}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {sheet ? SHEET_TITLES[sheet] : ''}
          </Text>
          <IconButton
            name="close"
            accessibilityLabel="Close"
            disabled={busy}
            onPress={onClose}
          />
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={KEYBOARD_AVOIDING}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.sheetContent}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * The whole app fades in on a worklet, so the first frame after launch already
 * proves the animation runtime is alive on the UI thread.
 */
function Root({ children }: { children: React.ReactNode }) {
  const shown = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: shown.get() }));
  React.useEffect(() => {
    shown.set(withTiming(1, { duration: 220 }));
  }, [shown]);
  return (
    <Reanimated.View style={[styles.flex, style]}>{children}</Reanimated.View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ToastProvider>
          <Root>
            <WalletApp />
          </Root>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  headerText: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  brand: {
    color: colors.text,
    fontSize: 25,
    letterSpacing: -1.3,
    fontWeight: '700',
  },
  brandDot: { color: colors.primary },
  headerWallet: {
    ...typography.micro,
    color: colors.muted,
    marginTop: 3,
  },
  headerNetwork: { ...typography.micro, color: colors.faint, letterSpacing: 1 },
  headerLabel: {
    color: colors.faint,
    fontSize: 9,
    letterSpacing: 2.2,
    fontWeight: '600',
    marginTop: 5,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxxl,
    flexGrow: 1,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  stack: { gap: space.lg },
  welcomeCaption: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.xs,
  },
  caption: { ...typography.micro, color: colors.muted },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: space.xs,
    minHeight: 48,
  },
  tabLabel: { ...typography.micro, fontSize: 10, color: colors.muted },
  selectedTab: { color: colors.primary },
  sheetHeader: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sheetTitle: { ...typography.heading, fontSize: 17, color: colors.text },
  listError: { paddingHorizontal: space.xl, paddingBottom: space.xs },
  sheetNotice: { paddingHorizontal: space.xl, paddingTop: space.md },
  sheetContent: {
    padding: space.xl,
    paddingBottom: space.xxxl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
});
