import { number } from '../../theme';

/**
 * The words more than one area speaks: how an amount is read out, what a
 * scene is called, and the notices the canvas still writes on screen.
 *
 * Amounts are always spoken in sats, whatever unit is on screen, except where
 * the unit is part of what is being read out.
 */
export const sats = (value: number) => `${number(value)} sats`;

/** What a screen reader calls a scene, where a title bar used to say it. */
export const scene = {
  send: 'Send',
  receive: 'Receive',
  detail: 'Payment details',
  create: 'New wallet',
};

export const amount = {
  /** How any amount is read out, whatever unit is on screen. */
  spoken: (value: number) => sats(value),
  hidden: 'Amount hidden',
  field: 'Amount in sats',
  preset: (value: number) => number(value),
  any: 'Any amount',
  required: 'Amount required',
  fixed: 'Set by the payment request.',
  overSpendable: 'More than can be sent right now. The rest is still arriving.',
  overTotal: 'More than this wallet holds.',
  overOfflineCap: (cap: number) =>
    `Offline requests are limited to ${sats(cap)}.`,
  backspace: 'Delete last digit',
  backspaceHint: 'Hold to clear the amount.',
};

/**
 * Words still shown on screen, above Home, Activity and Settings, until the
 * tracks that own those surfaces carry them in glyphs.
 */
export const notice = {
  refreshFailed: (error: string) =>
    `Could not refresh. Showing the last known state. ${error}`,
};
