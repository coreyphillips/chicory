import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Dispatch, PropsWithChildren, RefObject } from 'react';
import type { Activity } from '@beignet/wallet-core';
import { initialStage, stageReducer } from './scene';
import type { Rect, StageAction, StageState } from './scene';

/**
 * Every way a control moves the canvas, named for what it asks. Each is a
 * stable function for the life of the stage, so a screen can take one as a
 * prop without re-rendering whenever the scene changes.
 */
export interface StageActions {
  openSend: (prefill?: string) => void;
  openReceive: () => void;
  openScan: (origin?: { x: number; y: number }) => void;
  openDetail: (item: Activity, rect?: Rect) => void;
  openActivity: () => void;
  openSettings: () => void;
  openCreate: (restoring: boolean) => void;
  back: () => void;
  home: () => void;
  setBusy: (busy: boolean) => void;
}

/**
 * What the canvas tells the stage about its panes, while it is drawn.
 */
export interface PaneMotion {
  /** A pane is still on its way, so a tap now would land on a moving target. */
  moving: () => boolean;
  /** Starts the panes toward `next`, in the tick a tap asked for it. */
  follow: (next: StageState) => void;
}

/** One registered answer, read at the moment it is asked for. */
export type Responder<T> = { current: T };

/**
 * What surfaces inside the stage answer before the stage itself does. Each
 * set is in the order its entries became active, so the newest, the
 * innermost surface on screen, is asked first.
 */
export interface Responders {
  /** Android back inside a scene: Send's review, a lifted QR, a search. */
  sceneBack: Set<Responder<() => boolean>>;
  /** Android back inside a shell phase: a panel or an editor it opened. */
  phaseBack: Set<Responder<() => boolean>>;
  /** Where a code scanned for the Send already open goes. */
  scan: Set<Responder<(value: string) => void>>;
}

/** A registry's answers, newest first. */
export function newestFirst<T>(registry: Set<Responder<T>>): T[] {
  return [...registry].reverse().map(entry => entry.current);
}

export interface StageStore {
  state: StageState;
  dispatch: Dispatch<StageAction>;
  actions: StageActions;
  /**
   * The canvas's panes, or null when no canvas is drawn. With none, as under
   * a shell phase, nothing is moving and taps go straight through.
   */
  panes: RefObject<PaneMotion | null>;
  responders: Responders;
}

const StageContext = createContext<StageStore | null>(null);

/**
 * Owns the navigation state. It lives with the wallet session rather than
 * inside the provider, because the session speaks to it too: it moves the
 * user between tabs and closes whatever is open when the wallet changes.
 */
export function useStageStore(): StageStore {
  const [state, dispatch] = useReducer(stageReducer, undefined, initialStage);
  const panes = useRef<PaneMotion | null>(null);
  const [responders] = useState<Responders>(() => ({
    sceneBack: new Set(),
    phaseBack: new Set(),
    scan: new Set(),
  }));
  // The state as of the last tap, ahead of React while a render is pending,
  // so two taps in one tick each start from where the one before led. A scan
  // started inside Send also reads it, to hand its code to that Send.
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  const actions = useMemo<StageActions>(() => {
    // A tap is refused while a pane is still moving. Otherwise the panes start
    // toward where it leads in the same tick, rather than a frame later when
    // the canvas renders the new scene.
    const tap = (action: StageAction) => {
      const motion = panes.current;
      if (motion?.moving()) return;
      const before = latest.current;
      latest.current = stageReducer(before, action);
      dispatch(action);
      if (latest.current !== before) motion?.follow(latest.current);
    };
    return {
      openSend: (prefill = '') =>
        tap({ type: 'open', scene: { name: 'send', prefill } }),
      openReceive: () => tap({ type: 'open', scene: { name: 'receive' } }),
      openScan: origin =>
        tap({
          type: 'overlay',
          overlay: {
            name: 'scan',
            target: latest.current.scene.name === 'send' ? 'send' : 'home',
            origin: origin ?? null,
          },
        }),
      openDetail: (item, rect) =>
        tap({
          type: 'open',
          scene: { name: 'detail', item, from: rect ?? null },
        }),
      openActivity: () => tap({ type: 'open', scene: { name: 'activity' } }),
      openSettings: () => tap({ type: 'open', scene: { name: 'settings' } }),
      openCreate: restoring =>
        tap({ type: 'overlay', overlay: { name: 'create', restoring } }),
      back: () => tap({ type: 'back' }),
      home: () => tap({ type: 'home' }),
      // A screen's own state, not a tap: a payment that starts while a pane
      // settles must still hold the user in it.
      setBusy: busy => dispatch({ type: 'busy', busy }),
    };
  }, []);
  return useMemo(
    () => ({ state, dispatch, actions, panes, responders }),
    [state, actions, responders],
  );
}

export function StageProvider({
  value,
  children,
}: PropsWithChildren<{ value: StageStore }>) {
  return (
    <StageContext.Provider value={value}>{children}</StageContext.Provider>
  );
}

/** The stage the calling component is drawn on. */
export function useStage(): StageStore {
  const stage = useContext(StageContext);
  if (!stage) throw new Error('useStage is only available inside a Stage.');
  return stage;
}

/**
 * Keeps `value` in `registry` while `active`, always its latest version. An
 * entry that turns active again moves to the end, as the newest.
 */
export function useResponder<T>(
  registry: Set<Responder<T>>,
  value: T,
  active: boolean,
) {
  const entry = useRef(value);
  useLayoutEffect(() => {
    entry.current = value;
  });
  useLayoutEffect(() => {
    if (!active) return;
    registry.add(entry);
    return () => {
      registry.delete(entry);
    };
  }, [registry, active]);
}

/**
 * Answers Android back inside a scene while `active`, before the stage steps
 * back through its stack (REDESIGN.md 2.2). `handler` returns true when it
 * took the press, such as Send's review returning to compose, and false to
 * pass it on. The innermost wins: the one that became active last is asked
 * first. A surface that another covers, such as one under the scan overlay,
 * passes `active` false, which `usePaneActive()` tells it.
 */
export function useSceneBack(handler: () => boolean, active: boolean) {
  useResponder(useStage().responders.sceneBack, handler, active);
}

/**
 * Answers Android back inside a shell phase, once the stage has nothing of
 * its own left to close: a panel or an editor the phase opened. `handler`
 * returns true when it took the press, and false to let the system have it.
 */
export function usePhaseBack(handler: () => boolean) {
  useResponder(useStage().responders.phaseBack, handler, true);
}
