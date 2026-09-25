import { fs, path, ROOT } from '../test-support/node';

/**
 * What the native shells do before and around React (REDESIGN.md 3.1, 6).
 *
 * The launch screen is roast, and so must be everything shown before React
 * draws its first frame: a window or root view left at the system
 * background flashes near white between the launch screen and the opening
 * phase. And a payment link opened while the app runs has to reach
 * React Native's Linking, or nothing happens.
 */
const APP_DELEGATE = fs.readFileSync(
  path.join(ROOT, 'ios', 'chicory', 'AppDelegate.swift'),
  'utf8',
);

/** The code alone, without its comments. */
const CODE = APP_DELEGATE.replace(/\/\/.*$/gm, '').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** A colour the code names by its channels out of 255. */
function colourOf(name: string) {
  const match = CODE.match(
    new RegExp(
      `let ${name} = UIColor\\(red: (\\d+) / 255, green: (\\d+) / 255, blue: (\\d+) / 255, alpha: 1\\)`,
    ),
  );
  return match?.slice(1, 4).map(Number);
}

describe('the iOS app delegate', () => {
  test('paints the window and the root view roast before React draws', () => {
    expect(colourOf('roast')).toEqual([0x11, 0x0e, 0x0c]);
    expect(CODE).toMatch(/window\?\.backgroundColor = roast/);
    // The root view is the root view controller's view once React starts.
    const start = CODE.indexOf('factory.startReactNative(');
    const painted = CODE.indexOf(
      'window?.rootViewController?.view.backgroundColor = roast',
    );
    expect(start).toBeGreaterThan(-1);
    expect(painted).toBeGreaterThan(start);
    // The window is painted before it is handed to React.
    expect(CODE.indexOf('window?.backgroundColor = roast')).toBeLessThan(start);
  });

  test('hands links opened while the app runs to React Native', () => {
    expect(CODE).toMatch(
      /func application\(\s*_ app: UIApplication,\s*open url: URL,\s*options: \[UIApplication\.OpenURLOptionsKey: Any\] = \[:\]\s*\) -> Bool \{\s*return RCTLinkingManager\.application\(app, open: url, options: options\)/,
    );
    expect(CODE).toMatch(
      /func application\(\s*_ application: UIApplication,\s*continue userActivity: NSUserActivity,[\s\S]*?return RCTLinkingManager\.application\(\s*application,\s*continue: userActivity,/,
    );
  });
});

describe('the Android window', () => {
  test('opens on roast, so the first frame never shows the light theme', () => {
    const res = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
    const values = (file: string) =>
      fs.readFileSync(path.join(res, 'values', file), 'utf8');
    expect(values('colors.xml')).toMatch(
      /<color name="brandBackground">#110E0C<\/color>/i,
    );
    expect(values('styles.xml')).toMatch(
      /name="android:windowBackground">@color\/brandBackground</,
    );
  });
});
