import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { PropsWithChildren, RefObject } from 'react';
import type { HostInstance } from 'react-native';
import { focusOn } from '../../motion/focus';
import { afterTransition } from '../../motion/idle';
import type { Scene } from '../scene';

/**
 * Where a screen reader lands as the canvas arrives at a scene (REDESIGN.md
 * 9). Each region names its scene's primary element with `usePrimary`: the
 * SceneSlot header where the scene has one, else its first control. The
 * canvas moves focus there once the move that brought the scene has
 * settled, so focus is never left on a control that went away with the
 * scene before.
 */
export type Primaries = Map<Scene['name'], RefObject<HostInstance | null>>;

const PrimaryContext = createContext<{
  primaries: Primaries;
  scene: Scene['name'];
} | null>(null);

/** Names `scene` as the scene of whatever region is drawn in `children`. */
export function PrimaryFor({
  primaries,
  scene,
  children,
}: PropsWithChildren<{ primaries: Primaries; scene: Scene['name'] }>) {
  const value = useMemo(() => ({ primaries, scene }), [primaries, scene]);
  return (
    <PrimaryContext.Provider value={value}>{children}</PrimaryContext.Provider>
  );
}

/**
 * A ref for the primary element of the scene this is drawn in. The first
 * element to claim a scene keeps it while it is drawn. Outside the canvas it
 * is a plain ref.
 */
export function usePrimary<
  T extends HostInstance = HostInstance,
>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  const at = useContext(PrimaryContext);
  useLayoutEffect(() => {
    if (!at || at.primaries.has(at.scene)) return;
    at.primaries.set(at.scene, ref);
    return () => {
      at.primaries.delete(at.scene);
    };
  }, [at]);
  return ref;
}

/**
 * Moves a screen reader to the primary element of `scene` each time the
 * stage arrives at a scene, and again as an overlay over it closes, once
 * nothing is moving. While an overlay is open it moves nothing: the overlay
 * holds the screen.
 */
export function usePrimaryFocus(
  primaries: Primaries,
  scene: Scene,
  overlaid: boolean,
) {
  const { key, name } = scene;
  useEffect(() => {
    if (overlaid) return;
    return afterTransition(() => focusOn(primaries.get(name)?.current));
  }, [primaries, key, name, overlaid]);
}
