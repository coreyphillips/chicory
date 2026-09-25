import { fs, path, ROOT } from '../test-support/node';

/**
 * The words iOS shows when it first asks for the camera are the app's own,
 * so they name the app a person installed: Chicory, not the engine under it.
 */
const PLIST = fs.readFileSync(
  path.join(ROOT, 'ios', 'chicory', 'Info.plist'),
  'utf8',
);

/** The string an Info.plist key holds, or undefined. */
const valueOf = (key: string) =>
  PLIST.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];

test('the camera prompt names Chicory and says what the camera is for', () => {
  expect(valueOf('NSCameraUsageDescription')).toBe(
    'Chicory uses the camera only to read a payment request code. Nothing is recorded, stored or sent.',
  );
});
