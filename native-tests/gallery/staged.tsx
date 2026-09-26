/**
 * The app's own stage, drawn over the gallery's wallet: the shell phase or
 * the canvas, with the scene a state opens, exactly as the app draws them
 * below its providers. Only the session is the gallery's.
 */
import React, { useEffect } from 'react';
import type { Activity, Network, WalletSnapshot } from '@beignet/wallet-core';
import type { WalletSession } from '../../src/services/session';
import type { WalletAdapter } from '../../src/services/wallet';
import type { Phase } from '../../src/stage/phase';
import type { StageAction } from '../../src/stage/scene';
import { Stage } from '../../src/stage/Stage';
import { StageProvider, useStageStore } from '../../src/stage/StageContext';
import { clientOf, onMainnet, sessionOf } from './fakes';
import type { Session } from './fakes';
import { counter, useCount } from './shots';
import type { Counter, Shot, Step, Take } from './shots';

/** One moment of a state: the phase the app is in, and its session. */
export interface Frame {
  phase: Phase;
  session: Session;
}

const noop = () => {};

function Staged({
  frames,
  count,
  open,
}: {
  frames: Frame[];
  count: Counter;
  open: StageAction[];
}) {
  const stage = useStageStore();
  const { dispatch } = stage;
  const at = Math.min(useCount(count), frames.length - 1);
  const { phase, session } = frames[at];
  // The scene is opened once the canvas is up, so it moves there as it does
  // when a control opens it.
  useEffect(() => {
    for (const action of open) dispatch(action);
  }, [dispatch, open]);
  return (
    <StageProvider value={stage}>
      <Stage phase={phase} session={session} onUnlock={noop} />
    </StageProvider>
  );
}

/**
 * The stage in each of `frames` in turn, one a step after the state's own
 * `steps`, with the actions in `open` dispatched as it mounts.
 */
export function staged(
  frames: Frame[],
  open: StageAction[] = [],
  steps: Step[] = [],
): Take {
  const count = counter();
  return {
    view: <Staged frames={frames} count={count} open={open} />,
    steps: [...steps, ...frames.slice(1).map(() => count.next)],
  };
}

/** Hides the balance, through the hero's own handler. */
export const hideBalance: Step = drive => drive.call('onToggleHidden');

/** Shows the balance in the other unit, through the hero's own handler. */
export const swapUnit: Step = drive => drive.call('onToggleUnit');

/** What the app remembers of the wallet on `network`, as it was last open. */
export const remembered = (
  network: Network,
  over: Partial<WalletSession> = {},
): WalletSession => ({
  mode: 'device',
  network,
  walletId: 'fixture-wallet',
  locked: false,
  ...over,
});

export const open = {
  activity: (): StageAction => ({ type: 'open', scene: { name: 'activity' } }),
  settings: (): StageAction => ({ type: 'open', scene: { name: 'settings' } }),
  receive: (): StageAction => ({ type: 'open', scene: { name: 'receive' } }),
  send: (prefill = ''): StageAction => ({
    type: 'open',
    scene: { name: 'send', prefill },
  }),
  detail: (item: Activity): StageAction => ({
    type: 'open',
    scene: { name: 'detail', item, from: null },
  }),
};

/** A state of the open wallet. */
export interface OnWallet {
  /** The wallet as read; the fixture wallet on mainnet, just now, if unset. */
  snapshot?: WalletSnapshot;
  /** Later reads of the wallet, one a step, as polls bring them. */
  later?: WalletSnapshot[];
  session?: Partial<Session>;
  /** Calls the wallet answers its own way in this state. */
  client?: Partial<WalletAdapter>;
  open?: StageAction[];
  steps?: Step[];
}

export function wallet(name: string, make: () => OnWallet = () => ({})): Shot {
  return {
    name,
    make: () => {
      const state = make();
      const snapshot = state.snapshot ?? onMainnet();
      const session = sessionOf(snapshot, {
        client: clientOf(state.client),
        ...state.session,
      });
      const phase: Phase = { kind: 'wallet', error: session.error };
      const frames = [snapshot, ...(state.later ?? [])].map(read => ({
        phase,
        session: { ...session, snapshot: read },
      }));
      return staged(frames, state.open, state.steps);
    },
  };
}
