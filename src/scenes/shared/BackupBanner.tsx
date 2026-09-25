import React from 'react';
import { RecoveryPhrase } from '../../components/RecoveryPhrase';
import type { Backup } from '../../stage/Canvas';

/**
 * A recovery phrase that has not been saved yet, above whatever is showing:
 * the honey section that heads itself with the safety line, then the phrase.
 * It draws nothing once the backup is done.
 *
 * The canvas never draws it: there the honey halo on the mark, the shield
 * tile beside it at home and the shield pinned first on the open list lead
 * to Settings, which draws the backup as its own leading section
 * (REDESIGN.md 6, Backup and setup). Only the stage still draws it, above the
 * shell phases.
 */
export function BackupBanner({ backup }: { backup: Backup | null }) {
  if (!backup?.pending) return null;
  return (
    <RecoveryPhrase loadPhrase={backup.loadPhrase} onSaved={backup.onSaved} />
  );
}
