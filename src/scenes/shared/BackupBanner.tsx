import React from 'react';
import { RecoveryPhrase } from '../../components/RecoveryPhrase';
import type { Backup } from '../../stage/Canvas';

/**
 * A recovery phrase that has not been saved yet, above whatever is showing:
 * the honey section that heads itself with the safety line, then the phrase.
 * It draws nothing once the backup is done.
 *
 * Home no longer draws it: there the honey halo on the mark and the shield
 * tile lead to Settings, which draws the backup as its own leading section
 * (REDESIGN.md 6, Backup and setup).
 */
export function BackupBanner({ backup }: { backup: Backup | null }) {
  if (!backup?.pending) return null;
  return (
    <RecoveryPhrase loadPhrase={backup.loadPhrase} onSaved={backup.onSaved} />
  );
}
