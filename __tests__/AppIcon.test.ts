import { fs, path, ROOT } from '../test-support/node';

/**
 * The app icon, the open bloom on roast, as scripts/app-icon.mjs writes it
 * (REDESIGN.md 3.1). Every size each platform asks for is there, at its
 * size, and iOS's are opaque, as the App Store requires.
 */
const file = (...parts: string[]) => path.join(ROOT, ...parts);
const text = (...parts: string[]) => fs.readFileSync(file(...parts), 'utf8');

/** A PNG's size and whether it carries alpha, from its header chunk. */
function png(...parts: string[]) {
  const bytes = fs.readFileSync(file(...parts));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  expect(ascii(1, 4)).toBe('PNG');
  expect(ascii(12, 16)).toBe('IHDR');
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    // Colour types 4 and 6 carry alpha; 2, truecolour, does not.
    alpha: bytes[25] === 4 || bytes[25] === 6,
  };
}

test('iOS has an opaque icon at every size its icon set names', () => {
  const set = path.join(
    'ios',
    'chicory',
    'Images.xcassets',
    'AppIcon.appiconset',
  );
  const contents = JSON.parse(text(set, 'Contents.json'));
  expect(contents.images.length).toBeGreaterThan(0);
  for (const image of contents.images) {
    const px =
      Number(image.size.split('x')[0]) * Number(image.scale.replace('x', ''));
    expect(image.filename).toBeDefined();
    const icon = png(set, image.filename);
    expect(icon).toEqual({ width: px, height: px, alpha: false });
  }
});

describe('Android', () => {
  const RES = path.join('android', 'app', 'src', 'main', 'res');
  const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

  test('names the launcher icons it has', () => {
    const manifest = text(
      'android',
      'app',
      'src',
      'main',
      'AndroidManifest.xml',
    );
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
  });

  test('has an adaptive icon with a themed layer, from Android 8 on', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = text(RES, 'mipmap-anydpi-v26', name);
      expect(xml).toContain('@mipmap/ic_launcher_background');
      expect(xml).toContain('@mipmap/ic_launcher_foreground');
      expect(xml).toContain('@mipmap/ic_launcher_monochrome');
    }
  });

  test.each(Object.entries(DENSITIES))(
    'has every layer and older icon at %s',
    (density, factor) => {
      const dir = `mipmap-${density}`;
      for (const layer of ['background', 'foreground', 'monochrome']) {
        const icon = png(RES, dir, `ic_launcher_${layer}.png`);
        expect(icon.width).toBe(108 * factor);
        expect(icon.height).toBe(108 * factor);
      }
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const icon = png(RES, dir, name);
        expect(icon.width).toBe(48 * factor);
        expect(icon.height).toBe(48 * factor);
      }
    },
  );
});
