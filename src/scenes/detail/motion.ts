import { withSpring, withTiming } from 'react-native-reanimated';
import type {
  EntryAnimationsValues,
  EntryExitAnimationFunction,
  ExitAnimationsValues,
  SharedValue,
} from 'react-native-reanimated';
import { riseIn, sceneIn, sceneOut } from '../../motion/presets';
import { curves, durations, springs } from '../../motion/tokens';
import { motionReduced } from '../../services/motion';
import type { Rect } from '../../stage/scene';
import { radius } from '../../theme';

/**
 * A payment's detail growing out of its row and folding back into it
 * (REDESIGN.md 7, T4), as layout animations and the frame math under them.
 */

/** The card grows out of its row over this long. */
export const EXPAND_MS = 380;
/** A row's corners, which the card starts from and folds back to. */
export const ROW_RADIUS = radius.md;
/** The card's corners once it has grown. */
export const CARD_RADIUS = radius.pane;

/** A frame in the coordinates of a view's parent, as layout animations take it. */
export interface Frame {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The frame, in the parent's coordinates, that lies over `rect` in the
 * window's, for a view whose frame `origin` sits at `global` in the window.
 */
export function frameOver(
  rect: Rect,
  origin: { x: number; y: number },
  global: { x: number; y: number },
): Frame {
  'worklet';
  return {
    originX: origin.x + rect.x - global.x,
    originY: origin.y + rect.y - global.y,
    width: rect.width,
    height: rect.height,
  };
}

const MOVE = { duration: EXPAND_MS, easing: curves.standard };

/**
 * The card arriving: from the row's rect, corners and all, to where the
 * canvas places it. Without a rect, or under Reduce Motion, it fades in.
 */
export function expandFrom(rect: Rect | null): EntryExitAnimationFunction {
  if (!rect || motionReduced()) return sceneIn();
  return (values: EntryAnimationsValues) => {
    'worklet';
    const start = frameOver(
      rect,
      { x: values.targetOriginX, y: values.targetOriginY },
      { x: values.targetGlobalOriginX, y: values.targetGlobalOriginY },
    );
    return {
      initialValues: { ...start, borderRadius: ROW_RADIUS },
      animations: {
        originX: withTiming(values.targetOriginX, MOVE),
        originY: withTiming(values.targetOriginY, MOVE),
        width: withTiming(values.targetWidth, MOVE),
        height: withTiming(values.targetHeight, MOVE),
        borderRadius: withTiming(CARD_RADIUS, MOVE),
      },
    };
  };
}

const FOLD = { duration: durations.move, easing: curves.standard };
const FADE = { duration: durations.exit, easing: curves.exit };

/**
 * The card leaving: back into the row `back` holds when it leaves, fading as
 * it lands, or simply fading when there is no row to go to. `back` is read as
 * the card leaves, so it can follow a row that moved while the card was open.
 */
export function collapseTo(
  back: SharedValue<Rect | null>,
): EntryExitAnimationFunction {
  if (motionReduced()) return sceneOut();
  return (values: ExitAnimationsValues) => {
    'worklet';
    const rect = back.get();
    if (!rect) {
      return {
        initialValues: { opacity: 1 },
        animations: { opacity: withTiming(0, FADE) },
      };
    }
    const end = frameOver(
      rect,
      { x: values.currentOriginX, y: values.currentOriginY },
      { x: values.currentGlobalOriginX, y: values.currentGlobalOriginY },
    );
    return {
      initialValues: {
        originX: values.currentOriginX,
        originY: values.currentOriginY,
        width: values.currentWidth,
        height: values.currentHeight,
        borderRadius: CARD_RADIUS,
        opacity: 1,
      },
      animations: {
        originX: withTiming(end.originX, FOLD),
        originY: withTiming(end.originY, FOLD),
        width: withTiming(end.width, FOLD),
        height: withTiming(end.height, FOLD),
        borderRadius: withTiming(ROW_RADIUS, FOLD),
        opacity: withTiming(0, FOLD),
      },
    };
  };
}

/** The header ring's size as it leaves the row, against its size here. */
const RING_FROM = 40 / 96;

/**
 * The header ring arriving: from a row ring's size up to its own on the pane
 * spring, as the card grows around it.
 */
export function ringIn(): EntryExitAnimationFunction {
  if (motionReduced()) return sceneIn();
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: RING_FROM }] },
      animations: {
        opacity: withTiming(1, { duration: durations.enter }),
        transform: [{ scale: withSpring(1, springs.pane) }],
      },
    };
  };
}

/** When the first line starts in, and how far apart the rest follow. */
const LINES_AT = 120;
const LINE_GAP = 40;

/** The `index`th line under the header, rising in after the ones above. */
export function lineIn(index: number): EntryExitAnimationFunction {
  return riseIn(undefined, LINES_AT + index * LINE_GAP);
}
