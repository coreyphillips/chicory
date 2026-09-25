import { amount, sats } from './shared';

/** Send: the request, the review, the hold and the results. */
export const send = {
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
};

/**
 * The amount keypad's contract (REDESIGN.md 10.3), which the suites drive
 * through test-support/keypad.ts. The container is labelled `label`, each
 * digit key with its digit alone, and backspace with `backspace`. The amount
 * it enters stays labelled `amount.field` and reads its digits from
 * `accessibilityValue.text`.
 */
export const keypad = {
  label: 'Amount keypad',
  digits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  backspace: amount.backspace,
  backspaceHint: amount.backspaceHint,
};
