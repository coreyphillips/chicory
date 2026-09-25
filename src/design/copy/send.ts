import { sats } from './shared';

/**
 * Send: the request, the review, the hold and the results. None of it is
 * drawn: it is what the glyphs, rings and lines say to a screen reader and
 * through Whisper.
 */
export const send = {
  request: 'Payment request or address',
  // The empty well's words, which it used to show as its placeholder.
  requestEmpty: 'Paste a request here',
  requestHint: 'Opens the request to change it.',
  paste: 'Paste from clipboard',
  pasted: 'Request pasted',
  clipboardEmpty: 'The clipboard is empty.',
  scan: 'Scan a payment request',
  review: 'Review payment',
  // Why the review waits, while there is no request to review.
  reviewWaits: 'Paste or scan a payment request first.',
  preparing: 'Preparing the payment.',
  sendSats: (value: number) => `Send ${sats(value)}`,
  holdHint: 'Hold to send.',
  quoteExpires: (seconds: number) => `Fee quote expires in ${seconds}s`,
  refreshQuote: 'Refresh quote',
  quoteExpired: 'Quote expired. Review again.',
  edit: 'Edit payment',
  stale: 'Balance not confirmed recently. Refresh before sending.',
  // The review's lines: the rail, the fee on top, what it should cost, and
  // the most it can.
  lightning: 'Lightning',
  bitcoin: 'Bitcoin',
  directFunding: 'Direct funding',
  fee: 'Fee',
  expectedFee: 'Expected routing fee',
  about: (value: number) => `about ${sats(value)}`,
  totalAtMost: 'Total, at most',
  totalWithFee: 'Total including fee',
  // Results.
  sent: 'Sent.',
  onItsWay: 'Payment on its way.',
  unknown: 'Result unknown.',
  failed: 'Payment failed.',
  retry: 'Returns to the payment, with the request kept.',
  checkActivity: 'Check Activity before paying this request again.',
  held: 'This request has a payment whose outcome is not known yet. It cannot be paid again until that resolves.',
  heldAnnouncement:
    'Payment status unknown. Do not pay again until this is resolved.',
  showPayment: 'Shows the payment in Activity.',
  feePaid: 'Fee paid',
  reviewedFee: 'Reviewed fee',
  feeUnavailable: 'Unavailable',
  reference: 'Reference',
  viewActivity: 'View activity',
};

/**
 * The amount keypad's contract (REDESIGN.md 10.3), which the suites drive
 * through test-support/keypad.ts. The container is labelled `label`, each
 * digit key with its digit alone, and backspace with `backspace`. The amount
 * it enters stays labelled `amount.field` and reads its digits from
 * `accessibilityValue.text`.
 *
 * The keypad's words live here, with the send track that owns the keypad;
 * the copy index also serves them as `amount.backspace` and
 * `amount.backspaceHint`.
 */
export const keypad = {
  label: 'Amount keypad',
  digits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  backspace: 'Delete last digit',
  backspaceHint: 'Hold to clear the amount.',
};
