/**
 * Tap to pay's native half (docs/TAP-TO-PAY.md): a payment request read from
 * an NFC tag, such as a payment terminal presents, reaches Send as a link
 * does. These read the native sources as text, since no Jest run has a radio.
 */
import { fs, path, ROOT } from '../test-support/node';

const read = (...parts: string[]) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const MANIFEST = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
/** The manifest without its comments, which name what the filters are for. */
const MANIFEST_CODE = MANIFEST.replace(/<!--[\s\S]*?-->/g, '');
const MAIN_ACTIVITY =
  /<activity\s[^>]*android:name="\.MainActivity"[^>]*>/.exec(
    MANIFEST_CODE,
  )?.[0];

/** Each intent filter that answers an NDEF tag, as the manifest writes it. */
const ndefFilters = () =>
  [...MANIFEST_CODE.matchAll(/<intent-filter>[\s\S]*?<\/intent-filter>/g)]
    .map(match => match[0])
    .filter(filter => filter.includes('android.nfc.action.NDEF_DISCOVERED'));

describe('a tag Android hands to the app', () => {
  test('is taken for the two payment schemes and nothing else', () => {
    const filters = ndefFilters();
    expect(filters).toHaveLength(2);
    const schemes = filters.map(
      filter => /<data\s+android:scheme="([^"]+)"\s*\/>/.exec(filter)?.[1],
    );
    // Android lower-cases a URI record's scheme before it matches a filter,
    // so LIGHTNING: on a tag is matched by these too.
    expect(schemes.sort()).toEqual(['bitcoin', 'lightning']);
    for (const filter of filters) {
      expect(filter).toContain('android.intent.category.DEFAULT');
      // A scheme and nothing more: a request has no host, path or MIME type.
      expect(filter.match(/<data\b/g)).toHaveLength(1);
      expect(filter).not.toMatch(/android:(host|path\w*|mimeType)=/);
    }
  });

  test('is never claimed by its technology alone', () => {
    // A filter on the tag's technology would open the wallet for a bank
    // card, a transit pass or another phone held near this one.
    expect(MANIFEST_CODE).not.toContain('TECH_DISCOVERED');
    expect(MANIFEST_CODE).not.toContain('TAG_DISCOVERED');
  });

  test('reaches the one activity, which takes it as a new intent', () => {
    expect(MAIN_ACTIVITY).toContain('android:launchMode="singleTask"');
    // The launcher and a browser must be able to start the same activity, so
    // it cannot be closed to everything but the NFC service.
    expect(MAIN_ACTIVITY).not.toContain('android:permission=');
  });

  test('is forwarded to Linking by React Native itself', () => {
    // The app adds no code for this lane: React Native reads an NDEF intent
    // that carries a URI as it reads a VIEW intent, at launch and while
    // running. If an upgrade drops either, a tag opens the app and nothing
    // else happens.
    const reactAndroid = [
      'node_modules',
      'react-native',
      'ReactAndroid',
      'src',
      'main',
      'java',
      'com',
      'facebook',
      'react',
    ];
    for (const file of [
      ['modules', 'intent', 'IntentModule.kt'],
      ['runtime', 'ReactHostImpl.kt'],
    ]) {
      expect(read(...reactAndroid, ...file)).toContain(
        'NfcAdapter.ACTION_NDEF_DISCOVERED == action',
      );
    }
    // And the activity leaves new intents to React Native.
    expect(
      read(
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'chicory',
        'MainActivity.kt',
      ),
    ).not.toContain('onNewIntent');
  });

  test('needs a guarded alias once the app targets Android 17', () => {
    // From API 37 an app that targets it is sent NFC intents only on a
    // component guarded by DISPATCH_NFC_MESSAGE. The main activity cannot
    // carry that guard (above), so raising the target means moving these
    // filters to an activity-alias that does. Until then this holds the line.
    const target = Number(
      /targetSdkVersion\s*=\s*(\d+)/.exec(read('android', 'build.gradle'))?.[1],
    );
    expect(target).toBeGreaterThan(0);
    if (target > 36) {
      expect(MANIFEST_CODE).toMatch(
        /<activity-alias\s[^>]*android:permission="android\.permission\.DISPATCH_NFC_MESSAGE"/,
      );
    }
  });
});
