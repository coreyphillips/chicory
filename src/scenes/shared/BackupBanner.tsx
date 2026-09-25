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
 * Home no longer draws it: there the honey halo on the mark and the shield
 * tile lead to Settings, which reveals the phrase here until it has a
 * recovery phrase flow of its own (REDESIGN.md 6, Backup and setup).
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
