import { sats } from './shared';

/** The Activity list: its rows, its search and its empty states. */
export const activity = {
  row: (title: string, value: number, status: string) =>
    `${title}, ${sats(value)}, ${status}`,
  rowHidden: (title: string, status: string) =>
    `${title}, amount hidden, ${status}`,
  rowHint: 'Opens the payment details.',
  search: 'Search activity',
  clearSearch: 'Clear search',
  noMatches: (query: string) => `No payments match “${query}”.`,
  empty: 'No payments yet.',
  reusedAddress: 'Address reused',
  legacy: 'Older request',
  unavailable: 'Status unavailable',
};
