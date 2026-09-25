import { createContext, useContext } from 'react';
import type { Arrival, BuildBeats } from '../layout';

/**
 * The build the canvas is playing as it arrives (REDESIGN.md 7, R-1, R-3
 * and R-5): how it came, when each part's beat falls, and when it began.
 */
export interface Build {
  arrival: Arrival;
  beats: BuildBeats;
  /** When the canvas mounted, in `Date.now()` time. */
  began: number;
}

const BuildContext = createContext<Build | null>(null);

export const BuildProvider = BuildContext.Provider;

/**
 * The build under way, for a part of the canvas to enter on its own beat,
 * or null once it has landed, and always off the canvas. A part reads it as
 * it mounts and keeps what it read: an entrance only plays at mount, so a
 * part that mounts after the build, such as a row that arrives later, is
 * not held back to it.
 */
export function useBuild(): Build | null {
  const build = useContext(BuildContext);
  if (!build || Date.now() - build.began > build.beats.done) return null;
  return build;
}
