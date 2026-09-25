import { ReduceMotion } from 'react-native-reanimated';
import type { WithTimingConfig } from 'react-native-reanimated';
import { curves } from '../../motion/tokens';
import { HERO_MINI, MINI_STRIP, STATUS_ROW } from '../../stage/layout';

/**
 * Home's motion as plain arithmetic, so each pose is a table test and the
 * animated styles only read the answers on the UI thread. Every function
 * here is a worklet.
 */

/**
 * A colour coming or going over `duration`. It moves nothing through space,
 * so it plays under Reduce Motion too; left to the system setting,
 * Reanimated would jump to the end and the tint would never be seen
 * (REDESIGN.md 8).
 */
export function tintTiming(
  duration: number,
  easing: WithTimingConfig['easing'] = curves.standard,
): WithTimingConfig {
  'worklet';
  return { duration, easing, reduceMotion: ReduceMotion.Never };
}

/**
 * A gated action's radish tint, in and out, which stands in for its shake
 * under Reduce Motion: 400ms in all.
 */
export const REFUSED = { in: 80, out: 320 };

/**
 * How far a pull on the home pane travels before letting go refreshes, in
 * points of finger travel.
 */
export const PULL_TRIGGER = 88;

/** How much further the pane gives once the pull is past the trigger. */
const PULL_GIVE = 28;

/**
 * How far the pane follows a pull of `dy` points: half the finger's travel
 * up to the trigger, then less and less, so it never runs away from the
 * top of the screen.
 */
export function pullOffset(dy: number): number {
  'worklet';
  if (dy <= 0) return 0;
  const toTrigger = Math.min(dy, PULL_TRIGGER) / 2;
  const past = Math.max(0, dy - PULL_TRIGGER);
  return toTrigger + PULL_GIVE * (1 - Math.exp(-past / PULL_GIVE));
}

/** How far the pull is toward a refresh, from 0 to 1. */
export function pullProgress(dy: number): number {
  'worklet';
  return Math.min(1, Math.max(0, dy / PULL_TRIGGER));
}

/** The hero's resting box inside the home pane, as it was last laid out. */
export interface HeroFrame {
  y: number;
  height: number;
}

/**
 * Where the mini strip's middle lands, in points below the top of the home
 * pane, which starts under the status row: in the band Send and Receive
 * leave clear there (MINI_STRIP), or, where the sheet's compact stop leaves
 * no band, as under Activity and a payment's detail, in the middle of the
 * status row itself, between the mark and the corner control.
 */
export const MINI_IN_BAND = MINI_STRIP / 2;
export const MINI_IN_ROW = -STATUS_ROW / 2;

/** Where the mini strip lands on the way to `launch`. */
export function miniLanding(launch: Launch): number {
  'worklet';
  return launch === 'none' ? MINI_IN_ROW : MINI_IN_BAND;
}

/**
 * The hero at `hero`, from the full balance (1) to the mini strip (0).
 *
 * It scales from its top edge, and rises as it shrinks, so the mini strip
 * lands centred on `landing` (see MINI_IN_BAND), where no scene's content
 * reaches.
 */
export function heroPose(
  hero: number,
  frame: HeroFrame,
  landing = MINI_IN_ROW,
): { scale: number; translateY: number } {
  'worklet';
  const lift = frame.y + (HERO_MINI * frame.height) / 2 - landing;
  return {
    scale: HERO_MINI + (1 - HERO_MINI) * hero,
    translateY: lift * (hero - 1),
  };
}

/**
 * The vessel under the hero fades over the first .3 of the way to the mini
 * strip (REDESIGN.md 7, T5), so it is gone before the hero has shrunk much.
 */
export function vesselOpacity(hero: number): number {
  'worklet';
  return Math.min(1, Math.max(0, (hero - 0.7) / 0.3));
}

/** Which action circle opened the scene the canvas is heading to. */
export type Launch = 'none' | 'send' | 'receive';

/** The Send and Receive circles are 56pt; the scene's hold control is 88. */
const LAUNCH_GROWTH = 88 / 56 - 1;

/** How far the tapped circle drops toward the bottom as it goes. */
export const LAUNCH_DROP = 96;

/** A circle's pose in the action row. */
export interface CirclePose {
  scale: number;
  translateX: number;
  translateY: number;
}

const AT_REST: CirclePose = { scale: 1, translateX: 0, translateY: 0 };

const clamp01 = (x: number) => {
  'worklet';
  return Math.min(1, Math.max(0, x));
};

/**
 * How much of the way the circles not tapped have faded by: two thirds,
 * which the pane spring reaches at about 140ms (REDESIGN.md 7, T1).
 */
const OTHERS_GONE = 2 / 3;

/** The last share of the way, over which the tapped circle hands over. */
const HANDOVER = 0.3;

/**
 * One circle's opacity as the row goes away, `away` running from 0 at home
 * to 1 once it has gone. With nothing launching it is the row's own fade,
 * which the sheet's drag shapes (T5). On the way to Send or Receive the
 * circles not tapped are gone within 140ms (T1), and the tapped one stays
 * whole while it travels and grows, handing over to the scene's own control
 * over the last 30%. Coming back, each comes in the same way in reverse.
 */
export function circleOpacity(
  away: number,
  tapped: boolean,
  launch: Launch,
): number {
  'worklet';
  if (launch === 'none') return clamp01(1 - away);
  if (tapped) return clamp01((1 - away) / HANDOVER);
  return clamp01(1 - away / OTHERS_GONE);
}

/**
 * One circle of the action row while the row fades on the way to Send or
 * Receive (REDESIGN.md 7, T1 and T2). `away` runs from 0 at home to 1 once
 * the row has gone. The tapped circle grows toward the scene's 88pt control
 * as it travels to the bottom centre, `toCentre` points across and a drop
 * down; the others shrink to .8, done by the time the row is half gone. With
 * nothing launching the row is at rest.
 */
export function launchPose(
  away: number,
  tapped: boolean,
  launch: Launch,
  toCentre = 0,
): CirclePose {
  'worklet';
  if (launch === 'none') return AT_REST;
  if (tapped) {
    return {
      scale: 1 + LAUNCH_GROWTH * away,
      translateX: toCentre * away,
      translateY: LAUNCH_DROP * away,
    };
  }
  return {
    scale: 1 - 0.2 * Math.min(1, away * 2.2),
    translateX: 0,
    translateY: 0,
  };
}
