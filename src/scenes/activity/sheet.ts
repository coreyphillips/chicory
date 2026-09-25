/**
 * The sheet under the finger (REDESIGN.md 7, T5), as pure worklets, so the
 * drag is table-tested and the gesture only reads their answers.
 *
 * The sheet runs between two stops: home, where it shows a preview under the
 * balance, and compact, where it is the whole list. Progress is how far it has
 * come from home toward compact, 0 at home and 1 at compact.
 */

/** Past either stop the sheet follows the finger at this fraction. */
export const RUBBER = 0.35;
/** A flick faster than this, in points per second, decides by direction. */
export const FLING = 800;
/** How far up from home a slow drag must come to open the list. */
export const OPEN_AT = 0.4;
/** How far down from compact a slow drag must come to close it. */
export const CLOSE_AT = 0.25;
/** The grip's height, at the top of the sheet. */
export const GRIP_HEIGHT = 28;
/** The filter bar's height, which the list gives back at home. */
export const BAR_HEIGHT = 52;
/** How far the rows drop as a payment's detail grows over them (T4). */
export const DETAIL_DROP = 8;

export interface SheetStops {
  /** The seam with the whole list showing. */
  compact: number;
  /** The seam with the preview under the balance. */
  home: number;
}

const clamp01 = (value: number) => {
  'worklet';
  return Math.min(1, Math.max(0, value));
};

/**
 * Where the seam goes when a drag that began with it at `start` has moved
 * `dy` points: with the finger between the stops, and a third as far past
 * either one.
 */
export function dragSeam(start: number, dy: number, at: SheetStops): number {
  'worklet';
  const seam = start + dy;
  if (seam < at.compact) return at.compact - (at.compact - seam) * RUBBER;
  if (seam > at.home) return at.home + (seam - at.home) * RUBBER;
  return seam;
}

/** How far the sheet has come from home toward compact, clamped to 0 to 1. */
export function sheetProgress(seam: number, at: SheetStops): number {
  'worklet';
  const span = at.home - at.compact;
  return span > 0 ? clamp01((at.home - seam) / span) : 1;
}

/** Whether a drag at `progress` has gone far enough to change the stop. */
export function pastThreshold(opened: boolean, progress: number): boolean {
  'worklet';
  return opened ? 1 - progress >= CLOSE_AT : progress >= OPEN_AT;
}

/**
 * Whether a drag let go at `progress`, moving at `velocity` points per second
 * (down is positive), leaves the whole list showing. A flick goes the way it
 * was flicked; otherwise the drag must be past its threshold, from whichever
 * stop it began at.
 */
export function releaseOpens(
  opened: boolean,
  progress: number,
  velocity: number,
): boolean {
  'worklet';
  if (Math.abs(velocity) > FLING) return velocity < 0;
  return pastThreshold(opened, progress) ? !opened : opened;
}

/** The action row fades over the first 40% of the way up. */
export function barFor(progress: number): number {
  'worklet';
  return 1 - clamp01(progress / 0.4);
}

/** The filter bar fades in over the last 40%, from 60% of the way up. */
export function filterFor(progress: number): number {
  'worklet';
  return clamp01((progress - 0.6) / 0.4);
}

/**
 * How far the list sits up over the filter bar: all the way at home, where the
 * bar is gone, and not at all once it has faded in, so the rows make room for
 * it as it arrives instead of leaving a gap at home.
 */
export function listShift(progress: number): number {
  'worklet';
  return -BAR_HEIGHT * (1 - filterFor(progress));
}
