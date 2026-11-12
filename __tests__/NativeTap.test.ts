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

const KOTLIN = read(
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'chicory',
  'NfcReaderModule.kt',
);
/** The Kotlin without its comments, which say what it must never do. */
const KOTLIN_CODE = KOTLIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^\s*\/\/.*$/gm,
  '',
);
const SEAM = read('src', 'services', 'tapReader.ts');

/** The codes the seam knows a read to end with. */
const seamCodes = () =>
  [...SEAM.matchAll(/'(TAP_[A-Z_]+)'/g)].map(match => match[1]);

describe('the reader the payment scanner listens with on Android', () => {
  test('may use NFC, on a phone that has it or not', () => {
    expect(MANIFEST_CODE).toMatch(
      /<uses-permission\s+android:name="android\.permission\.NFC"\s*\/>/,
    );
    // Without this the store would hide the wallet from a phone with no NFC.
    expect(MANIFEST_CODE).toMatch(
      /<uses-feature\s+android:name="android\.hardware\.nfc"\s+android:required="false"\s*\/>/,
    );
  });

  test('is registered by hand, under the name the seam asks for', () => {
    expect(
      read(
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'chicory',
        'MainApplication.kt',
      ),
    ).toContain('add(NfcReaderPackage())');
    expect(KOTLIN_CODE).toContain('override fun getName() = "ChicoryNfc"');
    expect(SEAM).toContain('NativeModules.ChicoryNfc');
  });

  test('answers the calls the seam makes, and no others', () => {
    const methods = [
      ...KOTLIN_CODE.matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g),
    ].map(match => match[1]);
    expect(methods.sort()).toEqual(['cancel', 'read', 'status']);
    const asked = /interface NativeTap \{([\s\S]*?)\n\}/.exec(SEAM)?.[1] ?? '';
    expect(
      [...asked.matchAll(/^\s*(\w+)\(/gm)].map(match => match[1]).sort(),
    ).toEqual(methods);
  });

  test('ends a read only with a code the seam knows', () => {
    const used = new Set(
      [...KOTLIN_CODE.matchAll(/"(TAP_[A-Z_]+)"/g)].map(match => match[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    const known = seamCodes();
    for (const code of used) expect(known).toContain(code);
    for (const status of ['"missing"', '"off"', '"ready"'])
      expect(KOTLIN_CODE).toContain(status);
  });

  test('lets Android read the tag, whole, and never speaks to it', () => {
    // A terminal counts a tap only once its message is read to the end.
    // Android does that before it reports a tag, unless told to skip it.
    expect(KOTLIN_CODE).not.toContain('SKIP_NDEF_CHECK');
    expect(KOTLIN_CODE).toContain('cachedNdefMessage');
    for (const call of ['.connect(', '.transceive(', 'IsoDep', 'ndefMessage'])
      expect(KOTLIN_CODE).not.toContain(call);
    // The phone's own sound would come before the app knows what it read.
    expect(KOTLIN_CODE).toContain('FLAG_READER_NO_PLATFORM_SOUNDS');
  });

  test('asks Android not to offer the same tag again, where Android can be asked', () => {
    // NfcAdapter.ignore is API 26, and the app runs on 24.
    const guarded =
      /if \([^)]*Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.O\) \{[\s\S]*?\.ignore\(/;
    expect(KOTLIN_CODE).toMatch(guarded);
    expect(KOTLIN_CODE.match(/\.ignore\(/g)).toHaveLength(1);
  });

  test('gives the radio back when the read is called off or its host goes', () => {
    expect(KOTLIN_CODE.match(/disableReaderMode\(/g)).toHaveLength(1);
    for (const hook of ['fun cancel(', 'fun onHostDestroy(', 'fun invalidate('])
      expect(KOTLIN_CODE).toContain(hook);
    // The activity is not part of it: its onCreate is pinned by the privacy
    // cover's own test, and it leaves NFC to the module.
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
    ).not.toMatch(/nfc/i);
  });

  test('passes records on as bytes, and reads nothing into them', () => {
    expect(KOTLIN_CODE).toContain('Base64.NO_WRAP');
    for (const field of ['"tnf"', '"type"', '"payload"'])
      expect(KOTLIN_CODE).toContain(field);
    // What a record says is src/services/ndef.ts's to decide.
    expect(KOTLIN_CODE).not.toMatch(/lightning|bitcoin|toUri\(/i);
  });
});
