import 'react-native-url-polyfill/auto';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import type { Activity, Network } from '@beignet/wallet-core';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Body,
  Button,
  Eyebrow,
  Icon,
  IconButton,
  IconName,
  LinkButton,
  Notice,
  Skeleton,
  Title,
} from './src/components/ui';
import { ToastProvider } from './src/components/Toast';
import { HomeScreen, ActivityScreen, DetailScreen } from './src/screens/Wallet';
import { ReceiveScreen, SendScreen } from './src/screens/Payments';
import {
  CreateWalletScreen,
  SettingsScreen,
  WalletPicker,
} from './src/screens/Settings';
import { colors, radius, space, type as typography } from './src/theme';
import type { Unit } from './src/theme';
import { DeviceSetup } from './src/screens/DeviceSetup';
import { NetworkSettings } from './src/screens/NetworkSettings';
import { RecoveryPhrase } from './src/components/RecoveryPhrase';
import { useStaleAfter } from './src/services/clock';
import {
  useWalletSession,
  errorMessage,
  STALE_AFTER_MS,
} from './src/services/useWalletSession';
import type { Tab } from './src/services/useWalletSession';
import { useReducedMotion, useEnter } from './src/services/motion';
import { useAppLock } from './src/services/useAppLock';
import { usePaymentLinks } from './src/services/links';
import type { NetworkProfile } from './src/services/networks';

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
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Body>
          {erasing
            ? 'Erasing your wallet from this phone…'
            : closing
            ? 'Closing your wallet…'
            : `Closing this wallet and opening ${
                switchTarget || 'the selected network'
              }…`}
        </Body>
      </View>
    );
  } else if (initializing) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Body>Opening your wallet…</Body>
      </View>
    );
  } else if (!client && returning && !deviceVisible) {
    // A wallet already lives on this device. Whatever went wrong, first-run
    // setup is the wrong screen: it offers to put a wallet somewhere, which is
    // not the question. Show the wallet that is here and how to get back into
    // it.
    content = (
      <View style={styles.stack}>
        <Title>{savedWallet?.name || 'Your wallet'}</Title>
        {error || switchError ? (
          <Body>
            This wallet is still on your phone. It could not be opened just now.
          </Body>
        ) : null}
        {switchError || error ? (
          <Notice kind="error" icon="alert">
            {switchError || error}
          </Notice>
        ) : (
          <View style={styles.skeletons}>
            <Skeleton width="55%" height={22} />
            <Skeleton width="80%" height={14} />
          </View>
        )}
        <Button
          label="Open device wallet"
          busy={connecting}
          onPress={() => {
            session.openWallet().catch(e => session.setError(errorMessage(e)));
          }}
        />
        <LinkButton
          label={
            networkEditor
              ? 'Hide network settings'
              : 'Change network or Bitcoin server'
          }
          disabled={connecting}
          onPress={() => session.setNetworkEditor(!networkEditor)}
        />
        {networkEditor ? (
          <NetworkSettings
            initialNetwork={activeProfile.network}
            onApply={session.switchNetwork}
          />
        ) : null}
        <LinkButton
          label="Device connection settings"
          tone="muted"
          disabled={connecting}
          onPress={() => session.setDeviceVisible(true)}
        />
      </View>
    );
  } else if (!client) {
    // Nothing is open and nothing is saved. There is no question left to ask:
    // the wallet runs on this phone, so the restore effect is already opening
    // it. This screen is the wait, and on the far side of a failure it is the
    // one place that says so and offers the ways back in.
    const opening = connecting || initializing;
    content = (
      <View style={styles.welcome}>
        {!deviceVisible ? (
          <>
            <View style={styles.mark}>
              <Text style={styles.markText}>b.</Text>
            </View>
            <Title>Bitcoin, with less to think about.</Title>
          </>
        ) : null}
        {deviceVisible ? (
          <DeviceSetup
            busy={connecting}
            error={error}
            onOpen={settings =>
              session.openDevice(settings, {
                existingOnly: deviceHint || !!rememberedSession,
                ...(rememberedSession
                  ? {
                      walletId: rememberedSession.walletId,
                      prepared: rememberedSession.prepared,
                      backupPending: rememberedSession.backupPending,
                    }
                  : { allowEmpty: deviceHint }),
              })
            }
          />
        ) : (
          <>
            {opening ? (
              <View style={styles.opening}>
                <ActivityIndicator color={colors.primary} />
                <Body>Opening your wallet…</Body>
              </View>
            ) : (
              <>
                {error ? <Notice kind="error">{error}</Notice> : null}
                <Button
                  label="Try again"
                  busy={connecting}
                  onPress={() => {
                    session
                      .openWallet()
                      .catch(e => session.setError(errorMessage(e)));
                  }}
                />
              </>
            )}
            <LinkButton
              label="Restore from recovery phrase"
              disabled={connecting}
              onPress={() => {
                session
                  .openWallet({ restore: true })
                  .then(() => {
                    setCreateRestoring(true);
                    setSheet('create');
                  })
                  .catch(e => session.setError(errorMessage(e)));
              }}
            />
            <LinkButton
              label="Network settings"
              tone="muted"
              disabled={connecting}
              onPress={() => session.setDeviceVisible(true)}
            />
          </>
        )}
        {deviceVisible ? (
          <LinkButton
            label="Back"
            tone="muted"
            disabled={connecting}
            onPress={() => {
              session.setDeviceVisible(false);
              session.setError('');
            }}
          />
        ) : null}
      </View>
    );
  } else if (!walletId) {
    content = (
      <View style={styles.stack}>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Eyebrow>{activeProfile.network}</Eyebrow>
        {switchError ? (
          <Notice kind="error" icon="alert">
            {switchError}
          </Notice>
        ) : null}
        {networkEditor ? (
          <NetworkSettings
            initialNetwork={activeProfile.network}
            onApply={session.switchNetwork}
          />
        ) : null}
        <LinkButton
          label={networkEditor ? 'Hide network settings' : 'Network settings'}
          disabled={selecting}
          onPress={() => session.setNetworkEditor(!networkEditor)}
        />
        <WalletPicker
          wallets={walletsOnNetwork}
          busy={selecting}
          onSelect={wallet => {
            session.selectWallet(wallet).catch(() => {});
          }}
          onCreate={() => {
            // A network with no primary node cannot have a wallet made from
            // its defaults: the shared client refuses one without a node. Open
            // the form that asks for it instead of failing with a message
            // about a URI nobody was given a chance to type.
            if (!activeProfile.primaryUri.trim()) {
              setCreateRestoring(false);
              setSheet('create');
              return;
            }
            session.createDefaultWallet().catch(() => {});
          }}
        />
        <LinkButton
          label="Restore from recovery phrase"
          disabled={selecting}
          onPress={() => {
            setCreateRestoring(true);
            setSheet('create');
          }}
        />
        <LinkButton
          label="Lock device wallet"
          disabled={selecting}
          onPress={() => {
            session.disconnect();
          }}
        />
      </View>
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

/** The wallet page before its first figures: identity and a short wait, nothing to act on. */
function OpeningWallet({
  name,
  network: _network,
  busy,
  onDisconnect,
}: {
  name?: string;
  network: Network;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Title>{name || 'Your wallet'}</Title>
      <Body>Opening…</Body>
      <View style={styles.skeletons}>
        <Skeleton width="55%" height={22} />
        <Skeleton width="80%" height={14} />
        <Skeleton width="40%" height={14} />
      </View>
      <LinkButton
        label="Lock device wallet"
        tone="muted"
        disabled={busy}
        onPress={onDisconnect}
      />
    </View>
  );
}

/**
 * The wallet is here, its network is not.
 *
 * Identity, the wallet's own saved setup diagnostic, a connection retry, a
 * setup retry, the network editor and the recovery phrase all stay reachable,
 * because this is exactly the screen where someone needs them.
 */
function OfflineWallet({
  name,
  network,
  setupError,
  error,
  busy,
  networkEditor,
  onRetryConnection,
  onRetrySetup,
  onToggleNetwork,
  onApplyNetwork,
  onChooseWallet,
  onDisconnect,
  loadPhrase,
}: {
  name?: string;
  network: Network;
  setupError?: string;
  error: string;
  busy: boolean;
  networkEditor: boolean;
  onRetryConnection: () => void;
  onRetrySetup: () => void;
  onToggleNetwork: () => void;
  onApplyNetwork: (profile: NetworkProfile) => Promise<void>;
  onChooseWallet: () => void;
  onDisconnect: () => void;
  loadPhrase: () => Promise<string>;
}) {
  return (
    <View style={styles.stack}>
      <Title>{name || 'Your wallet'}</Title>
      <Body>
        {error
          ? 'Balances are unavailable until the connection is restored.'
          : 'Connecting…'}
      </Body>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : (
        <View style={styles.skeletons}>
          <Skeleton width="55%" height={22} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="40%" height={14} />
        </View>
      )}
      {setupError ? (
        <Notice kind="warning" icon="info">
          {setupError}
        </Notice>
      ) : null}
      <Button
        label="Retry connection"
        onPress={onRetryConnection}
        busy={busy}
      />
      <Button
        secondary
        label="Retry wallet setup"
        icon="refresh"
        disabled={busy}
        accessibilityHint="Asks the wallet to run its Lightning setup again."
        onPress={onRetrySetup}
      />
      <LinkButton
        label={
          networkEditor
            ? 'Hide network settings'
            : 'Change network or Bitcoin server'
        }
        disabled={busy}
        onPress={onToggleNetwork}
      />
      {networkEditor ? (
        <NetworkSettings initialNetwork={network} onApply={onApplyNetwork} />
      ) : null}
      <RecoveryPhrase loadPhrase={loadPhrase} />
      <LinkButton
        label="Choose another wallet"
        disabled={busy}
        onPress={onChooseWallet}
      />
      <LinkButton
        label="Lock device wallet"
        tone="muted"
        disabled={busy}
        onPress={onDisconnect}
      />
    </View>
  );
}

/**
 * What someone sees when the app lock is on and they have not authenticated.
 *
 * Nothing about the wallet is shown here, no name, no network, no balance,
 * because the point of the lock is that the phone's holder has not proved they
 * are the owner yet.
 */
function LockScreen({
  prompting,
  error,
  onUnlock,
}: {
  prompting: boolean;
  error: string;
  onUnlock: () => void;
}) {
  return (
    <SafeAreaView
      style={styles.root}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.lockScreen}>
        <View style={styles.lockMark}>
          <Icon name="lock" size={30} color={colors.primary} />
        </View>
        <Title>Locked</Title>
        {error ? (
          <Notice kind="error" icon="alert">
            {error}
          </Notice>
        ) : null}
        <Button label="Unlock" icon="key" busy={prompting} onPress={onUnlock} />
      </View>
    </SafeAreaView>
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
  centered: {
    gap: space.md,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletons: { gap: space.sm },
  opening: { gap: space.md, alignItems: 'center' },
  welcome: {
    gap: space.xl,
    paddingTop: space.lg,
    flex: 1,
    justifyContent: 'center',
    paddingBottom: space.xxl,
  },
  mark: {
    height: 96,
    width: 96,
    backgroundColor: colors.primary,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
    transform: [{ rotate: '-8deg' }],
  },
  markText: {
    fontSize: 68,
    color: colors.ink,
    letterSpacing: -6,
    fontWeight: '600',
    marginTop: -8,
    marginLeft: -5,
  },
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
  lockScreen: {
    flex: 1,
    gap: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  lockMark: {
    height: 72,
    width: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
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
