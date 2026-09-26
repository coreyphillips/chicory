/**
 * Draws the app icon, the open bloom on roast (REDESIGN.md 3.1), and writes
 * every size iOS and Android ask for:
 *
 * - iOS: ios/chicory/Images.xcassets/AppIcon.appiconset, one opaque PNG per
 *   entry in its Contents.json, which this names.
 * - Android: an adaptive icon (a roast background with the bloom's glow, the
 *   bloom as the foreground inside the 66dp safe circle, and a one-colour
 *   bloom for themed icons) in mipmap-anydpi-v26, and the square and round
 *   icons older launchers use, in each mipmap density.
 *
 * Run from the repository root after changing the bloom or the palette:
 *
 *   node scripts/app-icon.mjs
 *
 * It needs rsvg-convert (librsvg) and ImageMagick's magick on the PATH
 * (brew install librsvg imagemagick).
 *
 * The petal, the petals' lengths, the vein, the centre and the colours are
 * read from src/glyphs/Bloom.tsx and src/design/palette.ts rather than copied,
 * so the icon is the flower the app draws. Only the petals' angles are
 * restated: `angle(i)` in Bloom.tsx, 30 degrees apart, nudged so none sit
 * square.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const read = file => readFileSync(path.join(ROOT, file), 'utf8');

const bloom = read('src/glyphs/Bloom.tsx');
const paletteSource = read('src/design/palette.ts');

/** A string constant from Bloom.tsx, as `const NAME = '...'`. */
function constant(name) {
  const match = new RegExp(`const ${name} =\\s*'([^']+)'`).exec(bloom);
  if (!match) throw new Error(`No ${name} in Bloom.tsx`);
  return match[1];
}

/** A colour from palette.ts, as `name: '#rrggbb'`. */
function colour(name) {
  const match = new RegExp(`\\b${name}: '(#[0-9A-Fa-f]{6})'`).exec(
    paletteSource,
  );
  if (!match) throw new Error(`No ${name} in palette.ts`);
  return match[1];
}

const PETAL = constant('PETAL');
const VEIN = constant('VEIN');
const LENGTHS = JSON.parse(
  /const LENGTHS = (\[[^\]]+\])/.exec(bloom)?.[1] ?? 'null',
);
if (!Array.isArray(LENGTHS) || LENGTHS.length !== 12) {
  throw new Error('No LENGTHS in Bloom.tsx');
}

const palette = {
  roast: colour('roast'),
  bloomHi: colour('bloomHi'),
  bloomDeep: colour('bloomDeep'),
  bloomNight: colour('bloomNight'),
  stamen: colour('stamen'),
};

/** `angle(i)` in Bloom.tsx. */
const angle = i => 30 * i + (i % 2 ? 2 : 0) - (i % 3 === 0 ? 1.5 : 0);

/** `n` dots of radius `r` on a circle of `at` around the centre, as Bloom's. */
function dots(n, at, r) {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: at * Math.sin(t), y: -at * Math.cos(t), r };
  });
}

/**
 * The open flower in Bloom's own 100 unit box, centred on 0,0: twelve
 * petals shaded base to tip, their veins, and the centre with its anthers
 * and pollen. `mono` draws it in one colour, for a themed icon.
 */
function flower({ mono = null } = {}) {
  const fill = mono ?? 'url(#petal)';
  const petals = LENGTHS.map(
    (length, i) =>
      `<g transform="rotate(${angle(i)}) scale(1 ${length})">` +
      `<path d="${PETAL}" fill="${fill}"/>` +
      (mono
        ? ''
        : `<path d="${VEIN}" stroke="${palette.bloomNight}" stroke-opacity="0.35" stroke-width="0.8"/>`) +
      '</g>',
  ).join('');
  // In one colour the centre is a disc just inside the petals' bases, so
  // the gap between them keeps the flower's eye.
  const centre = mono
    ? `<circle r="6" fill="${mono}"/>`
    : `<circle r="7.5" fill="${palette.stamen}"/>` +
      dots(8, 9.5, 1.1)
        .map(
          d =>
            `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${palette.stamen}"/>`,
        )
        .join('') +
      dots(5, 5, 0.9)
        .map(
          d =>
            `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${palette.bloomHi}"/>`,
        )
        .join('');
  return petals + centre;
}

const PETAL_GRADIENT =
  '<linearGradient id="petal" gradientUnits="userSpaceOnUse" x1="0" y1="-8" x2="0" y2="-46">' +
  `<stop offset="0" stop-color="${palette.bloomNight}"/>` +
  `<stop offset="0.45" stop-color="${palette.bloomDeep}"/>` +
  `<stop offset="1" stop-color="${palette.bloomHi}"/>` +
  '</linearGradient>';

/** The top pane's glow (palette `gradients.G1`), centred, over roast. */
const GLOW =
  '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.62">' +
  `<stop offset="0" stop-color="${palette.bloomNight}" stop-opacity="0.34"/>` +
  '<stop offset="0.6" stop-color="#2A2A45" stop-opacity="0.12"/>' +
  '<stop offset="1" stop-color="#2A2A45" stop-opacity="0"/>' +
  '</radialGradient>';

/** The flower reaches 46 units from its centre: 92 across. */
const REACH = 92;

/**
 * A square drawing `size` units across: an optional ground, and the flower
 * `across` units wide at its centre.
 */
function drawing({
  size = 1024,
  across = 0,
  ground = true,
  mono = null,
  clip = null,
}) {
  const scale = across / REACH;
  const defs = `<defs>${PETAL_GRADIENT}${GLOW}${
    clip ? `<clipPath id="shape">${clip}</clipPath>` : ''
  }</defs>`;
  const clipAttr = clip ? ' clip-path="url(#shape)"' : '';
  const grounds = ground
    ? `<rect width="${size}" height="${size}" fill="${palette.roast}"/>` +
      `<rect width="${size}" height="${size}" fill="url(#glow)"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    defs +
    `<g${clipAttr}>${grounds}` +
    (across > 0
      ? `<g transform="translate(${size / 2} ${
          size / 2
        }) scale(${scale})">${flower({ mono })}</g>`
      : '') +
    '</g></svg>'
  );
}

const work = mkdtempSync(path.join(tmpdir(), 'chicory-icon-'));

/** Renders `svg` to a `px` square PNG at `out`, opaque when `flatten`. */
function render(svg, px, out, flatten = false) {
  const source = path.join(work, 'icon.svg');
  writeFileSync(source, svg);
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('rsvg-convert', [
    '-w',
    `${px}`,
    '-h',
    `${px}`,
    source,
    '-o',
    out,
  ]);
  if (flatten) {
    // App Store icons may not carry an alpha channel.
    execFileSync('magick', [
      out,
      '-background',
      palette.roast,
      '-alpha',
      'remove',
      '-alpha',
      'off',
      out,
    ]);
  }
}

// iOS: full bleed, the system rounds the corners. The flower keeps about a
// fifth of the icon clear on every side.
const IOS_SET = 'ios/chicory/Images.xcassets/AppIcon.appiconset';
const contents = JSON.parse(read(`${IOS_SET}/Contents.json`));
const iosSvg = drawing({ across: 640 });
for (const image of contents.images) {
  const points = Number(image.size.split('x')[0]);
  const scale = Number(image.scale.replace('x', ''));
  const px = Math.round(points * scale);
  const name = `icon-${px}.png`;
  image.filename = name;
  render(iosSvg, px, path.join(ROOT, IOS_SET, name), true);
}
writeFileSync(
  path.join(ROOT, IOS_SET, 'Contents.json'),
  `${JSON.stringify(contents, null, 2)}\n`,
);

// Android. The adaptive icon's layers are 108dp, of which launchers show
// the middle 72dp and promise only a 66dp circle: the flower stays within
// 60dp of it.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const RES = 'android/app/src/main/res';
const layer = 108;
const foreground = drawing({ size: layer, across: 60, ground: false });
const background = drawing({ size: layer });
const monochrome = drawing({
  size: layer,
  across: 60,
  ground: false,
  mono: '#FFFFFF',
});
// The icons older launchers take whole: a rounded square, and a circle.
const legacy = drawing({
  size: 48,
  across: 34,
  clip: '<rect x="1" y="1" width="46" height="46" rx="9"/>',
});
const legacyRound = drawing({
  size: 48,
  across: 34,
  clip: '<circle cx="24" cy="24" r="23"/>',
});
for (const [density, factor] of Object.entries(DENSITIES)) {
  const dir = path.join(ROOT, RES, `mipmap-${density}`);
  render(
    foreground,
    layer * factor,
    path.join(dir, 'ic_launcher_foreground.png'),
  );
  render(
    background,
    layer * factor,
    path.join(dir, 'ic_launcher_background.png'),
  );
  render(
    monochrome,
    layer * factor,
    path.join(dir, 'ic_launcher_monochrome.png'),
  );
  render(legacy, 48 * factor, path.join(dir, 'ic_launcher.png'));
  render(legacyRound, 48 * factor, path.join(dir, 'ic_launcher_round.png'));
}
const adaptive =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<!-- Written by scripts/app-icon.mjs: the open bloom on roast. -->\n' +
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@mipmap/ic_launcher_background" />\n' +
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n' +
  '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n' +
  '</adaptive-icon>\n';
const anydpi = path.join(ROOT, RES, 'mipmap-anydpi-v26');
mkdirSync(anydpi, { recursive: true });
writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);

console.log('Wrote the iOS icon set and the Android launcher icons.');
