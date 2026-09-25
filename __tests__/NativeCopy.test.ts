import { filesUnder, fs, path, ROOT } from '../test-support/node';

/**
 * The launch screens say nothing (REDESIGN.md rule 1). Before React draws its
 * first frame each platform shows a screen of its own, and a word there is
 * the first text anyone sees: the old storyboard wrote "chicory" and "Powered
 * by React Native". Both platforms now open on plain roast.
 */
const read = (...parts: string[]) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const STORYBOARD = read('ios', 'chicory', 'LaunchScreen.storyboard');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
/** One of the Android app's default resource files. */
const values = (file: string) =>
  fs.readFileSync(path.join(RES, 'values', file), 'utf8');

/** Roast, #110E0C, as the storyboard spells a colour: one channel at a time. */
const ROAST = { red: 17 / 255, green: 14 / 255, blue: 12 / 255 };

describe('the iOS launch screen', () => {
  test('holds no text: no labels, buttons or text views, and no text attributes', () => {
    expect(STORYBOARD).not.toMatch(/<(label|button|textView|textField)\b/);
    expect(STORYBOARD).not.toMatch(/\b(text|title|placeholder)="/);
    expect(STORYBOARD).not.toMatch(/<string\b/);
  });

  test('is plain roast', () => {
    const colors = [
      ...STORYBOARD.matchAll(/<color key="backgroundColor"[^>]*>/g),
    ];
    expect(colors).toHaveLength(1);
    const [color] = colors[0];
    for (const [channel, value] of Object.entries(ROAST)) {
      const found = color.match(new RegExp(`\\b${channel}="([\\d.]+)"`));
      expect(Number(found?.[1])).toBeCloseTo(value, 4);
    }
    expect(color).toContain('alpha="1"');
    expect(STORYBOARD).not.toMatch(/<imageView\b/);
  });
});

describe('the Android launch window', () => {
  test('its strings hold the app name and nothing else', () => {
    const files = filesUnder(RES, /^strings\.xml$/);
    expect(files.map(file => path.relative(RES, file))).toEqual([
      path.join('values', 'strings.xml'),
    ]);
    const names = [
      ...values('strings.xml').matchAll(/<string\s+name="([^"]+)"/g),
    ].map(match => match[1]);
    expect(names).toEqual(['app_name']);
  });

  test('its window and splash backgrounds are plain roast', () => {
    const colors = values('colors.xml');
    expect(colors).toMatch(/<color name="brandBackground">#110E0C<\/color>/i);
    const styles = values('styles.xml');
    expect(styles).toMatch(
      /name="android:windowBackground">@color\/brandBackground</,
    );
    expect(styles).toMatch(
      /name="android:windowSplashScreenBackground"[^>]*>@color\/brandBackground</,
    );
  });
});
