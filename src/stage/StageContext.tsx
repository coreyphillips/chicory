import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { Dispatch, PropsWithChildren } from 'react';
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

export interface StageStore {
  state: StageState;
  dispatch: Dispatch<StageAction>;
  actions: StageActions;
}

const StageContext = createContext<StageStore | null>(null);

/**
 * Owns the navigation state. It lives with the wallet session rather than
 * inside the provider, because the session speaks to it too: it moves the
 * user between tabs and closes whatever is open when the wallet changes.
 */
export function useStageStore(): StageStore {
  const [state, dispatch] = useReducer(stageReducer, undefined, initialStage);
  // A scan started inside Send hands its code to that Send, so the stable
  // action reads the scene it was started from.
  const scene = useRef(state.scene.name);
  useLayoutEffect(() => {
    scene.current = state.scene.name;
  }, [state.scene.name]);
  const actions = useMemo<StageActions>(
    () => ({
      openSend: (prefill = '', scanning = false) =>
        dispatch({
          type: 'open',
          scene: { name: 'send', prefill, scanning },
        }),
      openReceive: () => dispatch({ type: 'open', scene: { name: 'receive' } }),
      openScan: origin =>
        dispatch({
          type: 'overlay',
          overlay: {
            name: 'scan',
            target: scene.current === 'send' ? 'send' : 'home',
            origin: origin ?? null,
          },
        }),
      openDetail: (item, rect) =>
        dispatch({
          type: 'open',
          scene: { name: 'detail', item, from: rect ?? null },
        }),
      openActivity: () =>
        dispatch({ type: 'open', scene: { name: 'activity' } }),
      openSettings: () =>
        dispatch({ type: 'open', scene: { name: 'settings' } }),
      openCreate: restoring =>
        dispatch({ type: 'overlay', overlay: { name: 'create', restoring } }),
      back: () => dispatch({ type: 'back' }),
      home: () => dispatch({ type: 'home' }),
      setBusy: busy => dispatch({ type: 'busy', busy }),
    }),
    [],
  );
  return useMemo(() => ({ state, dispatch, actions }), [state, actions]);
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
