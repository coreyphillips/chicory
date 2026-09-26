import type { Activity } from '@beignet/wallet-core';
import {
  SCENE_LAYOUT,
  canvasLayout,
  canvasScene,
  MINI_STRIP,
  SLOT_PADDING,
  WELL,
  WELL_DROP,
  sameLayout,
  stops,
  veilOpacity,
} from '../src/stage/layout';
import { fs, path, ROOT } from '../test-support/node';
import type { Scene } from '../src/stage/scene';

/**
 * Where the panes rest for each scene (REDESIGN.md 2.3). The canvas only
 * animates between these answers, so the layout itself is a table.
 */
const ITEM: Activity = {
  id: 'payment:1',
  kind: 'sent',
  title: 'Sent',
  description: '',
  amountSats: 1200,
  feeSats: 3,
  status: 'completed',
  timestamp: 1_700_000_000_000,
  reference: '',
};

const HOME: Scene = { name: 'home', key: 0 };
const SCENES: Scene[] = [
  HOME,
  { name: 'activity', key: 1 },
  { name: 'detail', item: ITEM, from: null, key: 2 },
  { name: 'send', prefill: '', key: 3 },
  { name: 'receive', key: 4 },
];
const SETTINGS: Scene = { name: 'settings', key: 5 };

describe('stops', () => {
  test('measure from the top inset, as REDESIGN.md 2.3 gives them', () => {
    expect(stops(844, { top: 47 })).toEqual({
      full: 47,
      compact: 47 + 72,
      home: 47 + 380,
      gone: 844 + 24,
    });
  });

  test('home never leaves less than half a tall canvas to the balance', () => {
    expect(stops(1000, { top: 0 }).home).toBe(500);
    expect(stops(600, { top: 0 }).home).toBe(380);
  });

  test('rest in order down the canvas, with gone past its bottom edge', () => {
    for (const height of [568, 740, 844, 932, 1366]) {
      const at = stops(height, { top: 0 });
      expect(at.full).toBeLessThan(at.compact);
      expect(at.compact).toBeLessThan(at.home);
      expect(at.home).toBeLessThan(height);
      expect(at.gone).toBeGreaterThan(height);
    }
  });
});

describe('each scene takes its pose', () => {
  test.each([
    ['home', { seam: 'home', hero: 1, bar: 1 }],
    ['activity', { seam: 'compact', hero: 0, bar: 0 }],
    ['detail', { seam: 'compact', hero: 0, bar: 0 }],
    ['send', { seam: 'gone', hero: 0, bar: 0 }],
    ['receive', { seam: 'gone', hero: 0, bar: 0 }],
  ] as const)('%s', (name, pose) => {
    expect(SCENE_LAYOUT[name]).toEqual(pose);
    const scene = SCENES.find(each => each.name === name)!;
    expect(canvasLayout({ scene, stack: [] })).toEqual({
      ...pose,
      covered: false,
      scanning: false,
      card: name === 'detail',
    });
  });

  test('settings has no pose of its own', () => {
    expect(SCENE_LAYOUT.settings).toBeNull();
  });
});

describe('under Settings', () => {
  test('the canvas stays as the scene it covers had it, and is covered', () => {
    const stack = [HOME];
    expect(canvasScene({ scene: SETTINGS, stack })).toBe('home');
    expect(canvasLayout({ scene: SETTINGS, stack })).toEqual({
      ...SCENE_LAYOUT.home,
      covered: true,
      scanning: false,
      card: false,
    });
  });

  test('the nearest scene the canvas draws wins, and home when there is none', () => {
    const activity = SCENES[1];
    expect(canvasScene({ scene: SETTINGS, stack: [HOME, activity] })).toBe(
      'activity',
    );
    expect(canvasScene({ scene: SETTINGS, stack: [] })).toBe('home');
  });

  test('every other scene is the one the canvas shows', () => {
    for (const scene of SCENES) {
      expect(canvasScene({ scene, stack: [HOME] })).toBe(scene.name);
    }
  });
});

test('the scan overlay leaves the pose as it was, and marks it scanning', () => {
  for (const scene of SCENES) {
    const under = canvasLayout({ scene, stack: [HOME] });
    const scanning = canvasLayout({
      scene,
      stack: [HOME],
      overlay: { name: 'scan', target: 'home', origin: null, key: 1 },
    });
    expect(scanning).toEqual({ ...under, scanning: true });
  }
  const creating = canvasLayout({
    scene: HOME,
    stack: [],
    overlay: { name: 'create', restoring: false, key: 1 },
  });
  expect(creating.scanning).toBe(false);
});

test('two poses are the same when every value is', () => {
  const home = canvasLayout({ scene: HOME, stack: [] });
  expect(sameLayout(home, { ...home })).toBe(true);
  expect(sameLayout(home, { ...home, covered: true })).toBe(false);
  expect(sameLayout(home, { ...home, scanning: true })).toBe(false);
  expect(sameLayout(home, { ...home, seam: 'compact' })).toBe(false);
  expect(sameLayout(home, { ...home, hero: 0 })).toBe(false);
  expect(sameLayout(home, { ...home, bar: 0 })).toBe(false);
  expect(sameLayout(home, { ...home, card: true })).toBe(false);
});

test('a payment’s detail keeps the list’s pose, but is a move of its own', () => {
  const activity = SCENES.find(scene => scene.name === 'activity')!;
  const detail = SCENES.find(scene => scene.name === 'detail')!;
  const list = canvasLayout({ scene: activity, stack: [HOME] });
  const card = canvasLayout({ scene: detail, stack: [HOME, activity] });
  expect({ ...card, card: false }).toEqual(list);
  expect(sameLayout(list, card)).toBe(false);
});

test('the Reduce Motion crossfade hides the jump at its middle', () => {
  expect(veilOpacity(1)).toBe(1);
  expect(veilOpacity(0)).toBe(1);
  expect(veilOpacity(0.25)).toBeCloseTo(0.5);
  expect(veilOpacity(0.5)).toBe(0);
  expect(veilOpacity(0.75)).toBeCloseTo(0.5);
});

test('a code read from home lands in the middle of Send’s well', () => {
  // The canvas keeps the measure the scan overlay aims for, so the overlay
  // never reaches into a scene's module for it, and Send's well takes its
  // height from the same place rather than keeping a copy that could drift.
  const entry = fs.readFileSync(
    path.join(ROOT, 'src/scenes/send/RequestEntry.tsx'),
    'utf8',
  );
  expect(entry).toMatch(
    /import \{[^}]*\bWELL\b[^}]*\} from '\.\.\/\.\.\/stage\/layout';/,
  );
  expect(entry).not.toMatch(/\bconst WELL\b/);
  expect(WELL_DROP).toBe(MINI_STRIP + SLOT_PADDING.top + WELL / 2);
});
