import { sats } from './shared';

/** Receive: the amount, the request and what arrives for it. */
export const receive = {
  create: 'Create request',
  createAnother: 'Create another request',
  requestRemaining: 'Request the remaining amount',
  refreshQuote: 'Refresh quote',
  editAmount: 'Edit amount',
  note: 'Note · optional',
  offline: 'Receive offline',
  offlineHint: 'Accept this payment even while this wallet is closed.',
  offlineOn:
    'Payable while this wallet is closed. Your primary node prepares it and settles the payment for you.',
  qr: 'Payment request QR code',
  qrHint: 'Shows the code larger, so it is easier to scan.',
  closeQr: 'Close enlarged QR code',
  share: 'Share request',
  copy: 'Copy request',
  lightningOnly: 'This request accepts Lightning only.',
  nearExpiry: 'This request expires soon.',
  expired: 'This request has expired. Create another to be paid.',
  reusedAddress:
    'This address was reused. Bitcoin payments cannot be matched to this request.',
  trackingUnavailable: 'Payment tracking is unavailable for this request.',
  stale: 'Balance not confirmed recently. Refresh before creating a request.',
  // Results.
  detected: 'Payment detected.',
  confirming:
    'Waiting for confirmation. The sender does not need to pay again.',
  partial: 'Part of it is here.',
  partialSplit: (received: number, requested: number) =>
    `${sats(received)} received so far of ${sats(requested)} requested.`,
  received: 'Payment received.',
  receivedSats: (value: number) => `${sats(value)} received.`,
};
