import type { Activity } from '@beignet/wallet-core';
import {
  SCENE_LAYOUT,
  canvasLayout,
  canvasScene,
  sameLayout,
  stops,
} from '../src/stage/layout';
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

test('two poses are the same when every value is', () => {
  const home = canvasLayout({ scene: HOME, stack: [] });
  expect(sameLayout(home, { ...home })).toBe(true);
  expect(sameLayout(home, { ...home, covered: true })).toBe(false);
  expect(sameLayout(home, { ...home, seam: 'compact' })).toBe(false);
  expect(sameLayout(home, { ...home, hero: 0 })).toBe(false);
  expect(sameLayout(home, { ...home, bar: 0 })).toBe(false);
});
