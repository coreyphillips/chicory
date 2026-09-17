import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Notice, Title } from '../components/ui';
import { space } from '../theme';
import { NetworkSettings } from './NetworkSettings';
import type { DeviceSettings } from '../embedded/client';
export function DeviceSetup({
  busy,
  error,
  onOpen,
}: {
  busy: boolean;
  error: string;
  onOpen: (settings: DeviceSettings) => Promise<void>;
}) {
  return (
    <View style={styles.root}>
      <Title>Network settings</Title>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      <NetworkSettings busy={busy} onApply={onOpen} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: space.lg } });
