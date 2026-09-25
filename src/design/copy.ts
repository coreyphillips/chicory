import { amountIn, number } from '../theme';
import type { Unit } from '../theme';

/**
 * Every word the app says without showing it (REDESIGN.md 9).
 *
 * Outside Settings the screen carries meaning in glyphs, rings, colour and
 * motion, so the words move here: into accessibility labels, values and hints,
 * into announcements, and into the Whisper pill a long press summons. Keeping
 * them in one object keeps a phrase identical wherever it is spoken, and lets
 * a test prove that nothing here leaked onto the screen.
 *
 * Phrases the test suite already asserts are kept verbatim. Amounts are always
 * spoken in sats, whatever unit is on screen, except where the unit is part of
 * what is being read out.
 */
const sats = (value: number) => `${number(value)} sats`;

export const copy = {
  home: {
    totalBalance: (value: number, unit: Unit) => {
      const amount = amountIn(value, unit);
      return `Total balance ${amount.value} ${amount.suffix}`;
    },
    balanceHidden: 'Balance hidden',
    unitHint: 'Switches between satoshis and BTC.',
    hideHint: 'Masks every amount on screen.',
    showBalance: 'Show balance',
    hideBalance: 'Hide balance',
    split: (available: number, arriving: number) =>
      `${sats(available)} ready to send, ${sats(arriving)} arriving`,
    send: 'Send',
    sendHint: 'Paste or scan a payment request.',
    receive: 'Receive',
    receiveHint: 'Creates a request others can pay.',
    scan: 'Scan a payment request',
    scanHint: 'Opens the camera to read a QR code.',
    settings: 'Settings',
    close: 'Close',
    activity: 'Activity',
    refresh: 'Refresh wallet',
  },

  /** What a screen reader calls a scene, where a title bar used to say it. */
  scene: {
    send: 'Send',
    receive: 'Receive',
    detail: 'Payment details',
    create: 'New wallet',
  },

  health: {
    fresh: 'Connected.',
    reconnecting: 'Reconnecting to your wallet.',
    refreshFailed: 'The last refresh did not complete.',
    stale: 'Balance not confirmed recently.',
    staleAction: 'Balance not confirmed recently. Refreshing now.',
    cached: 'Showing the last saved balance until the wallet answers.',
    setupPending: 'Lightning setup is in progress.',
    setupReady: 'Lightning is ready.',
    setupFailed: 'Lightning setup did not finish. Retry it in Settings.',
    testNetwork: (network: string) =>
      `${network} is a test network. Its coins have no value.`,
    backupPending: 'Save your recovery phrase.',
  },

  activity: {
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
  },

  detail: {
    copy: (label: string) => `Copy ${label.toLowerCase()}`,
    copied: (label: string) => `${label} copied`,
    awaiting: 'Awaiting payment.',
    inProgress: 'In progress.',
    detected: 'Payment detected. Waiting for confirmation.',
    uncertain: 'Status unknown. Do not pay again until this is resolved.',
    expired: 'Request expired.',
    legacyExpired:
      'Invoice expired. Bitcoin payments appear separately until the original request is linked.',
    failed: 'Payment did not complete.',
    linked: 'Original request linked. Its payment status is being refreshed.',
    linkOriginal: 'Link original request',
    shareOriginal: 'Share original request',
    originalQr: 'Original payment request QR code',
    legacyQr: 'Lightning invoice QR code',
  },

  amount: {
    field: 'Amount in sats',
    preset: (value: number) => number(value),
    any: 'Any amount',
    required: 'Amount required',
    fixed: 'Set by the payment request.',
    overSpendable:
      'More than can be sent right now. The rest is still arriving.',
    overTotal: 'More than this wallet holds.',
    overOfflineCap: (cap: number) =>
      `Offline requests are limited to ${sats(cap)}.`,
    backspace: 'Delete last digit',
    backspaceHint: 'Hold to clear the amount.',
  },

  send: {
    request: 'Payment request or address',
    paste: 'Paste from clipboard',
    scan: 'Scan a payment request',
    review: 'Review payment',
    sendSats: (value: number) => `Send ${sats(value)}`,
    holdHint: 'Hold to send.',
    refreshQuote: 'Refresh quote',
    edit: 'Edit payment',
    expectedFee: 'Expected routing fee',
    totalAtMost: 'Total, at most',
    stale: 'Balance not confirmed recently. Refresh before sending.',
    // Results.
    sent: 'Sent.',
    onItsWay: 'Payment on its way.',
    unknown: 'Result unknown.',
    failed: 'Payment failed.',
    checkActivity: 'Check Activity before paying this request again.',
    held: 'This request has a payment whose outcome is not known yet. It cannot be paid again until that resolves.',
    heldAnnouncement:
      'Payment status unknown. Do not pay again until this is resolved.',
  },

  receive: {
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
  },

  scan: {
    aim: 'Point at the code.',
    invalid: 'That code is not a payment request.',
    detected: 'Payment request found.',
    noCamera:
      'Chicory needs the camera only to read a payment request. Turn it on in your device settings, or paste the request instead.',
    openSettings: 'Open camera settings',
  },

  phase: {
    locked: 'Locked',
    unlock: 'Unlock',
    lockRefused: 'Chicory stays locked until this is confirmed.',
    opening: 'Opening…',
    closing: 'Closing your wallet…',
    switching: (network: string | null) =>
      `Closing this wallet and opening ${network || 'the selected network'}…`,
    erasing: 'Erasing your wallet from this phone…',
    saved:
      'This wallet is still on your phone. It could not be opened just now.',
    openDevice: 'Open device wallet',
    offline: 'Balances are unavailable until the connection is restored.',
    retryConnection: 'Retry connection',
    retrySetup: 'Retry wallet setup',
    retrySetupHint: 'Asks the wallet to run its Lightning setup again.',
    chooseWallet: 'Choose another wallet',
    lockDevice: 'Lock device wallet',
    createWallet: 'Create a wallet',
    restore: 'Restore from recovery phrase',
    networkSettings: 'Network settings',
    tryAgain: 'Try again',
    openWallet: (name: string) => `Open ${name}`,
  },
};
