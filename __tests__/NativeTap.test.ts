/**
 * Tap to pay's native half (docs/TAP-TO-PAY.md): a payment request read from
 * an NFC tag, such as a payment terminal presents, reaches Send as a link
 * does. These read the native sources as text, since no Jest run has a radio.
 */
import { parsePayment } from '@beignet/wallet-core';

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

/** The activity, without its comments. */
const ACTIVITY_CODE = read(
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'chicory',
  'MainActivity.kt',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The body of the function that begins `head`. */
function bodyOf(code: string, head: string): string {
  const at = code.indexOf(head);
  expect(at).toBeGreaterThan(-1);
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') depth -= 1;
    if (depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`No end to ${head}`);
}

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
    // React Native reads an NDEF intent that carries a URI as it reads a
    // VIEW intent, at launch and while running. If an upgrade drops either,
    // a tag opens the app and nothing else happens.
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
  });

  test('is the request Send opens on after Android took the app back, and no older one', () => {
    // Android takes a waiting app's process back freely and keeps its
    // activity on record. A tag held to the phone after that builds the
    // activity again with the intent it was FIRST made for, and hands over
    // the new one before JavaScript is up. React Native tells only a running
    // app of a new intent, and at launch reads the one the activity holds.
    // Left alone, that tap opened the app on Home, or on the request before
    // it. Seen on an Android 17 emulator (docs/TAP-TO-PAY.md).
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
    expect(
      read(...reactAndroid, 'modules', 'intent', 'IntentModule.kt'),
    ).toContain('val intent = currentActivity.intent');
    expect(read(...reactAndroid, 'runtime', 'ReactHostImpl.kt')).toMatch(
      /override fun onNewIntent\(intent: Intent\) \{\s*val currentContext = currentReactContext\s*if \(currentContext != null\) \{/,
    );

    // So the activity keeps the newest intent as its own.
    const fresh = bodyOf(
      ACTIVITY_CODE,
      'override fun onNewIntent(intent: Intent)',
    );
    expect(fresh).toMatch(
      /^\s*super\.onNewIntent\(intent\)\s*setIntent\(intent\)\s*$/,
    );

    // And one built again, from saved state or from the recents list, forgets
    // the request it was first made for: opening the app must never open
    // Send on a request already dealt with.
    const rebuilt = bodyOf(
      ACTIVITY_CODE,
      'override fun onPostCreate(savedInstanceState: Bundle?)',
    );
    expect(rebuilt).toContain('Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY');
    expect(rebuilt).toMatch(
      /if \(savedInstanceState != null \|\| fromRecents\) \{\s*setIntent\(Intent\(intent\)\.setData\(null\)\)\s*\}/,
    );
    // A first launch, by a tag or a link, keeps its request to be read once.
    expect(ACTIVITY_CODE.match(/setData\(null\)/g)).toHaveLength(1);
  });

  test('is read by an app still running when a new activity is made for it', () => {
    // Back at Home closes the activity on Android 7 to 11 and leaves the app
    // running. The tag that comes next makes a new activity, and a running
    // app is told only of an intent handed to an activity it already has. So
    // the app reads the launch URL once for each time it is mounted
    // (src/services/links.ts), which holds only while React Native mounts it
    // once for each activity: stopped as one is destroyed, started as the
    // next is made.
    const delegate = read(
      'node_modules',
      'react-native',
      'ReactAndroid',
      'src',
      'main',
      'java',
      'com',
      'facebook',
      'react',
      'ReactDelegate.kt',
    );
    expect(delegate).toMatch(/public fun onHostDestroy\(\) \{\s*unloadApp\(\)/);
    expect(delegate).toMatch(
      /public fun unloadApp\(\) \{[\s\S]*?reactSurface\?\.stop\(\)/,
    );
    const links = read('src', 'services', 'links.ts');
    expect(links).toMatch(
      /Platform\.OS === 'android' \? consumedHere\.current : initialConsumed/,
    );
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

  test('asks Android not to offer the same tag again, on every Android the app runs on', () => {
    expect(KOTLIN_CODE.match(/\.ignore\(/g)).toHaveLength(1);
    // NfcAdapter.ignore came with API 24, which is the oldest the app takes,
    // so no version stands between a tag and the ask. A phone left out of it
    // would have only the link lane's memory of the tap to fall back on.
    expect(KOTLIN_CODE).not.toMatch(/SDK_INT|VERSION_CODES/);
    const oldest = Number(
      /minSdkVersion = (\d+)/.exec(read('android', 'build.gradle'))?.[1],
    );
    expect(oldest).toBeGreaterThanOrEqual(24);
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

const SWIFT = read('ios', 'chicory', 'NfcReaderModule.swift');
/** The Swift without its comments. */
const SWIFT_CODE = SWIFT.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^\s*\/\/.*$/gm,
  '',
);
const EXTERNS = read('ios', 'chicory', 'NfcReaderModule.m');
const PLIST = read('ios', 'chicory', 'Info.plist');
const ENTITLEMENTS = read('ios', 'chicory', 'chicory.entitlements');
const PROJECT = read('ios', 'chicory.xcodeproj', 'project.pbxproj');

/** The string an Info.plist key holds, or undefined. */
const plistString = (key: string) =>
  PLIST.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];

describe('the reader the payment scanner asks on an iPhone', () => {
  test('says what NFC is for, in words that name Chicory', () => {
    // Without this line iOS ends the app the moment a read is asked for.
    expect(plistString('NFCReaderUsageDescription')).toBe(
      'Chicory uses NFC only to read a payment request from a payment terminal. Nothing is stored or sent.',
    );
  });

  test('is not required of the phone', () => {
    const required =
      /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
        PLIST,
      )?.[1] ?? '';
    expect(required).toContain('<string>arm64</string>');
    expect(required).not.toMatch(/nfc/i);
  });

  test('is entitled to read tags, in the one format the store accepts', () => {
    const formats =
      /<key>com\.apple\.developer\.nfc\.readersession\.formats<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
        ENTITLEMENTS,
      )?.[1] ?? '';
    // NDEF beside TAG is refused at upload (ITMS-90778). TAG covers it.
    expect(
      [...formats.matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1]),
    ).toEqual(['TAG']);
    // And nothing else is asked for.
    expect(ENTITLEMENTS.match(/<key>/g)).toHaveLength(1);
  });

  test('is signed with that entitlement in both configurations, and no team is committed', () => {
    expect(
      PROJECT.match(
        /CODE_SIGN_ENTITLEMENTS = chicory\/chicory\.entitlements;/g,
      ),
    ).toHaveLength(2);
    expect(PROJECT).not.toMatch(/DEVELOPMENT_TEAM\s*=\s*\w/);
    expect(PROJECT).not.toContain('PROVISIONING_PROFILE');
  });

  test('is compiled into the app: both sources are in the project', () => {
    for (const file of ['NfcReaderModule.swift', 'NfcReaderModule.m']) {
      expect(PROJECT).toContain(
        `/* ${file} in Sources */ = {isa = PBXBuildFile;`,
      );
      expect(PROJECT).toContain(`path = chicory/${file};`);
    }
    expect(PROJECT).toContain('path = chicory/chicory.entitlements;');
  });

  test('goes by the name the seam asks for, and answers the calls it makes', () => {
    expect(SWIFT_CODE).toContain('@objc(ChicoryNfc)');
    expect(EXTERNS).toContain('RCT_EXTERN_MODULE(ChicoryNfc, NSObject)');
    const exported = [...EXTERNS.matchAll(/RCT_EXTERN_METHOD\((\w+):/g)].map(
      match => match[1],
    );
    expect(exported.sort()).toEqual(['cancel', 'read', 'status']);
    for (const method of exported)
      expect(SWIFT_CODE).toMatch(new RegExp(`@objc func ${method}\\(`));
    // The same calls the Android reader answers.
    const android = [
      ...KOTLIN_CODE.matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g),
    ].map(match => match[1]);
    expect(android.sort()).toEqual(exported);
  });

  test('ends a read only with a code the seam knows', () => {
    const used = new Set(
      [...SWIFT_CODE.matchAll(/"(TAP_[A-Z_]+)"/g)].map(match => match[1]),
    );
    const known = seamCodes();
    for (const code of used) expect(known).toContain(code);
    // A build signed without the entitlement says so, and the seam then
    // answers that the phone cannot read.
    expect(used).toContain('TAP_UNAVAILABLE');
    expect(SWIFT_CODE).toContain('readerErrorSecurityViolation');
  });

  test('lets Core NFC read the tag, whole, and never speaks to it', () => {
    expect(SWIFT_CODE).toContain('NFCNDEFReaderSession(');
    expect(SWIFT_CODE).toContain('didDetectNDEFs');
    for (const lower of [
      'NFCTagReaderSession',
      'sendCommand',
      'NFCISO7816',
      'readNDEF',
    ])
      expect(SWIFT_CODE).not.toContain(lower);
  });

  test('keeps its session until it ends, since the session will not', () => {
    // A session holds its delegate weakly. Left unheld it is gone before
    // the sheet is, and the read never answers.
    expect(SWIFT_CODE).toMatch(/private var session: NFCNDEFReaderSession\?/);
    expect(SWIFT_CODE).toContain('self.session = session');
  });

  test('takes its sheet down at the deadline the seam keeps', () => {
    const native = Number(
      /deadlineSeconds: TimeInterval = (\d+)/.exec(SWIFT_CODE)?.[1],
    );
    const seam = Number(
      /TAP_DEADLINE_MS = ([\d_]+)/.exec(SEAM)?.[1].replace(/_/g, ''),
    );
    expect(native).toBeGreaterThan(0);
    expect(native * 1000).toBe(seam);
  });

  test('holds no words: the line on its sheet comes from the scan', () => {
    expect(SWIFT_CODE).toContain('session.alertMessage = prompt');
    expect(SWIFT_CODE.match(/alertMessage/g)).toHaveLength(1);
    expect(read('src', 'components', 'Scanner.tsx')).toContain(
      'reader.read(copy.scan.tapPrompt)',
    );
    // What a record says is src/services/ndef.ts's to decide.
    expect(SWIFT_CODE).not.toMatch(/lightning|bitcoin/i);
  });
});

const TILL = ['native-tests', 'tap-till'];
const TILL_TAG = read(
  ...TILL,
  'app',
  'src',
  'main',
  'java',
  'com',
  'chicory',
  'taptill',
  'Type4Tag.kt',
);

describe('the test till that stands in for a terminal', () => {
  test('is no part of the wallet: its own project and its own application', () => {
    // The wallet's build names one project, and nothing in it reaches the till.
    const settings = read('android', 'settings.gradle');
    expect(settings.match(/^include\b.*$/gm)).toEqual(["include ':app'"]);
    for (const build of [
      settings,
      read('android', 'build.gradle'),
      read('android', 'app', 'build.gradle'),
    ])
      expect(build).not.toMatch(/tap-till|taptill/);
    expect(read(...TILL, 'settings.gradle')).toContain(
      "rootProject.name = 'tap-till'",
    );
    const app = read(...TILL, 'app', 'build.gradle');
    expect(app).toContain("applicationId 'com.chicory.taptill'");
    expect(app).not.toMatch(/applicationId 'com\.chicory'/);
  });

  test('cannot reach a network and answers only to the NFC service', () => {
    const manifest = read(...TILL, 'app', 'src', 'main', 'AndroidManifest.xml');
    expect(
      [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(
        match => match[1],
      ),
    ).toEqual(['android.permission.NFC']);
    expect(manifest).toContain(
      'android:permission="android.permission.BIND_NFC_SERVICE"',
    );
  });

  test('presents the tag the doc describes', () => {
    const service = read(
      ...TILL,
      'app',
      'src',
      'main',
      'res',
      'xml',
      'apdu_service.xml',
    );
    // The NDEF application, and no other.
    expect(
      [...service.matchAll(/<aid-filter android:name="([^"]+)"/g)].map(
        match => match[1],
      ),
    ).toEqual(['D2760000850101']);
    const doc = read('docs', 'TAP-TO-PAY.md');
    for (const said of ['D2760000850101', 'E103', 'E104', 'C1'])
      expect(doc).toContain(said);
    expect(TILL_TAG).toContain(
      'bytes(0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01)',
    );
    expect(TILL_TAG).toContain('CC_FILE_ID = bytes(0xE1, 0x03)');
    expect(TILL_TAG).toContain('NDEF_FILE_ID = bytes(0xE1, 0x04)');
    expect(TILL_TAG).toContain('const val MAX_READ = 0xFF');
  });

  test('presents by default an invoice the wallet reads and nobody is paid by', () => {
    const sample = /const val SAMPLE = "([^"]+)"/.exec(
      read(
        ...TILL,
        'app',
        'src',
        'main',
        'java',
        'com',
        'chicory',
        'taptill',
        'TillService.kt',
      ),
    )?.[1];
    expect(sample).toMatch(/^lightning:LNBC[0-9A-Z]+$/);
    const parsed = parsePayment(sample!);
    expect(parsed.kind).toBe('bolt11');
    expect(parsed).toMatchObject({ network: 'mainnet', amountSats: 24425 });
  });
});

/**
 * The other half (docs/TAP-TO-PAY.md): Receive presents its request as a tag
 * on Android, so a phone held to this one reads it. An iPhone app cannot act
 * as a tag, so there is nothing of it on iOS.
 */
describe('the tag Receive presents on Android', () => {
  const kotlin = (name: string) =>
    read('android', 'app', 'src', 'main', 'java', 'com', 'chicory', name)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const MODULE = kotlin('NfcPresenterModule.kt');
  const SERVICE = kotlin('NfcPresenterService.kt');
  const TAG = kotlin('PresentedTag.kt');
  const PRESENTER = read('src', 'services', 'tapPresenter.ts');
  const REGISTRATION = read(
    'android',
    'app',
    'src',
    'main',
    'res',
    'xml',
    'apduservice.xml',
  ).replace(/<!--[\s\S]*?-->/g, '');
  const service = /<service\s[\s\S]*?<\/service>/.exec(MANIFEST_CODE)?.[0];

  test('is served by one service, which only the NFC service may bind', () => {
    expect(MANIFEST_CODE.match(/<service\s/g)).toHaveLength(1);
    expect(service).toContain('android:name=".NfcPresenterService"');
    expect(service).toContain(
      'android:permission="android.permission.BIND_NFC_SERVICE"',
    );
    expect(service).toContain(
      'android.nfc.cardemulation.action.HOST_APDU_SERVICE',
    );
    expect(service).toMatch(
      /android:name="android\.nfc\.cardemulation\.host_apdu_service"\s+android:resource="@xml\/apduservice"/,
    );
    expect(SERVICE).toContain('class NfcPresenterService : HostApduService()');
  });

  test('asks for no permission of its own, and is not required of the phone', () => {
    expect(
      [...MANIFEST_CODE.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)]
        .map(match => match[1])
        .sort(),
    ).toEqual([
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.NFC',
      'android.permission.USE_BIOMETRIC',
    ]);
    // Without this the store would hide the wallet from a phone that cannot
    // act as a tag.
    expect(MANIFEST_CODE).toMatch(
      /<uses-feature\s+android:name="android\.hardware\.nfc\.hce"\s+android:required="false"\s*\/>/,
    );
  });

  test('claims nothing a reader looks for until a request is presented', () => {
    // The manifest registers a private placeholder alone. The NDEF
    // application every reader asks for would otherwise be the wallet's to
    // answer with no request on screen, and Android would offer the wallet
    // beside any other app that acts as a tag.
    const names = [
      ...REGISTRATION.matchAll(/<aid-filter\s+android:name="([^"]+)"/g),
    ].map(match => match[1]);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^F0([0-9A-F]{2}){4,15}$/);
    expect(REGISTRATION).not.toContain('D2760000850101');
    expect(REGISTRATION.match(/<aid-group\b/g)).toHaveLength(1);
    // Never a payment card: the phone's own wallet keeps that category.
    expect(REGISTRATION).toContain('android:category="other"');
    expect(REGISTRATION).not.toContain('payment');
    expect(REGISTRATION).toContain('android:requireDeviceUnlock="true"');
    // The tag itself refuses the placeholder too.
    expect(TAG).toContain('NDEF_APPLICATION_NAME = "D2760000850101"');
  });

  test('ships no words of its own: both descriptions are the name of the app', () => {
    expect(
      [...REGISTRATION.matchAll(/android:description="([^"]+)"/g)].map(
        match => match[1],
      ),
    ).toEqual(['@string/app_name', '@string/app_name']);
    expect(
      read('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    ).not.toMatch(/nfc|tap|tag/i);
  });

  test('is registered by hand, under the name the seam asks for, on Android alone', () => {
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
    ).toContain('add(NfcPresenterPackage())');
    expect(MODULE).toContain('override fun getName() = "ChicoryNfcPresenter"');
    expect(PRESENTER).toContain('NativeModules.ChicoryNfcPresenter');
    expect(PRESENTER).toMatch(/Platform\.OS === 'android'/);
    for (const source of [SWIFT, EXTERNS, PROJECT])
      expect(source).not.toMatch(/Presenter|HostApdu|cardemulation/i);
    // The entitlement an iPhone would need to act as a tag is not asked for.
    expect(ENTITLEMENTS).not.toMatch(/hce|card-session|contactless/i);
  });

  test('answers the calls the seam makes, and no others', () => {
    const methods = [
      ...MODULE.matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g),
    ].map(match => match[1]);
    expect(methods.sort()).toEqual(['present', 'status', 'withdraw']);
    const asked =
      /interface NativePresenter \{([\s\S]*?)\n\}/.exec(PRESENTER)?.[1] ?? '';
    expect(
      [...asked.matchAll(/^\s*(\w+)\(/gm)].map(match => match[1]).sort(),
    ).toEqual(methods);
    for (const status of ['"missing"', '"off"', '"ready"'])
      expect(MODULE).toContain(status);
    expect(MODULE).toContain('FEATURE_NFC_HOST_CARD_EMULATION');
  });

  test('claims the NDEF application as it presents, and gives it back as it withdraws', () => {
    const present = bodyOf(MODULE, 'fun present(');
    expect(MODULE.match(/registerAidsForService\(/g)).toHaveLength(1);
    expect(present).toContain('registerAidsForService(');
    expect(present).toContain('PresentedTag.NDEF_APPLICATION_NAME');
    expect(present).toContain('CardEmulation.CATEGORY_OTHER');
    // One way to give it back, which the module, a new process and the
    // service itself all use.
    expect(`${MODULE}${SERVICE}`.match(/removeAidsForService\(/g)).toHaveLength(
      1,
    );
    const withdrawn = bodyOf(MODULE, 'private fun withdrawNow(');
    expect(withdrawn).toContain('Presented.clear()');
    expect(withdrawn).toContain('NfcPresenterService.release(context)');
    // What is presented goes before the claim does.
    expect(withdrawn.indexOf('Presented.clear()')).toBeLessThan(
      withdrawn.indexOf('NfcPresenterService.release(context)'),
    );
    // A process that ended while it presented left its claim behind.
    expect(bodyOf(MODULE, 'init {')).toContain(
      'NfcPresenterService.release(context)',
    );
  });

  test('is the service Android prefers while it presents, so no chooser is shown', () => {
    expect(MODULE.match(/\.setPreferredService\(/g)).toHaveLength(1);
    expect(MODULE.match(/\.unsetPreferredService\(/g)).toHaveLength(1);
    expect(bodyOf(MODULE, 'private fun withdrawNow(')).toContain(
      'unsetPreferredService(',
    );
  });

  test('presents only in front, only a request still in time, and withdraws by itself', () => {
    const present = bodyOf(MODULE, 'fun present(');
    expect(present).toContain('LifecycleState.RESUMED');
    expect(present).toContain('until <= now');
    expect(present).toContain('PresentedTag.MAX_MESSAGE');
    // A refusal leaves nothing presented, not the request before it, and
    // every way out of presenting that is not presenting is a refusal.
    expect(bodyOf(MODULE, 'private fun refuse(')).toContain('withdrawNow()');
    expect(present.match(/refuse\(/g)!.length).toBeGreaterThanOrEqual(3);
    expect(present.match(/promise\.resolve\(/g)).toHaveLength(1);
    expect(present).toContain('promise.resolve("presented")');
    // JavaScript may be paused by the time any of these happens.
    for (const hook of [
      'override fun onHostPause(',
      'override fun onHostDestroy(',
      'override fun invalidate(',
    ])
      expect(bodyOf(MODULE, hook)).toContain('withdrawNow()');
    expect(present).toContain('main.postDelayed(runOut, until - now)');
    expect(MODULE).toContain('private val runOut = Runnable { withdrawNow() }');
    // The pause is handled inside the activity's own onPause, where Android
    // still lets the preference be dropped.
    expect(bodyOf(MODULE, 'override fun onHostPause(')).not.toContain(
      'runOnUiThread',
    );
  });

  test('says why it is not presenting only with a code the seam knows', () => {
    const used = new Set(
      [...MODULE.matchAll(/"(TAP_[A-Z_]+)"/g)].map(match => match[1]),
    );
    const known = [...PRESENTER.matchAll(/'(TAP_[A-Z_]+)'/g)].map(
      match => match[1],
    );
    expect(used.size).toBe(5);
    for (const code of used) expect(known).toContain(code);
    expect(new Set(known)).toEqual(used);
  });

  test("writes codes, counts and sizes to the phone's log, and never a request", () => {
    const lines = `${MODULE}\n${SERVICE}`
      .split('\n')
      .filter(line => /\bLog\./.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const logged = `${MODULE}\n${SERVICE}`.match(
      /Log\.\w+\(\s*[\s\S]*?\n?\s*\)\n/g,
    )!;
    for (const call of logged) {
      // The bytes are counted and never written out.
      expect(call).not.toMatch(
        /\$\{?message|\$bytes|\$\{bytes\}|Base64|String\(/,
      );
    }
    expect(`${MODULE}${SERVICE}${TAG}`).not.toMatch(/Log\.[we]\(|println\(/);
  });

  test('answers a reader from what is presented now, whatever is registered', () => {
    const answer = bodyOf(SERVICE, 'override fun processCommandApdu(');
    expect(answer).toContain('return Presented.answer(command, now)');
    expect(answer).toContain('System.currentTimeMillis()');
    // A claim left behind is given back the first time a reader finds it,
    // unless a request has been presented by the time it would be.
    expect(answer).toMatch(
      /post \{\s+if \(!Presented\.any\(System\.currentTimeMillis\(\)\)\) release\(applicationContext\)\s+\}/,
    );
    const any = bodyOf(TAG, 'fun any(now: Long)');
    expect(any).toContain('now >= until');
    expect(TAG).toMatch(
      /fun answer\(command: ByteArray, now: Long\): ByteArray =\s+if \(any\(now\)\) tag!!\.answer\(command\) else PresentedTag\.NOT_FOUND/,
    );
  });

  test('serves bytes and reads nothing into them', () => {
    // What a request says is written in src/services/ndef.ts.
    for (const source of [MODULE, SERVICE, TAG]) {
      expect(source).not.toMatch(/lightning|bitcoin|NdefMessage|NdefRecord/i);
    }
    expect(PRESENTER).toContain('uriMessage(presentedUri(request))');
    expect(bodyOf(MODULE, 'fun present(')).toContain('Base64.decode(');
  });

  test('never turns the reader on, which would switch the tag off, and the reader never presents', () => {
    for (const source of [MODULE, SERVICE, TAG])
      expect(source).not.toMatch(/ReaderMode|ReaderCallback/);
    expect(KOTLIN_CODE).not.toMatch(/CardEmulation|HostApdu|Presented/);
    expect(read('src', 'scenes', 'receive', 'presenting.ts')).not.toMatch(
      /tapReader\(/,
    );
  });

  test('takes no more than the wallet reads, on either side', () => {
    const cap = (source: string, name: string) =>
      new RegExp(`${name} = 8 \\* 1024`).test(source);
    expect(cap(read('src', 'services', 'ndef.ts'), 'MAX_MESSAGE_BYTES')).toBe(
      true,
    );
    expect(cap(KOTLIN_CODE, 'MAX_MESSAGE_BYTES')).toBe(true);
    expect(cap(TAG, 'MAX_MESSAGE')).toBe(true);
  });

  test('is read in a unit test as a phone reads a tag, since no emulator has a radio', () => {
    expect(read('android', 'app', 'build.gradle')).toContain(
      'testImplementation("junit:junit:4.13.2")',
    );
    const tests = read(
      'android',
      'app',
      'src',
      'test',
      'java',
      'com',
      'chicory',
      'PresentedTagTest.kt',
    );
    expect(tests.match(/@Test fun /g)!.length).toBeGreaterThanOrEqual(12);
  });
});
