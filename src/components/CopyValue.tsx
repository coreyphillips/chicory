import React from 'react';
import { CopyChip } from '../glyphs/CopyChip';

/**
 * A reference value that copies with a tap: a copy chip (REDESIGN.md 5).
 *
 * Payment hashes, transaction ids and addresses used to be selectable text
 * only, which on a phone means a long-press and two drag handles over a 64
 * character string. The chip copies all of it with a tap and shows all of it
 * on a long press. `label` names the value for a screen reader, which hears
 * "Copy {label}" and then "{label} copied".
 */
export function CopyValue({ label, value }: { label: string; value: string }) {
  return <CopyChip label={label} value={value} />;
}
