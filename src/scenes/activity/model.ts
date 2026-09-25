import type { Activity } from '@beignet/wallet-core';
import { dayLabel, statusLabel } from '../../theme';

export function activityStatus(item: Activity) {
  if (item.receiveStatus?.phase === 'partial') return 'Partially received';
  if (item.receiveStatus?.phase === 'pending') return 'Confirming';
  if (item.status === 'pending' && item.kind === 'request')
    return 'Awaiting payment';
  if (item.status === 'pending' && item.kind === 'received')
    return 'Confirming';
  return statusLabel(item.status);
}

export const FILTERS = [
  'All',
  'Sent',
  'Received',
  'Requests',
  'Pending',
] as const;

function matchesFilter(item: Activity, filter: string) {
  switch (filter) {
    case 'Sent':
      return item.kind === 'sent';
    case 'Received':
      return item.kind === 'received';
    case 'Requests':
      // A request that has since been paid is still findable here, which is
      // where people look for "the code I sent someone".
      return item.kind === 'request' || !!item.receiveRequest;
    case 'Pending':
      return (
        item.status === 'pending' ||
        item.status === 'uncertain' ||
        item.receiveStatus?.phase === 'partial'
      );
    default:
      return true;
  }
}

/** `needle` is already trimmed and lowercased: this runs once per row. */
function matchesQuery(item: Activity, needle: string) {
  if (!needle) return true;
  const has = (value: string | undefined) =>
    !!value && value.toLowerCase().includes(needle);
  return (
    has(item.title) ||
    has(item.description) ||
    has(item.reference) ||
    has(item.txid) ||
    has(item.paymentHash) ||
    has(item.address) ||
    String(item.amountSats).includes(needle)
  );
}

export type ActivitySection =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'item'; id: string; item: Activity };

/**
 * The history as the list shows it: the payments that pass the filter and the
 * search, with a day header wherever the day changes.
 */
export function activitySections(
  activity: readonly Activity[],
  filter: string,
  needle: string,
): ActivitySection[] {
  const matched = activity.filter(
    item => matchesFilter(item, filter) && matchesQuery(item, needle),
  );
  const out: ActivitySection[] = [];
  let day = '';
  for (const item of matched) {
    const label = dayLabel(item.timestamp);
    if (label !== day) {
      day = label;
      out.push({ kind: 'header', id: `day:${label}`, label });
    }
    out.push({ kind: 'item', id: item.id, item });
  }
  return out;
}
