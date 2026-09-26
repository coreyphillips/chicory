import {
  appSources,
  scanWorklets,
  uncapturedDefaults,
} from '../test-support/worklets';
import type { Sources, WorkletScan } from '../test-support/worklets';

/**
 * Worklets run on the UI thread, which Jest never does: it runs each one on
 * the JS thread, where everything is in scope, so a worklet that crashes on
 * a device passes every rendering test. The vessel's seedBob did, reading
 * a constant through a parameter default the UI thread never received.
 * test-support/worklets.ts reads the source the way the worklets plugin
 * does; this suite holds the app to it and proves, on snippets, that it
 * catches each shape it looks for.
 */
let scanned: WorkletScan | undefined;
const app = () => (scanned ??= scanWorklets(appSources()));
const PARAMETER = 'a parameter reads';

/** A set of snippets, by file name, for the negative controls. */
function snippets(files: Record<string, string>, checked: string[]): Sources {
  return { files: checked, read: file => files[file], name: file => file };
}

describe('parameters', () => {
  test('no worklet reads an outer value through a parameter', () => {
    expect(app().problems.filter(p => p.includes(PARAMETER))).toEqual([]);
  });

  test('the scan catches the shape that crashed the vessel', () => {
    const source = `const SEEDS = 5;
export function seedBob(t: number, count = SEEDS) { 'worklet'; return t / count; }
export function fine(t: number, count = 5) { 'worklet'; return t / count; }
export function plain(t: number, count = SEEDS) { return t / count; }`;
    expect(uncapturedDefaults(source)).toEqual(['2: count = SEEDS']);
  });

  test('it reads destructuring, computed keys and callbacks without a directive', () => {
    const source = `import { KEY, OBJ } from './k';
const LIMIT = 3;
export const arrow = (t: number, { k = OBJ.a } = {}) => { 'worklet'; return t + k; };
export const keyed = ({ [KEY]: v }: Record<string, number>) => { 'worklet'; return v; };
export function Row({ pose }: { pose: number }) {
  useAnimatedReaction(() => pose, (now, before = LIMIT) => now - before);
  return useAnimatedStyle(() => ({ opacity: pose }));
}
export const ok = (a: number, b = a, c = Math.PI, d = {}, { e = 1 } = {}) => { 'worklet'; return a + b + c + e; };
export function inner(t: number) { 'worklet'; const f = (x = LIMIT) => x; return f(t); }`;
    expect(uncapturedDefaults(source)).toEqual([
      '3: k = OBJ.a',
      '4: [KEY]: v',
      '6: before = LIMIT',
    ]);
  });
});

describe('calls and reads', () => {
  test('no worklet calls or reads what the UI thread does not have', () => {
    expect(app().problems.filter(p => !p.includes(PARAMETER))).toEqual([]);
  });

  test('the scan finds every kind of worklet the app has', () => {
    const { kinds } = app();
    expect([...kinds.keys()]).toEqual(
      expect.arrayContaining([
        'directive',
        'gesture',
        'useAnimatedProps',
        'useAnimatedReaction',
        'useAnimatedStyle',
        'useDerivedValue',
        'withTiming',
      ]),
    );
    const total = [...kinds.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(100);
  });

  test('the scan follows imports and flags what is not a worklet', () => {
    const files = {
      'src/math.ts': `
export function eased(t: number) { 'worklet'; return t * t; }
export function plain(t: number) { return t * 2; }
export const arrowed = (t: number) => { 'worklet'; return t; };
export const unmarked = (t: number) => t;
export const tools = { fine: (t: number) => { 'worklet'; return t; }, rough: (t: number) => t };
export class Clock {}
export let ticks = 0;`,
      'src/index.ts': `export * from './math';
export { plain as renamed } from './math';`,
      'src/Row.tsx': `
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Easing, interpolate, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as math from './math';
import { Clock, eased, renamed, ticks, tools, unmarked } from './index';
const SHAKE = [0, -8, 8];
function helper(t: number) { return t; }
function marked(t: number) { 'worklet'; return t; }
export function Row({ onDone }: { onDone: () => void }) {
  const [, setShown] = useState(false);
  const done = useCallback(() => setShown(true), []);
  const box = useRef(null);
  const local = (t: number) => t;
  return useAnimatedStyle(() => {
    const own = (t: number) => t * 2;
    const alias = helper;
    const t = own(eased(marked(1))) + interpolate(1, [0, 1], [0, 1]);
    Easing.bezier(0, 0, 1, 1);
    SHAKE.slice(1).map(x => Math.max(x, t));
    scheduleOnRN(done);
    scheduleOnRN(setShown, true);
    onDone();
    helper(t);
    alias(t);
    renamed(t);
    unmarked(t);
    math.plain(t);
    math.arrowed(t);
    tools.fine(t);
    tools.rough(t);
    local(t);
    setShown(true);
    done();
    new Clock();
    fetch('https://example.com');
    Platform.select({});
    box.current;
    ticks;
    return { opacity: withTiming(t) };
  });
}`,
    };
    // The rest is fine: the worklet's own function, worklets from the file
    // and its imports, Reanimated's own, Math, an array's methods, what it
    // hands to scheduleOnRN, and a prop, which the scan cannot see into.
    expect(scanWorklets(snippets(files, ['src/Row.tsx'])).problems).toEqual(
      [
        'src/Row.tsx:25: calls helper (src/Row.tsx), which is not a worklet',
        'src/Row.tsx:26: calls alias (src/Row.tsx), which is not a worklet',
        'src/Row.tsx:27: calls renamed (src/math.ts), which is not a worklet',
        'src/Row.tsx:28: calls unmarked (src/math.ts), which is not a worklet',
        'src/Row.tsx:29: calls math.plain (src/math.ts), which is not a worklet',
        'src/Row.tsx:32: calls tools.rough (src/math.ts), which is not a worklet',
        'src/Row.tsx:33: calls local, which is not a worklet',
        'src/Row.tsx:34: calls setShown, a state setter, which runs only on the JS thread: schedule it with scheduleOnRN',
        'src/Row.tsx:35: calls done, a JS callback, which runs only on the JS thread: schedule it with scheduleOnRN',
        'src/Row.tsx:36: builds Clock (src/math.ts), a class the UI thread does not have',
        'src/Row.tsx:37: calls fetch, which the UI thread does not have',
        'src/Row.tsx:38: calls Platform.select from react-native, which is not a worklet',
        'src/Row.tsx:39: reads the ref box, which the UI thread gets only a frozen copy of',
        'src/Row.tsx:40: reads the module let ticks, which the worklet copies once, as it is built',
      ].sort(),
    );
  });

  test('the scan sees what the plugin cannot and what runs on the JS thread', () => {
    const files = {
      'src/haptics.ts': 'export const haptics = { tick: () => {} };',
      'src/Pan.tsx': `
import { useMemo } from 'react';
import { Gesture, usePanGesture, useLongPressGesture } from 'react-native-gesture-handler';
import { useAnimatedStyle } from 'react-native-reanimated';
import { haptics } from './haptics';
let pending = 0;
export const early = () => { 'worklet'; return LATE + pending; };
const LATE = 2;
export function sheetIn() {
  return () => { 'worklet'; return { initialValues: { opacity: 0 }, animations: {} }; };
}
export function sheetOut() {
  return () => ({ initialValues: { opacity: 1 }, animations: {} });
}
export function Pan({ enabled }: { enabled: boolean }) {
  const memo = useMemo(() => ({
    onBegin: () => { 'worklet'; },
    onUpdate: () => haptics.tick(),
  }), []);
  usePanGesture(memo);
  usePanGesture({ onUpdate: () => { haptics.tick(); } });
  Gesture.Pan().minDistance(4).onUpdate(() => haptics.tick());
  useLongPressGesture({ runOnJS: true, onActivate: () => haptics.tick() });
  return useAnimatedStyle(() => ({ opacity: enabled ? 1 : 0 }));
}`,
    };
    // A worklet in its own words, a callback the plugin makes a worklet of,
    // and one Gesture Handler keeps on the JS thread all pass.
    expect(scanWorklets(snippets(files, ['src/Pan.tsx'])).problems).toEqual(
      [
        'src/Pan.tsx:7: reads LATE before the module declares it, as the worklet is built',
        'src/Pan.tsx:7: reads the module let pending, which the worklet copies once, as it is built',
        'src/Pan.tsx:13: a layout animation that is not a worklet',
        "src/Pan.tsx:18: the gesture callback onUpdate is not a worklet: the plugin cannot see into its config, so it needs its own 'worklet'",
        'src/Pan.tsx:21: calls haptics.tick (src/haptics.ts), which is not a worklet',
        'src/Pan.tsx:22: calls haptics.tick (src/haptics.ts), which is not a worklet',
      ].sort(),
    );
  });
});
