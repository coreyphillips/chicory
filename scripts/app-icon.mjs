/**
 * Draws the app icon, the open bloom on desktop's indigo tile, and writes
 * every size iOS and Android ask for:
 *
 * - iOS: ios/chicory/Images.xcassets/AppIcon.appiconset, one opaque PNG per
 *   entry in its Contents.json, which this names.
 * - Android: an adaptive icon (an indigo background, the
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

/**
 * Match the visible tile in chicory-desktop/build/icon.png. The flower
 * spans about 79% of the tile. Its longest petal reaches 46 units above
 * the eye, so placing the eye slightly low centres the asymmetric bloom.
 * Android adaptive layers extend past the visible tile on all sides.
 */
function drawing({
  size = 1024,
  tile = size,
  showFlower = true,
  ground = true,
  mono = null,
  clip = null,
} = {}) {
  const inset = (size - tile) / 2;
  const eyeY = size / 2 + 0.009 * tile;
  const flowerScale = (0.816 * tile) / 92;
  const gradient =
    `<linearGradient id="indigo" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${inset}" y2="${
      inset + tile
    }">` +
    '<stop offset="0" stop-color="#2B3972"/><stop offset="1" stop-color="#141B3D"/>' +
    '</linearGradient>';
  const glow =
    `<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${
      size / 2
    }" cy="${size / 2}" r="${tile / 2}">` +
    `<stop offset="0" stop-color="${palette.bloomDeep}" stop-opacity="0.1"/>` +
    `<stop offset="1" stop-color="${palette.bloomDeep}" stop-opacity="0"/>` +
    '</radialGradient>';
  const defs = `<defs>${PETAL_GRADIENT}${gradient}${glow}${
    clip ? `<clipPath id="shape">${clip}</clipPath>` : ''
  }</defs>`;
  const clipAttr = clip ? ' clip-path="url(#shape)"' : '';
  const grounds = ground
    ? `<rect width="${size}" height="${size}" fill="url(#indigo)"/>` +
      `<rect width="${size}" height="${size}" fill="url(#glow)"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    defs +
    `<g${clipAttr}>${grounds}` +
    (showFlower
      ? `<g transform="translate(${
          size / 2
        } ${eyeY}) scale(${flowerScale})">${flower({ mono })}</g>`
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
      '-alpha',
      'off',
      // No timestamps, so drawing the same icon again changes no file.
      '-define',
      'png:exclude-chunks=date,time',
      out,
    ]);
  }
}

// iOS draws the full tile and applies its own corner mask.
const IOS_SET = 'ios/chicory/Images.xcassets/AppIcon.appiconset';
const contents = JSON.parse(read(`${IOS_SET}/Contents.json`));
const iosSvg = drawing();
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
// the middle 72dp. The bloom fits inside the guaranteed 66dp safe circle.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const RES = 'android/app/src/main/res';
const adaptiveTile = { size: 108, tile: 72 };
const foreground = drawing({ ...adaptiveTile, ground: false });
const background = drawing({ ...adaptiveTile, showFlower: false });
const monochrome = drawing({
  ...adaptiveTile,
  ground: false,
  mono: '#FFFFFF',
});
// The icons older launchers take whole: a rounded square, and a circle.
const legacy = drawing({
  size: 48,
  tile: 46,
  clip: '<rect x="1" y="1" width="46" height="46" rx="9"/>',
});
const legacyRound = drawing({
  size: 48,
  tile: 46,
  clip: '<circle cx="24" cy="24" r="23"/>',
});
for (const [density, factor] of Object.entries(DENSITIES)) {
  const dir = path.join(ROOT, RES, `mipmap-${density}`);
  render(
    foreground,
    adaptiveTile.size * factor,
    path.join(dir, 'ic_launcher_foreground.png'),
  );
  render(
    background,
    adaptiveTile.size * factor,
    path.join(dir, 'ic_launcher_background.png'),
  );
  render(
    monochrome,
    adaptiveTile.size * factor,
    path.join(dir, 'ic_launcher_monochrome.png'),
  );
  render(legacy, 48 * factor, path.join(dir, 'ic_launcher.png'));
  render(legacyRound, 48 * factor, path.join(dir, 'ic_launcher_round.png'));
}
const adaptive =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<!-- Written by scripts/app-icon.mjs: the open bloom on indigo. -->\n' +
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
