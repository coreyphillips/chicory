import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Body, Button, LinkButton, Notice, Title } from '../../components/ui';
import { DeviceSetup } from '../../screens/DeviceSetup';
import { errorMessage } from '../../services/useWalletSession';
import type { useWalletSession } from '../../services/useWalletSession';
import { usePhaseBack } from '../../stage/StageContext';
import { colors, space } from '../../theme';

type Session = ReturnType<typeof useWalletSession>;

/**
 * Nothing is open and nothing is saved. There is no question left to ask: the
 * wallet runs on this phone, so the restore effect is already opening it. This
 * screen is the wait, and on the far side of a failure it is the one place
 * that says so and offers the ways back in.
 */
export function Welcome({
  error,
  connecting,
  initializing,
  deviceVisible,
  deviceHint,
  rememberedSession,
  openDevice,
  openWallet,
  setError,
  setDeviceVisible,
  onCreateWallet,
}: Pick<
  Session,
  | 'error'
  | 'connecting'
  | 'initializing'
  | 'deviceVisible'
  | 'deviceHint'
  | 'rememberedSession'
  | 'openDevice'
  | 'openWallet'
  | 'setError'
  | 'setDeviceVisible'
> & {
  /** Opens the new wallet sheet, in restore mode when `restoring` is set. */
  onCreateWallet: (restoring: boolean) => void;
}) {
  const opening = connecting || initializing;
  const closeDevice = () => {
    setDeviceVisible(false);
    setError('');
  };
  // Back closes the device setup, as its own Back link does. While a wallet
  // is opening from it the press is held, since the link is disabled too.
  usePhaseBack(() => {
    if (!deviceVisible) return false;
    if (!connecting) closeDevice();
    return true;
  });
  return (
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
            openDevice(settings, {
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
                  openWallet().catch(e => setError(errorMessage(e)));
                }}
              />
            </>
          )}
          <LinkButton
            label="Restore from recovery phrase"
            disabled={connecting}
            onPress={() => {
              openWallet({ restore: true })
                .then(() => onCreateWallet(true))
                .catch(e => setError(errorMessage(e)));
            }}
          />
          <LinkButton
            label="Network settings"
            tone="muted"
            disabled={connecting}
            onPress={() => setDeviceVisible(true)}
          />
        </>
      )}
      {deviceVisible ? (
        <LinkButton
          label="Back"
          tone="muted"
          disabled={connecting}
          onPress={closeDevice}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
