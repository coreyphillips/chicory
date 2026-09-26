import { fs, path, ROOT } from '../test-support/node';

/**
 * The privacy cover's native half (REDESIGN.md 6, app switcher).
 *
 * The picture the iOS app switcher keeps is taken once the app is in the
 * background, and React's cover reaches it only if JavaScript is free to
 * draw in time, so the app delegate puts a plain roast view over the window
 * as the app enters the background. It never does as the app merely turns
 * inactive, which a prompt the app raised does too. Android takes no recents
 * picture of the app at all from Android 13 on, and leaves the person's own
 * screenshots alone.
 */
const read = (...parts: string[]) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** Source without its comments, so a comment never passes for code. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The body of the first block that opens after `head`, braces balanced. */
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

describe('the iOS app delegate', () => {
  const CODE = codeOf(read('ios', 'chicory', 'AppDelegate.swift'));

  test('leaves the screen in view as the app merely turns inactive', () => {
    // A prompt the app raised makes it inactive too, and the screen stays
    // behind those; an app-to-app switch animates from a picture taken
    // before this call, which no cover reaches (P16).
    expect(CODE).not.toMatch(/applicationWillResignActive/);
    expect(CODE).not.toMatch(/\bPrivacyCover\./);
  });

  test('covers as the app enters the background', () => {
    const background = bodyOf(
      CODE,
      'func applicationDidEnterBackground(_ application: UIApplication)',
    );
    expect(background.trim()).toBe('showPrivacyCover()');
  });

  test('takes the cover away once the app is active again', () => {
    const active = bodyOf(
      CODE,
      'func applicationDidBecomeActive(_ application: UIApplication)',
    );
    expect(active).toMatch(/privacyCover\?\.removeFromSuperview\(\)/);
    expect(active).toMatch(/privacyCover = nil/);
  });

  test('draws the cover plain roast over everything in the window, at once', () => {
    const show = bodyOf(CODE, 'private func showPrivacyCover()');
    expect(show).toMatch(/UIView\(frame: window\.bounds\)/);
    expect(show).toMatch(/cover\.backgroundColor = roast/);
    expect(show).toMatch(/\.flexibleWidth, \.flexibleHeight/);
    // Added last, it is above the root view controller's view.
    expect(show).toMatch(/window\.addSubview\(cover\)/);
    // One cover at most, brought forward if it is already up.
    expect(show).toMatch(/window\.bringSubviewToFront\(cover\)/);
    expect(show).not.toMatch(/animate|alpha|transition/i);
  });
});

describe('the Android activity', () => {
  const CODE = codeOf(
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
  );

  test('takes no recents picture from Android 13 on', () => {
    const create = bodyOf(
      CODE,
      'override fun onCreate(savedInstanceState: Bundle?)',
    );
    expect(create).toMatch(
      /^\s*super\.onCreate\(savedInstanceState\)\s*if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU\) \{\s*setRecentsScreenshotEnabled\(false\)\s*\}\s*$/,
    );
  });

  test("leaves the person's own screenshots alone", () => {
    const kotlin = path.join(
      'android',
      'app',
      'src',
      'main',
      'java',
      'com',
      'chicory',
    );
    for (const file of ['MainActivity.kt', 'MainApplication.kt']) {
      expect(codeOf(read(kotlin, file))).not.toMatch(/FLAG_SECURE/);
    }
  });
});
