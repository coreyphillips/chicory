import { Easing } from 'react-native-reanimated';

/**
 * The timing and geometry the settings surfaces move by, as plain numbers so
 * each is a table test (REDESIGN.md 6, Backup and setup).
 */

/** The recovery words rise in reading order, this far apart. */
export const WORD_STAGGER = 30;
/** How far each word rises as it fades in. */
export const WORD_RISE = 6;

/** When the word at `index` starts to rise, from the moment they are shown. */
export const wordDelay = (index: number) => index * WORD_STAGGER;

/**
 * Confirming the phrase is written down is a hold, and a longer one than a
 * payment's: it closes the only reminder there is.
 */
export const BACKUP_HOLD = 900;

/** The hold's fill: quick off the mark, then easing into the last stretch. */
export const HOLD_CURVE = Easing.bezier(0.35, 0, 0.25, 1);

/**
 * When the hold ramp plays each of its four steps, in ms from the press: a
 * tick at each of the first three quarters, and the commit at the fourth.
 */
export function holdSteps(duration: number): number[] {
  return [1, 2, 3, 4].map(step => (duration * step) / 4);
}

/** The words in a typed phrase, however it is spaced. */
export function countWords(phrase: string): number {
  return phrase.trim().split(/\s+/).filter(Boolean).length;
}

/** One ring of the restore bloom holds one petal per word of a short phrase. */
export const RING = 12;

/**
 * How the restore bloom stands for `count` typed words: the inner ring lights
 * a petal per word up to twelve, the outer ring the next twelve. A phrase is
 * ready at exactly 12 or 24; past 24 it is over.
 */
export function phraseBloom(count: number): {
  inner: number;
  outer: number;
  ready: boolean;
  over: boolean;
} {
  return {
    inner: Math.min(count, RING),
    outer: Math.max(0, Math.min(count - RING, RING)),
    ready: count === RING || count === 2 * RING,
    over: count > 2 * RING,
  };
}

/**
 * Where the `index`th petal of a ring points, in degrees clockwise from
 * straight up. The outer ring sits between the inner ring's petals, so the
 * second twelve read as a second row rather than a longer first one. Word
 * one is at the top and the rest follow clockwise, like a clock face.
 */
export function petalAngle(ring: 'inner' | 'outer', index: number): number {
  return 30 * index + (ring === 'outer' ? 15 : 0);
}

/**
 * A petal's pose at unfold `q` and wilt `w`, each 0 to 1, the way the
 * bloom's own petals open (REDESIGN.md 5, Bloom): a narrow, short bud turned
 * back 14 degrees opens to full width and length. A wilted petal leans 10
 * degrees further and falls to .92 of its length. `turn` is in degrees,
 * added to the petal's place.
 */
export function petalPose(q: number, w: number) {
  'worklet';
  return {
    opacity: q,
    turn: 10 * w - 14 * (1 - q),
    scaleX: 0.18 + 0.82 * q,
    scaleY: (0.25 + 0.75 * q) * (1 - 0.08 * w),
  };
}
