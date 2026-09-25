import React from 'react';
import { StyleSheet } from 'react-native';
import { copy } from '../design/copy';
import { Note, Section, SettingsSurface, Title } from '../scenes/settings/ui';
import { space } from '../theme';
import { NetworkSettings } from './NetworkSettings';
import type { DeviceSettings } from '../embedded/client';

/**
 * First-run network setup, a settings-class surface (REDESIGN.md rule 2): the
 * servers the wallet on this phone will use, in the Settings language, with
 * the reason the last open failed above them.
 */
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
    <SettingsSurface style={styles.root}>
      <Title>{copy.settings.network.title}</Title>
      {error ? <Note tone="error">{error}</Note> : null}
      <Section>
        <NetworkSettings busy={busy} onApply={onOpen} />
      </Section>
    </SettingsSurface>
  );
}

const styles = StyleSheet.create({ root: { gap: space.lg } });
