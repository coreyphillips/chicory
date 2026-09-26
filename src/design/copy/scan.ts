/**
 * The scan overlay's words. None of them is drawn: the disc, the reticle and
 * the glyphs carry them on screen, and a screen reader hears them from here.
 */
export const scan = {
  /** The overlay's name for a screen reader, where an eyebrow used to say it. */
  title: 'Scan',
  /** Its name once the camera turns out to be off. */
  camera: 'Camera',
  aim: 'Point at the code.',
  privacy:
    'Chicory uses the camera only to read a payment code. Nothing is recorded or sent.',
  starting: 'Getting the camera ready…',
  invalid: 'That code is not a payment request.',
  detected: 'Payment request found.',
  denied: 'Camera access is off.',
  noCamera:
    'Chicory needs the camera only to read a payment request. Turn it on in your device settings, or paste the request instead.',
  missing: 'Camera scanning is unavailable.',
  missingHint:
    'This build does not include the camera module. Rebuild the native app to enable scanning, or paste the request instead.',
  openSettings: 'Open camera settings',
  paste: 'Paste from clipboard',
  clipboardEmpty: 'The clipboard is empty.',
  clipboardUnreadable: 'Could not read the clipboard.',
  close: 'Close',
};
