import React from 'react';
import { Dimensions, FlatList, StyleSheet } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import * as Reanimated from 'react-native-reanimated';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { haptics } from '../../../design/haptics';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import type { Backup } from '../../../stage/Canvas';
import { stops } from '../../../stage/layout';
import { Pane } from '../../../stage/panes/Pane';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import {
  activityOf,
  everyActivity,
  snapshotOf,
} from '../../../../test-support/fixtures';
import {
  field,
  meaning,
  press,
  pressableLabels,
  visibleText,
} from '../../../../test-support/query';
import { ActivityRow, RowListContext } from '../ActivityRow';
import { FilterBar } from '../FilterBar';
import { activityStatus } from '../model';
import * as rowRects from '../rowRects';
import { SheetPane } from '../SheetPane';
import { FLING } from '../sheet';

/**
 * The sheet on the canvas (REDESIGN.md 6 and 7, T5): the drag between home
 * and the whole list, the filters and the search over it, and the one list
 * it keeps throughout.
 */
const EVERY = everyActivity();
const coffee = activityOf('sent', 'completed', { title: 'Coffee' });
const salary = activityOf('received', 'completed', {
  seed: 30,
  title: 'Salary',
  amountSats: 250_000,
});
const ROW = copy.activity.row('Coffee', 4_200, 'Completed');

const session: React.ComponentProps<typeof Canvas>['session'] = {
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
};

let stage!: StageStore;
const client = new DemoWalletClient();

function OnCanvas({
  snapshot = snapshotOf({ activity: [coffee, salary] }),
  error = '',
  backup = null,
}: {
  snapshot?: WalletSnapshot;
  error?: string;
  backup?: Backup | null;
}) {
  stage = useStageStore();
  const view = useCanvasView();
  return (
    <GestureHandlerRootView>
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={client}
          snapshot={snapshot}
          session={{ ...session, error }}
          stale={false}
          backup={backup}
          view={view}
        />
      </StageProvider>
    </GestureHandlerRootView>
  );
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** Lets the springs report that they have settled, which lifts the lock. */
const settle = () => act(async () => {});

const at = () => stops(Dimensions.get('window').height, { top: 0 });

/** The sheet pane, the third the canvas draws. */
const sheetPane = (tree: ReactTestRenderer) => tree.root.findAllByType(Pane)[2];

const seamOf = (tree: ReactTestRenderer) => {
  const host = sheetPane(tree).findAll(
    node => typeof node.type === 'string',
  )[0];
  const style = StyleSheet.flatten(host.props.style) as {
    transform: Record<string, number>[];
  };
  return style.transform.find(step => 'translateY' in step)!.translateY;
};

/** Drags the sheet by `dy` from a start `y` inside it, let go at `velocity`. */
async function drag(
  tree: ReactTestRenderer,
  dy: number,
  { velocity = 0, y = 200 }: { velocity?: number; y?: number } = {},
) {
  const detector = tree.root
    .findByType(SheetPane)
    .findAllByType(GestureDetector)[0];
  await act(async () =>
    fireGestureHandler(detector.props.gesture, [
      { state: State.BEGAN, y },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: dy / 2 },
      { state: State.ACTIVE, translationY: dy },
      { state: State.END, translationY: dy, velocityY: velocity },
    ]),
  );
}

afterEach(() => jest.restoreAllMocks());

describe('the drag', () => {
  test('up from home past 40% opens the list, with a tick on the way and a soft snap', async () => {
    const tick = jest.spyOn(haptics, 'tick');
    const soft = jest.spyOn(haptics, 'soft');
    const tree = await render(<OnCanvas />);
    // Home ticks as a test network wallet opens; only the drag counts here.
    tick.mockClear();
    const span = at().home - at().compact;
    await drag(tree, -0.5 * span);
    expect(stage.state.scene.name).toBe('activity');
    expect(seamOf(tree)).toBe(at().compact);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(soft).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('short of 40% it settles back home and the stage stays', async () => {
    const soft = jest.spyOn(haptics, 'soft');
    const tree = await render(<OnCanvas />);
    const span = at().home - at().compact;
    await drag(tree, -0.3 * span);
    expect(stage.state.scene.name).toBe('home');
    expect(seamOf(tree)).toBe(at().home);
    expect(soft).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a flick opens it however short, and the spring carries the flick', async () => {
    const springs = jest.spyOn(Reanimated, 'withSpring');
    const tree = await render(<OnCanvas />);
    await drag(tree, -40, { velocity: -(FLING + 200) });
    expect(stage.state.scene.name).toBe('activity');
    // The canvas aims the seam at compact once, with the finger's speed, and
    // nothing sets it again after.
    const aimed = springs.mock.calls.filter(([to]) => to === at().compact);
    expect(aimed).toHaveLength(1);
    expect(aimed[0][1]).toMatchObject({ velocity: -(FLING + 200) });
    await act(async () => tree.unmount());
  });

  test('down from the list past 25% goes home, from its top', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await settle();
    const span = at().home - at().compact;
    await drag(tree, 0.3 * span);
    expect(stage.state.scene.name).toBe('home');
    expect(seamOf(tree)).toBe(at().home);
    await act(async () => tree.unmount());
  });

  test('over a list scrolled down, a drag scrolls it and leaves the sheet', async () => {
    // Spied before the gesture is built, since its worklets hold on to what
    // they call.
    const cancel = jest.spyOn(Reanimated, 'cancelAnimation');
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await settle();
    const list = tree.root.findByType(FlatList);
    await act(async () =>
      list.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 300 } } }),
    );
    cancel.mockClear();
    await drag(tree, 400, { velocity: FLING + 200 });
    expect(stage.state.scene.name).toBe('activity');
    // A scroll that never takes the sheet leaves its spring running, so a
    // list scrolled just after it opened cannot stop it short of its stop.
    expect(cancel).not.toHaveBeenCalled();
    // From the grip and the bar above the list, it still moves the sheet.
    await drag(tree, 400, { velocity: FLING + 200, y: 10 });
    expect(stage.state.scene.name).toBe('home');
    expect(cancel).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a release the stage refuses puts the sheet back where it was', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.setBusy(true));
    await drag(tree, -500);
    expect(stage.state.scene.name).toBe('home');
    expect(seamOf(tree)).toBe(at().home);
    await act(async () => tree.unmount());
  });

  test('takes no drag while the sheet is out of use', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openSend());
    const detector = tree.root
      .findByType(SheetPane)
      .findAllByType(GestureDetector)[0];
    expect(detector.props.gesture.config.enabled).toBe(false);
    await act(async () => tree.unmount());
  });
});

describe('the list on the sheet', () => {
  test('is one list, a still preview at home that scrolls once opened', async () => {
    const tree = await render(<OnCanvas />);
    const list = () => tree.root.findAllByType(FlatList);
    expect(list()).toHaveLength(1);
    expect(list()[0].props.scrollEnabled).toBe(false);
    await act(async () => stage.actions.openActivity());
    expect(list()).toHaveLength(1);
    expect(list()[0].props.scrollEnabled).toBe(true);
    await act(async () => stage.actions.openDetail(coffee));
    expect(list()).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('the grip opens it from home, and is only something to hold once open', async () => {
    const tree = await render(<OnCanvas />);
    await press(tree, copy.activity.sheet);
    expect(stage.state.scene.name).toBe('activity');
    await settle();
    await expect(press(tree, copy.activity.sheet)).rejects.toThrow();
    await act(async () => tree.unmount());
  });

  test('the filters are out of reach at home and filter once it is open', async () => {
    const tree = await render(<OnCanvas />);
    await expect(press(tree, 'Sent')).rejects.toThrow();
    await act(async () => stage.actions.openActivity());
    await settle();
    await press(tree, 'Received');
    expect(meaning(tree)).toContain('Salary');
    expect(meaning(tree)).not.toContain(ROW);
    const chip = () =>
      tree.root.findAll(
        node =>
          node.props.accessibilityLabel === 'Received' &&
          !!node.props.accessibilityState,
      )[0];
    expect(chip().props.accessibilityState.selected).toBe(true);
    // The chosen chip again shows everything.
    await press(tree, 'Received');
    expect(chip().props.accessibilityState.selected).toBe(false);
    expect(meaning(tree)).toContain(ROW);
    await act(async () => tree.unmount());
  });

  test('the search glyph opens the field, and back closes it', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await settle();
    expect(() => field(tree, copy.activity.search)).toThrow();
    await press(tree, copy.activity.search);
    const input = field(tree, copy.activity.search);
    expect(input.props.placeholder).toBeUndefined();
    await act(async () => input.props.onChangeText('salary'));
    expect(meaning(tree)).toContain('Salary');
    expect(meaning(tree)).not.toContain(ROW);
    const [back] = newestFirst(stage.responders.sceneBack);
    let took = false;
    await act(async () => {
      took = back();
    });
    expect(took).toBe(true);
    expect(() => field(tree, copy.activity.search)).toThrow();
    expect(meaning(tree)).toContain(ROW);
    expect(newestFirst(stage.responders.sceneBack)).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test('back home, the preview is the whole history again', async () => {
    const tree = await render(<OnCanvas />);
    await act(async () => stage.actions.openActivity());
    await settle();
    await press(tree, 'Sent');
    await press(tree, copy.activity.search);
    await act(async () =>
      field(tree, copy.activity.search).props.onChangeText('coffee'),
    );
    expect(meaning(tree)).not.toContain('Salary');
    await act(async () => stage.actions.home());
    await settle();
    // No bar shows at home to say the list was narrowed, so it is not.
    expect(meaning(tree)).toContain('Salary');
    await act(async () => stage.actions.openActivity());
    await settle();
    expect(() => field(tree, copy.activity.search)).toThrow();
    const sent = tree.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Sent' &&
        !!node.props.accessibilityState,
    )[0];
    expect(sent.props.accessibilityState.selected).toBe(false);
    await act(async () => tree.unmount());
  });

  test('a refresh that failed puts a retry on the open list', async () => {
    const retry = jest.mocked(session.manualRefresh);
    retry.mockClear();
    const tree = await render(<OnCanvas error="Timed out" />);
    const label = copy.activity.refreshFailed('Timed out');
    await expect(press(tree, label)).rejects.toThrow();
    await act(async () => stage.actions.openActivity());
    await settle();
    await press(tree, label);
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('the rows step back under a detail and return after it', async () => {
    const tree = await render(<OnCanvas />);
    // The innermost view around the list that fades.
    const opacity = () => {
      const wrapper = tree.root
        .findByType(SheetPane)
        .findAll(
          node =>
            typeof node.type === 'string' &&
            node.findAllByType(FlatList).length > 0 &&
            StyleSheet.flatten(node.props.style)?.opacity !== undefined,
        )
        .pop()!;
      return StyleSheet.flatten(wrapper.props.style).opacity;
    };
    expect(opacity()).toBe(1);
    await act(async () => stage.actions.openDetail(coffee));
    expect(opacity()).toBe(0);
    await settle();
    await act(async () => stage.actions.back());
    expect(opacity()).toBe(1);
    // Over the whole list the filter bar goes and comes back with them.
    const bar = () =>
      StyleSheet.flatten(
        tree.root
          .findByType(FilterBar)
          .findAll(node => typeof node.type === 'string')[0].props.style,
      ).opacity;
    await settle();
    await act(async () => stage.actions.openActivity());
    await settle();
    expect(bar()).toBe(1);
    await act(async () => stage.actions.openDetail(coffee));
    expect(bar()).toBe(0);
    await settle();
    await act(async () => stage.actions.back());
    expect(bar()).toBe(1);
    await act(async () => tree.unmount());
  });
});

describe('the rows', () => {
  // The row is memoized; the test renderer sees the component inside.
  const ROW_TYPE = (ActivityRow as unknown as { type: React.ComponentType })
    .type;
  const rowsOf = (tree: ReactTestRenderer) =>
    tree.root.findByType(SheetPane).findAll(node => node.type === ROW_TYPE);
  const outer = (row: ReactTestInstance) =>
    row.findAll(node => typeof node.type === 'string')[0];

  test('only a payment that arrives while the list is shown fades in', async () => {
    const first = snapshotOf({ activity: [coffee, salary] });
    const tree = await render(<OnCanvas snapshot={first} />);
    for (const row of rowsOf(tree)) {
      expect(outer(row).props.entering).toBeUndefined();
    }
    const arrived = activityOf('received', 'completed', {
      seed: 40,
      title: 'Refund',
      timestamp: coffee.timestamp + 1,
    });
    await act(async () =>
      tree.update(
        <OnCanvas
          snapshot={snapshotOf({ activity: [arrived, coffee, salary] })}
        />,
      ),
    );
    const entering = rowsOf(tree).map(row => [
      row.props.item.id,
      typeof outer(row).props.entering,
    ]);
    expect(entering).toEqual([
      [arrived.id, 'function'],
      [coffee.id, 'undefined'],
      [salary.id, 'undefined'],
    ]);
    await act(async () => tree.unmount());
  });

  test('a poll that changed nothing hands the rows the objects they had', async () => {
    const tree = await render(<OnCanvas />);
    const before = rowsOf(tree).map(row => row.props.item);
    const again = snapshotOf({
      activity: [coffee, salary].map(item => ({ ...item })),
    });
    await act(async () => tree.update(<OnCanvas snapshot={again} />));
    rowsOf(tree).forEach((row, index) =>
      expect(row.props.item).toBe(before[index]),
    );
    await act(async () => tree.unmount());
  });

  const rect = { x: 24, y: 480, width: 327, height: 64 };

  test('a row pressed says where it is, for the detail to grow out of', async () => {
    const onPress = jest.fn();
    const measure = jest.spyOn(rowRects, 'measureNode').mockReturnValue(rect);
    const tree = await render(<ActivityRow item={coffee} onPress={onPress} />);
    await press(tree, ROW);
    expect(onPress).toHaveBeenCalledWith(coffee, rect);
    // Where nothing can be measured, it opens all the same, from nowhere.
    measure.mockReturnValue(null);
    await press(tree, ROW);
    expect(onPress).toHaveBeenLastCalledWith(coffee, undefined);
    await act(async () => tree.unmount());
  });

  test('rows in the list can be found again while they are drawn', async () => {
    const node = {
      measureInWindow: (
        done: (x: number, y: number, w: number, h: number) => void,
      ) => done(rect.x, rect.y, rect.width, rect.height),
    };
    const unregister = rowRects.registerRow('drawn', {
      current: node as never,
    });
    expect(rowRects.measureRow('drawn')).toEqual(rect);
    unregister();
    expect(rowRects.measureRow('drawn')).toBeNull();
    // A node that does not answer at once is not waited for.
    const silent = { measureInWindow: jest.fn() };
    expect(rowRects.measureNode(silent as never)).toBeNull();

    const register = jest.spyOn(rowRects, 'registerRow');
    const release = jest.fn();
    register.mockReturnValue(release);
    const alone = await render(
      <ActivityRow item={coffee} onPress={jest.fn()} />,
    );
    expect(register).not.toHaveBeenCalled();
    await act(async () => alone.unmount());
    const listed = await render(
      <RowListContext value={{ seen: () => true }}>
        <ActivityRow item={coffee} onPress={jest.fn()} />
      </RowListContext>,
    );
    expect(register).toHaveBeenCalledWith(coffee.id, expect.anything());
    await act(async () => listed.unmount());
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('payments that need attention sit first, in the honey band', async () => {
    const tree = await render(
      <OnCanvas
        snapshot={snapshotOf({
          activity: [
            coffee,
            EVERY['request partly paid'],
            EVERY['sent uncertain'],
          ],
        })}
      />,
    );
    expect(
      rowsOf(tree).map(row => [row.props.item.id, row.props.band]),
    ).toEqual([
      [EVERY['sent uncertain'].id, 'start'],
      [EVERY['request partly paid'].id, 'end'],
      [coffee.id, undefined],
    ]);
    await act(async () => tree.unmount());
  });
});

describe('a recovery phrase still to save', () => {
  const backup = (): Backup => ({
    pending: true,
    loadPhrase: jest.fn(),
    onSaved: jest.fn(),
  });

  test('is a shield pinned first on the open list, and opens Settings', async () => {
    const tree = await render(
      <OnCanvas
        backup={backup()}
        snapshot={snapshotOf({
          activity: [coffee, EVERY['sent uncertain']],
        })}
      />,
    );
    await act(async () => stage.actions.openActivity());
    await settle();
    // The shield comes before the payments that need attention, and says
    // what it is only to a screen reader: the phrase and its words stay in
    // Settings.
    const labels = [...pressableLabels(tree)];
    const shield = labels.indexOf(copy.health.backupPending);
    const uncertain = EVERY['sent uncertain'];
    const held = labels.indexOf(
      copy.activity.row(
        uncertain.title,
        uncertain.amountSats,
        activityStatus(uncertain),
      ),
    );
    expect(shield).toBeGreaterThanOrEqual(0);
    expect(shield).toBeLessThan(held);
    expect(labels).not.toContain('Reveal recovery phrase');
    expect(visibleText(tree)).not.toContain(copy.health.backupPending);
    const tick = jest.spyOn(haptics, 'tick');
    await press(tree, copy.health.backupPending);
    expect(tick).toHaveBeenCalled();
    expect(stage.state.scene.name).toBe('settings');
    // Settings leads with the phrase to save.
    await settle();
    expect(pressableLabels(tree)).toContain('Reveal recovery phrase');
    await act(async () => tree.unmount());
  });

  test('cannot be dismissed, and goes once the phrase is saved', async () => {
    const pending = backup();
    const tree = await render(<OnCanvas backup={pending} />);
    // At home the status row carries the shield, so the list does not.
    expect(
      tree.root
        .findByType(SheetPane)
        .findAll(
          node => node.props.accessibilityLabel === copy.health.backupPending,
        ),
    ).toHaveLength(0);
    await act(async () => stage.actions.openActivity());
    await settle();
    // It stays however the list is narrowed.
    await press(tree, 'Received');
    expect(pressableLabels(tree)).toContain(copy.health.backupPending);
    await act(async () =>
      tree.update(<OnCanvas backup={{ ...pending, pending: false }} />),
    );
    expect(pressableLabels(tree)).not.toContain(copy.health.backupPending);
    await act(async () => tree.unmount());
  });
});
