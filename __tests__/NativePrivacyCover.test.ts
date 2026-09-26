import { fs, path, ROOT } from '../test-support/node';

/**
 * The privacy cover's native half (REDESIGN.md 6, app switcher).
 *
 * iOS starts the app switcher from a picture it takes as the app goes
 * inactive, before React draws the stage's cover, so the balance showed in
 * the outgoing card for a moment. The app delegate puts a plain roast view
 * over the window in that same call, unless a prompt the app raised is up
 * or the lock is what is drawn, which JavaScript tells it through the
 * `PrivacyCover` module.
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

  test('covers as the app goes inactive, unless a prompt the app raised is up or the lock is drawn', () => {
    const resign = bodyOf(
      CODE,
      'func applicationWillResignActive(_ application: UIApplication)',
    );
    expect(resign).toMatch(
      /^\s*if PrivacyCover\.systemPromptOpen \|\| PrivacyCover\.lockShown \{\s*return\s*\}\s*showPrivacyCover\(\)\s*$/,
    );
  });

  test('covers in the background whatever it was told', () => {
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

describe('the PrivacyCover module', () => {
  const MODULE = codeOf(read('ios', 'chicory', 'PrivacyCover.m'));
  const HEADER = codeOf(read('ios', 'chicory', 'PrivacyCover.h'));

  test('is exported under its name, with blocking synchronous setters', () => {
    expect(MODULE).toMatch(/RCT_EXPORT_MODULE\(PrivacyCover\)/);
    // A method that returns a value runs on the JavaScript thread before
    // the call returns, so a flag is set before the prompt is raised.
    expect(MODULE).toMatch(
      /RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD\(setSystemPromptOpen : \(BOOL\)\w+\)/,
    );
    expect(MODULE).toMatch(
      /RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD\(setLockShown : \(BOOL\)\w+\)/,
    );
    expect(MODULE).not.toMatch(/RCT_EXPORT_METHOD/);
    // Written on the JavaScript thread, read on the main thread.
    expect(MODULE).toMatch(/static atomic_bool \w+ = false;/);
  });

  test('gives the app delegate what it reads', () => {
    expect(HEADER).toMatch(
      /@property \(class, nonatomic, readonly\) BOOL systemPromptOpen;/,
    );
    expect(HEADER).toMatch(
      /@property \(class, nonatomic, readonly\) BOOL lockShown;/,
    );
    expect(read('ios', 'chicory', 'chicory-Bridging-Header.h')).toMatch(
      /#import "PrivacyCover\.h"/,
    );
  });

  test('is what JavaScript calls, by the same names', () => {
    const js = read('src', 'stage', 'nativeCover.ts');
    expect(js).toMatch(/const modules = NativeModules;/);
    expect(js).toMatch(/modules\.PrivacyCover\b/);
    for (const name of ['setSystemPromptOpen', 'setLockShown']) {
      expect(js).toContain(`module.${name}(`);
      expect(MODULE).toContain(`(${name} :`);
    }
  });

  test('is built into the app', () => {
    const project = read('ios', 'chicory.xcodeproj', 'project.pbxproj');
    const ref =
      /(\w{24}) \/\* PrivacyCover\.m \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.c\.objc; name = PrivacyCover\.m; path = chicory\/PrivacyCover\.m;/.exec(
        project,
      )?.[1];
    expect(ref).toBeDefined();
    const build = new RegExp(
      `(\\w{24}) /\\* PrivacyCover\\.m in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ${ref} `,
    ).exec(project)?.[1];
    expect(build).toBeDefined();
    const sources =
      /\/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/.exec(
        project,
      )?.[1];
    expect(sources).toContain(`${build} /* PrivacyCover.m in Sources */`);
    expect(sources).toContain('/* AppDelegate.swift in Sources */');
    // Its header sits beside it in the app's group, and the Swift side
    // reads it through the bridging header, in both configurations.
    expect(project).toMatch(
      /\w{24} \/\* PrivacyCover\.h \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.c\.h; name = PrivacyCover\.h; path = chicory\/PrivacyCover\.h;/,
    );
    expect(
      project.match(
        /SWIFT_OBJC_BRIDGING_HEADER = "chicory\/chicory-Bridging-Header\.h";/g,
      ),
    ).toHaveLength(2);
    // Every object is named once.
    const ids = [...project.matchAll(/^\t\t(\w{24}) .*= \{/gm)].map(
      match => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
