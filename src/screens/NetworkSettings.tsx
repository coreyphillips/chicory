import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { Network } from '@beignet/wallet-core';
import { Body, Button, Card, Eyebrow, Field, Notice } from '../components/ui';
import { colors, radius, space, type } from '../theme';
import {
  NETWORKS,
  loadNetworkPreferences,
  saveNetworkPreferences,
  validateProfile,
} from '../services/networks';
import type { NetworkPreferences, NetworkProfile } from '../services/networks';
import {
  loadDevicePreferences,
  validateDeviceSettings,
} from '../embedded/client';
import { seedSourceNetwork } from '../embedded/seed';

export function NetworkSettings({
  initialNetwork,
  busy = false,
  onApply,
}: {
  initialNetwork?: Network;
  busy?: boolean;
  onApply: (profile: NetworkProfile) => Promise<void>;
}) {
  const [preferences, setPreferences] = useState<NetworkPreferences | null>(
    null,
  );
  const [profile, setProfile] = useState<NetworkProfile | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [seedSource, setSeedSource] = useState<Network | null>(null);
  // A switch replaces this screen with a full-page wait, so anything written
  // after the await below lands on a component nobody is looking at.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    loadDevicePreferences()
      .then(value => {
        if (!active) return;
        setPreferences(value);
        setProfile(value.profiles[initialNetwork || value.selectedNetwork]);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [initialNetwork]);
  useEffect(() => {
    let active = true;
    seedSourceNetwork()
      .then(network => active && setSeedSource(network))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const disabled = busy || working;
  const update = (fields: Partial<NetworkProfile>) =>
    setProfile(value => value && { ...value, ...fields });
  async function apply() {
    if (!profile || !preferences || disabled) return;
    setWorking(true);
    setError('');
    try {
      validateProfile(profile, true);
      validateDeviceSettings(profile);
      // Reload before saving so a separate settings action cannot erase a legacy mapping.
      const current = await loadNetworkPreferences();
      current.profiles[profile.network] = profile;
      // The selected network deliberately stays where it is. Opening the vault
      // is what moves it, so a switch that fails leaves the phone pointed at
      // the network it is actually still on, and the next launch goes back
      // there rather than retrying the one that just failed.
      await saveNetworkPreferences(current);
      if (mounted.current) setPreferences(current);
      await onApply(profile);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Could not change networks.');
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <View style={styles.stack}>
      <Eyebrow>Network</Eyebrow>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      {profile && seedSource && seedSource !== profile.network ? (
        <Notice icon="key">
          {`A new ${profile.network} wallet reuses the recovery phrase from your ${seedSource} wallet. An existing ${profile.network} wallet keeps its own phrase.`}
        </Notice>
      ) : null}
      {profile && preferences ? (
        <>
          <View style={styles.networks}>
            {NETWORKS.map(network => (
              <Pressable
                key={network}
                accessibilityRole="button"
                accessibilityLabel={`Select ${network}`}
                accessibilityState={{
                  selected: profile.network === network,
                  disabled,
                }}
                disabled={disabled}
                onPress={() => {
                  if (network === profile.network) return;
                  setPreferences({
                    ...preferences,
                    profiles: {
                      ...preferences.profiles,
                      [profile.network]: profile,
                    },
                  });
                  setProfile(preferences.profiles[network]);
                }}
                style={[
                  styles.network,
                  profile.network === network && styles.selected,
                ]}
              >
                <Text
                  style={[
                    styles.networkText,
                    profile.network === network && styles.selectedText,
                  ]}
                >
                  {network}
                </Text>
              </Pressable>
            ))}
          </View>
          <Card>
            <Field
              label="Default Electrum server"
              value={profile.electrum.host}
              autoCapitalize="none"
              editable={!disabled}
              placeholder={
                profile.network === 'mainnet'
                  ? 'bitkit.to'
                  : 'Server for this network'
              }
              onChangeText={host =>
                update({ electrum: { ...profile.electrum, host: host.trim() } })
              }
            />
            <Field
              label="Default Electrum port"
              value={String(profile.electrum.port)}
              keyboardType="number-pad"
              editable={!disabled}
              onChangeText={port =>
                update({
                  electrum: { ...profile.electrum, port: Number(port) },
                })
              }
            />
            <View style={styles.row}>
              <Text style={styles.label}>TLS encryption</Text>
              <Switch
                accessibilityLabel="Default Electrum TLS"
                value={profile.electrum.tls}
                disabled={disabled}
                trackColor={{ true: colors.primary, false: colors.line }}
                thumbColor={colors.text}
                onValueChange={tls =>
                  update({ electrum: { ...profile.electrum, tls } })
                }
              />
            </View>
          </Card>
          <Card>
            <Field
              label="Default primary node"
              value={profile.primaryUri}
              autoCapitalize="none"
              multiline
              editable={!disabled}
              onChangeText={primaryUri => update({ primaryUri })}
              placeholder={
                profile.network === 'mainnet' ? '' : 'A node on this network'
              }
            />
            <View style={styles.row}>
              <Text style={styles.label}>Use a transport relay</Text>
              <Switch
                accessibilityLabel="Use transport relay"
                value={profile.transport === 'relay'}
                disabled={disabled}
                trackColor={{ true: colors.primary, false: colors.line }}
                thumbColor={colors.text}
                onValueChange={relay =>
                  update({ transport: relay ? 'relay' : 'native' })
                }
              />
            </View>
            {profile.transport === 'relay' ? (
              <>
                <Field
                  label="Relay address"
                  value={profile.relayUrl}
                  onChangeText={relayUrl => update({ relayUrl })}
                  autoCapitalize="none"
                  editable={!disabled}
                  placeholder="wss://relay.example.com"
                />
                <Field
                  label="Relay token"
                  value={profile.relayToken}
                  onChangeText={relayToken => update({ relayToken })}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!disabled}
                />
              </>
            ) : null}
          </Card>
          <Button
            label={
              initialNetwork === profile.network
                ? 'Save network settings'
                : `Use ${profile.network}`
            }
            busy={disabled}
            disabled={disabled || !profile.electrum.host.trim()}
            onPress={apply}
          />
        </>
      ) : (
        <Body>Loading saved network settings…</Body>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: space.md + 2 },
  networks: { flexDirection: 'row', gap: space.xs },
  network: {
    flex: 1,
    padding: space.sm,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  selected: { backgroundColor: colors.cream, borderColor: colors.cream },
  networkText: { ...type.caption, color: colors.muted },
  selectedText: { color: colors.ink, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 44,
  },
  label: { ...type.body, color: colors.text, flex: 1 },
});
