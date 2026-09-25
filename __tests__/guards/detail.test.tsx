import React from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { Activity, WalletRecord } from '@beignet/wallet-core';
import { DetailLayer } from '../../src/scenes/detail/DetailLayer';
import { DetailScreen } from '../../src/screens/wallet/Detail';
import { useCanvasView } from '../../src/stage/Canvas';
import type { Backup } from '../../src/stage/Canvas';
import { SCENE_LAYOUT, stops } from '../../src/stage/layout';
import { PanesProvider } from '../../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../../src/stage/StageContext';
import {
  everyActivity,
  guardData,
  snapshotOf,
} from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * A payment's detail under the copy guard (REDESIGN.md rule 1) and the
 * accessibility check (section 9): its header, its lines and its copy chips,
 * for every kind of payment in every ring state, on mainnet and on a test
 * network, shown and hidden, and on the canvas with a recovery phrase still
 * to save. The activity and detail track adds each state it redraws, drawn
 * from test-support/fixtures.ts with `guardData` as its data.
 *
 * A request's receipt and the request itself are Receive's to draw, and are
 * drawn here as the detail shows them, so this guard holds them too.
 */

const EVERY = everyActivity();

function detail(
  name: string,
  item: Activity,
  props: { hidden?: boolean; unit?: 'sats' | 'btc'; test?: boolean } = {},
): GuardedState {
  return {
    name,
    render: () => mount(<DetailScreen item={item} {...props} />),
    data: guardData(snapshotOf({ activity: [item] })),
  };
}

interface Canvas {
  /** What the wallet looks like, over the fixture's regtest one. */
  wallet?: Partial<WalletRecord>;
  hidden?: boolean;
  backup?: Backup | null;
}

/** The detail as the canvas holds it, in its card at the compact stop. */
function OnCanvas({
  item,
  wallet,
  hidden = false,
  backup = null,
}: Canvas & { item: Activity }) {
  const stage = useStageStore();
  const view = { ...useCanvasView(), hidden };
  const at = stops(800, { top: 0 });
  const pose = SCENE_LAYOUT.detail;
  const panes = {
    seam: useSharedValue(at[pose.seam]),
    hero: useSharedValue(pose.hero),
    bar: useSharedValue(pose.bar),
    cover: useSharedValue(0),
    scan: useSharedValue(0),
    pull: useSharedValue(0),
    stops: at,
  };
  return (
    <StageProvider value={stage}>
      <PanesProvider value={panes}>
        <DetailLayer
          item={item}
          from={null}
          snapshot={snapshotOf({ activity: [item], wallet })}
          client={new DemoWalletClient()}
          session={{
            error: '',
            switchError: '',
            refreshing: false,
            connecting: false,
            refresh: jest.fn(),
            manualRefresh: jest.fn(),
            disconnect: jest.fn(),
            chooseWallet: jest.fn(),
            switchNetwork: jest.fn(),
            eraseDevice: jest.fn(),
          }}
          view={view}
          stale={false}
          backup={backup}
          arrived={0}
        />
      </PanesProvider>
    </StageProvider>
  );
}

function onCanvas(
  name: string,
  item: Activity,
  props: Canvas = {},
): GuardedState {
  return {
    name,
    render: () => mount(<OnCanvas item={item} {...props} />),
    data: guardData(snapshotOf({ activity: [item], wallet: props.wallet })),
  };
}

const GUARDED: GuardedState[] = [
  // Every kind of payment in every state.
  ...Object.entries(EVERY).map(([name, item]) => detail(name, item)),
  ...Object.entries(EVERY).map(([name, item]) =>
    detail(`hidden: ${name}`, item, { hidden: true }),
  ),
  detail('in BTC: sent', EVERY['sent completed'], { unit: 'btc' }),
  detail('in BTC: an estimated fee', EVERY['sent with an estimated fee'], {
    unit: 'btc',
  }),
  detail('in BTC: a request for any amount', EVERY['request for any amount'], {
    unit: 'btc',
  }),
  ...Object.entries(EVERY).map(([name, item]) =>
    detail(`on a test network: ${name}`, item, { test: true }),
  ),
  onCanvas('on the canvas', EVERY['received with a note']),
  onCanvas('on the canvas, mainnet', EVERY['sent pending'], {
    wallet: { network: 'mainnet' },
  }),
  onCanvas('on the canvas, hidden', EVERY['received with a note'], {
    hidden: true,
  }),
  onCanvas('on the canvas, a backup to save', EVERY['sent uncertain'], {
    backup: { pending: true, loadPhrase: jest.fn(), onSaved: jest.fn() },
  }),
  onCanvas(
    'on the canvas, a reused address, hidden, on mainnet',
    EVERY['request with a reused address'],
    {
      hidden: true,
      wallet: { network: 'mainnet' },
      backup: { pending: true, loadPhrase: jest.fn(), onSaved: jest.fn() },
    },
  ),
];

guard('detail', GUARDED);
