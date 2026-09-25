import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
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
  openSend: (prefill?: string, scanning?: boolean) => void;
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

export interface StageStore {
  state: StageState;
  dispatch: Dispatch<StageAction>;
  actions: StageActions;
  /**
   * The canvas's panes, or null when no canvas is drawn. With none, as under
   * a shell phase, nothing is moving and taps go straight through.
   */
  panes: RefObject<PaneMotion | null>;
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
      openSend: (prefill = '', scanning = false) =>
        tap({
          type: 'open',
          scene: { name: 'send', prefill, scanning },
        }),
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
  return useMemo(() => ({ state, dispatch, actions, panes }), [state, actions]);
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
