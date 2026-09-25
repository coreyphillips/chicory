import type { Scene, StageState } from './scene';

/**
 * Where the canvas's panes rest for each scene (REDESIGN.md 2.3), as pure
 * data, so the layout is a table test and the canvas only animates between
 * answers it is given.
 *
 * The bottom sheet moves by one number, its top edge (the seam). The top pane
 * never moves; what it shows grows and fades with `hero` and `bar`.
 */

/** A place the seam rests, named for what it leaves showing. */
export type Stop = 'full' | 'compact' | 'home' | 'gone';

/** Every stop in points from the top of the canvas. */
export type Stops = Record<Stop, number>;

/** The status row across the top of the canvas, which no pane covers. */
export const STATUS_ROW = 56;

/** The hero's scale as the mini strip, the smallest it gets. */
export const HERO_MINI = 0.34;

/**
 * The band under the status row that Send and Receive leave clear, where the
 * balance rests as the mini strip while either is open (REDESIGN.md 7, T1).
 * Activity and a payment's detail leave no band, since the sheet's compact
 * stop sits just under the row, so there the strip rests in the row itself.
 */
export const MINI_STRIP = 44;

/** What Settings does to the canvas it slides over. */
export const COVERED = { scale: 0.94, opacity: 0.5 };

/** What the scan overlay does to the canvas it opens over. */
export const SCANNING = { scale: 0.96, opacity: 0.5 };

/**
 * The opacity of what the Reduce Motion crossfade covers (the panes'
 * `veil`), from its clock: whole at rest (1), gone halfway, whole again at
 * the end, so the jump at the middle is never seen.
 */
export function veilOpacity(veil: number): number {
  'worklet';
  return Math.min(1, Math.abs(1 - 2 * veil));
}

/**
 * About how long the pane spring takes to look settled, which is well before
 * its rest threshold reports rest. The transition lock lasts this long, so
 * taps wait this long at most, and only while a pane is actually moving.
 */
export const PANE_SETTLE_MS = 340;

/**
 * How the canvas came to be drawn: the lock opening over it (R-1), a wallet
 * that finished loading (R-3), or one that was offline and answered again
 * (R-5). Each is a build: the canvas does not appear at rest, it builds in.
 */
export type Arrival = 'unlock' | 'load' | 'reconnect';

/**
 * When each part of the canvas builds in, in ms from the canvas mounting
 * (REDESIGN.md 7, R-1): the hero counts up from 0, then 50ms later the
 * sheet rises, 50ms after that the actions pop in 50ms apart, and then the
 * rows stagger in 30ms apart. After an unlock the bud unfolds first, so the
 * build waits for it; after a load or a reconnect it starts as the phase
 * leaves.
 */
export const BUILD = {
  lead: { unlock: 600, load: 80, reconnect: 80 } as Record<Arrival, number>,
  sheet: 50,
  actions: 100,
  actionStep: 50,
  rows: 150,
  rowStep: 30,
  /** How long after the rows begin the build counts as over. */
  settle: 400,
};

export interface BuildBeats {
  hero: number;
  sheet: number;
  actions: number;
  actionStep: number;
  rows: number;
  rowStep: number;
  /** When the whole build has landed. */
  done: number;
}

/** The beats of the build for an `arrival`. */
export function buildBeats(arrival: Arrival): BuildBeats {
  const hero = BUILD.lead[arrival];
  return {
    hero,
    sheet: hero + BUILD.sheet,
    actions: hero + BUILD.actions,
    actionStep: BUILD.actionStep,
    rows: hero + BUILD.rows,
    rowStep: BUILD.rowStep,
    done: hero + BUILD.rows + BUILD.settle,
  };
}

/**
 * The stops for a canvas `height` points tall whose top edge sits `top`
 * points below the system status bar's.
 *
 * Home leaves the balance at least 380 points and never less than half the
 * canvas. Compact leaves the status row and a little air. Gone is past the
 * bottom edge, far enough that the sheet's rounded corners are gone too.
 */
export function stops(height: number, insets: { top: number }): Stops {
  return {
    full: insets.top,
    compact: insets.top + 72,
    home: Math.max(insets.top + 380, 0.5 * height),
    gone: height + 24,
  };
}

/**
 * One pose of the panes: where the seam rests, how far the hero is expanded
 * (1 is the full balance, 0 the mini strip), and the action row's opacity.
 */
export interface PaneLayout {
  seam: Stop;
  hero: number;
  bar: number;
}

/** The scenes the canvas itself draws, as opposed to sliding over it. */
export type CanvasSceneName = Exclude<Scene['name'], 'settings'>;

/**
 * Each scene's pose. Settings has none: it slides over the canvas and leaves
 * the canvas exactly as the scene under it had it.
 */
export const SCENE_LAYOUT: Record<CanvasSceneName, PaneLayout> & {
  settings: null;
} = {
  home: { seam: 'home', hero: 1, bar: 1 },
  activity: { seam: 'compact', hero: 0, bar: 0 },
  detail: { seam: 'compact', hero: 0, bar: 0 },
  send: { seam: 'gone', hero: 0, bar: 0 },
  receive: { seam: 'gone', hero: 0, bar: 0 },
  settings: null,
};

/**
 * The scene the canvas shows: the stage's own scene, or under Settings the
 * one it covers. The stack under Settings always rests on home, so home is
 * also the answer when there is nothing else to go on.
 */
export function canvasScene(
  state: Pick<StageState, 'scene' | 'stack'>,
): CanvasSceneName {
  for (const scene of [state.scene, ...[...state.stack].reverse()]) {
    if (scene.name !== 'settings') return scene.name;
  }
  return 'home';
}

/**
 * The panes' pose for a stage, plus whether Settings covers the canvas,
 * whether the scan overlay is open over it, and whether a payment's detail
 * card is open on the sheet. The card leaves the panes where the list had
 * them, but its growth out of the row is a move all the same, so it holds
 * the transition lock like any other.
 */
export interface CanvasLayout extends PaneLayout {
  covered: boolean;
  scanning: boolean;
  card: boolean;
}

export function canvasLayout(
  state: Pick<StageState, 'scene' | 'stack'> &
    Partial<Pick<StageState, 'overlay'>>,
): CanvasLayout {
  const shown = canvasScene(state);
  return {
    ...SCENE_LAYOUT[shown],
    covered: state.scene.name === 'settings',
    scanning: state.overlay?.name === 'scan',
    card: shown === 'detail',
  };
}

export const sameLayout = (a: CanvasLayout, b: CanvasLayout) =>
  a.seam === b.seam &&
  a.hero === b.hero &&
  a.bar === b.bar &&
  a.covered === b.covered &&
  a.scanning === b.scanning &&
  a.card === b.card;
