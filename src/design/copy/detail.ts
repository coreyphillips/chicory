/** A payment's detail: its status lines and the values it can copy. */
export const detail = {
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
};
