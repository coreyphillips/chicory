import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import type { Activity } from '@beignet/wallet-core';
import { DemoWalletClient } from '@beignet/wallet-core';
import { FILTERS, timeLabel } from '../../src/scenes/activity/model';
import { SheetPane } from '../../src/scenes/activity/SheetPane';
import { ActivityScreen } from '../../src/screens/wallet/Activity';
import { useCanvasView } from '../../src/stage/Canvas';
import { SCENE_LAYOUT, stops } from '../../src/stage/layout';
import type { CanvasSceneName } from '../../src/stage/layout';
import { PanesProvider } from '../../src/stage/panes/Pane';
import { StageProvider, useStageStore } from '../../src/stage/StageContext';
import type { Unit } from '../../src/theme';
import {
  everyActivity,
  guardData,
  snapshotOf,
} from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';

/**
 * Activity under the copy guard (REDESIGN.md rule 1) and the accessibility
 * check (section 9): the list, its rows in every ring state, the attention
 * shelf, the filters and search, and the empty list. The activity and detail
 * track adds each state it redraws, drawn from test-support/fixtures.ts with
 * `guardData` as its data.
 */
const EVERY = everyActivity();
const ALL_ROWS = Object.values(EVERY);
const noop = () => {};

/** A row's time of day, which the rows show under their day header. */
const times = (activity: Activity[]) =>
  activity.map(item => timeLabel(item.timestamp));

/** The list on its own, as the whole list. */
function list(
  name: string,
  activity: Activity[],
  props: {
    filter?: string;
    query?: string;
    hidden?: boolean;
    unit?: Unit;
    refreshError?: string;
  } = {},
): GuardedState {
  const snapshot = snapshotOf({ activity });
  return {
    name,
    render: () =>
      mount(
        <GestureHandlerRootView>
          <ActivityScreen
            snapshot={snapshot}
            onDetail={noop}
            filter={props.filter ?? 'All'}
            onFilter={noop}
            query={props.query ?? ''}
            onQuery={noop}
            hidden={props.hidden}
            unit={props.unit}
            refreshError={props.refreshError}
            onRetry={noop}
          />
        </GestureHandlerRootView>,
      ),
    data: guardData(snapshot, times(activity)),
  };
}

/** The sheet as the canvas holds it, resting on the stop `shown` gives it. */
function OnSheet({
  shown,
  activity,
}: {
  shown: CanvasSceneName;
  activity: Activity[];
}) {
  const stage = useStageStore();
  const view = useCanvasView();
  const at = stops(800, { top: 0 });
  const pose = SCENE_LAYOUT[shown];
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
    <GestureHandlerRootView>
      <StageProvider value={stage}>
        <PanesProvider value={panes}>
          <SheetPane
            shown={shown}
            snapshot={snapshotOf({ activity })}
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
            backup={null}
            arrived={0}
          />
        </PanesProvider>
      </StageProvider>
    </GestureHandlerRootView>
  );
}

function sheet(
  name: string,
  shown: CanvasSceneName,
  activity: Activity[],
): GuardedState {
  return {
    name,
    render: () => mount(<OnSheet shown={shown} activity={activity} />),
    data: guardData(snapshotOf({ activity }), times(activity)),
  };
}

const GUARDED: GuardedState[] = [
  // Every kind of payment in every state, a row each.
  ...Object.entries(EVERY).map(([name, item]) => list(`row: ${name}`, [item])),
  ...Object.entries(EVERY).map(([name, item]) =>
    list(`row, hidden: ${name}`, [item], { hidden: true }),
  ),
  list('rows in BTC', ALL_ROWS.slice(0, 10), { unit: 'btc' }),
  list('the attention band', [
    EVERY['sent completed'],
    EVERY['request partly paid'],
    EVERY['sent uncertain'],
    EVERY['received uncertain'],
  ]),
  ...FILTERS.map(({ value }) =>
    list(`filtered to ${value}`, ALL_ROWS, { filter: value }),
  ),
  list('a search that finds', ALL_ROWS, { query: 'Sam' }),
  list('a search that finds nothing', ALL_ROWS, { query: 'nothing here' }),
  list('a refresh that failed', ALL_ROWS.slice(0, 3), {
    refreshError: 'Timed out',
  }),
  list('empty', []),
  list('empty under a filter', [EVERY['sent completed']], {
    filter: 'Received',
  }),
  sheet('the sheet at home', 'home', ALL_ROWS.slice(0, 6)),
  sheet('the sheet opened', 'activity', ALL_ROWS.slice(0, 6)),
  sheet('the sheet under a detail', 'detail', ALL_ROWS.slice(0, 6)),
  sheet('the sheet empty at home', 'home', []),
];

guard('activity', GUARDED);
