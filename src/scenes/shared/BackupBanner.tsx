import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Notice } from '../../components/ui';
import { RecoveryPhrase } from '../../components/RecoveryPhrase';
import { copy } from '../../design/copy';
import type { Backup } from '../../stage/Canvas';
import { space } from '../../theme';

/**
 * A recovery phrase that has not been saved yet, as the old screens drew it:
 * the safety line and the phrase, above whatever is showing. It draws nothing
 * once the backup is done.
 *
 * Home replaces it with the honey halo and the shield tile, and Settings with
 * its own recovery phrase flow (REDESIGN.md 6, Backup and setup).
 */
export function BackupBanner({ backup }: { backup: Backup | null }) {
  if (!backup?.pending) return null;
  return (
    <View style={styles.stack}>
      <Notice kind="warning" icon="alert">
        {copy.health.backupPending}
      </Notice>
      <RecoveryPhrase loadPhrase={backup.loadPhrase} onSaved={backup.onSaved} />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: space.lg } });
