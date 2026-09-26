import type { Activity } from '@beignet/wallet-core';
import { canOpen, initialStage, stageReducer, tabOf } from '../src/stage/scene';
import type { StageAction, StageState } from '../src/stage/scene';

const ITEM: Activity = {
  id: 'payment:1',
  kind: 'sent',
  title: 'Sent',
  description: '',
  amountSats: 1200,
  feeSats: 3,
  status: 'completed',
  timestamp: 1_700_000_000_000,
  reference: 'lnbcrt1invoice',
};

const REQUEST = 'lnbcrt12u1invoice';

const openSend = (prefill = ''): StageAction => ({
  type: 'open',
  scene: { name: 'send', prefill },
});
const openActivity: StageAction = {
  type: 'open',
  scene: { name: 'activity' },
};
const openReceive: StageAction = { type: 'open', scene: { name: 'receive' } };
const openSettings: StageAction = {
  type: 'open',
  scene: { name: 'settings' },
};
const openDetail: StageAction = {
  type: 'open',
  scene: { name: 'detail', item: ITEM, from: null },
};
const scanFrom = (target: 'home' | 'send'): StageAction => ({
  type: 'overlay',
  overlay: { name: 'scan', target, origin: { x: 180, y: 640 } },
});
const create: StageAction = {
  type: 'overlay',
  overlay: { name: 'create', restoring: false },
};

const run = (...actions: StageAction[]) =>
  actions.reduce(stageReducer, initialStage());
const from = (state: StageState, ...actions: StageAction[]) =>
  actions.reduce(stageReducer, state);
const names = (state: StageState) => state.stack.map(scene => scene.name);

test('the stage starts at home with nothing to go back to', () => {
  expect(initialStage()).toEqual({
    scene: { name: 'home', key: 0 },
    stack: [],
    overlay: null,
    busy: false,
    step: null,
    key: 0,
  });
});

describe('open', () => {
  test.each<[string, StageAction]>([
    ['activity', openActivity],
    ['detail', openDetail],
    ['send', openSend()],
    ['receive', openReceive],
    ['settings', openSettings],
  ])('home opens %s over itself', (name, action) => {
    const home = initialStage();
    const next = stageReducer(home, action);
    expect(next.scene.name).toBe(name);
    expect(next.stack).toEqual([home.scene]);
    expect(next.stack[0]).toBe(home.scene);
    expect(next.scene.key).toBe(1);
    expect(next.key).toBe(1);
  });

  test('activity opens a detail and back pops in order', () => {
    const detail = run(openActivity, openDetail);
    expect(detail.scene).toEqual({
      name: 'detail',
      item: ITEM,
      from: null,
      key: 2,
    });
    expect(names(detail)).toEqual(['home', 'activity']);
    const activity = stageReducer(detail, { type: 'back' });
    expect(activity.scene).toBe(detail.stack[1]);
    expect(names(activity)).toEqual(['home']);
    const home = stageReducer(activity, { type: 'back' });
    expect(home.scene).toBe(detail.stack[0]);
    expect(home.stack).toEqual([]);
    expect(stageReducer(home, { type: 'back' })).toBe(home);
  });

  test('activity opens Settings, and back returns to the list', () => {
    const settings = run(openActivity, openSettings);
    expect(settings.scene).toEqual({ name: 'settings', key: 2 });
    expect(names(settings)).toEqual(['home', 'activity']);
    const activity = stageReducer(settings, { type: 'back' });
    expect(activity.scene).toBe(settings.stack[1]);
    expect(names(activity)).toEqual(['home']);
    // Busy holds it shut, as it does every open.
    const busy = from(run(openActivity), { type: 'busy', busy: true });
    expect(stageReducer(busy, openSettings)).toBe(busy);
  });

  test.each<['send' | 'receive', StageAction]>([
    ['send', openSend(REQUEST)],
    ['receive', openReceive],
  ])('%s to activity rebases on home', (_name, action) => {
    const rebased = run(action, openActivity);
    expect(rebased.scene.name).toBe('activity');
    expect(names(rebased)).toEqual(['home']);
    expect(rebased.overlay).toBeNull();
    const back = stageReducer(rebased, { type: 'back' });
    expect(back.scene).toEqual({ name: 'home', key: 0 });
    expect(back.stack).toEqual([]);
  });

  test('opening home clears the stack', () => {
    const next = run(openActivity, openDetail, {
      type: 'open',
      scene: { name: 'home' },
    });
    expect(next.scene).toEqual({ name: 'home', key: 3 });
    expect(next.stack).toEqual([]);
  });

  test.each<[string, StageAction[], StageAction]>([
    ['home from home', [], { type: 'open', scene: { name: 'home' } }],
    ['send from activity', [openActivity], openSend()],
    ['receive from activity', [openActivity], openReceive],
    ['activity from activity', [openActivity], openActivity],
    ['activity from detail', [openDetail], openActivity],
    ['detail from send', [openSend()], openDetail],
    ['receive from send', [openSend()], openReceive],
    ['send from receive', [openReceive], openSend()],
    ['activity from settings', [openSettings], openActivity],
  ])('refuses %s', (_name, before, action) => {
    const state = run(...before);
    expect(stageReducer(state, action)).toBe(state);
  });

  test('canOpen follows the same table', () => {
    const home = initialStage();
    for (const name of [
      'activity',
      'detail',
      'send',
      'receive',
      'settings',
    ] as const)
      expect(canOpen(home, name)).toBe(true);
    expect(canOpen(home, 'home')).toBe(false);
    const activity = run(openActivity);
    expect(canOpen(activity, 'detail')).toBe(true);
    expect(canOpen(activity, 'home')).toBe(true);
    expect(canOpen(activity, 'send')).toBe(false);
    expect(canOpen(activity, 'settings')).toBe(true);
    const send = run(openSend());
    expect(canOpen(send, 'activity')).toBe(true);
    expect(canOpen(send, 'receive')).toBe(false);
    expect(canOpen(run(openSettings), 'activity')).toBe(false);
    expect(canOpen(run(openDetail), 'activity')).toBe(false);
  });

  test('opening a scene closes the overlay above it', () => {
    const next = run(openSend(), scanFrom('send'), openActivity);
    expect(next.scene.name).toBe('activity');
    expect(next.overlay).toBeNull();
  });
});

describe('keys', () => {
  test('a reopened send is a fresh instance', () => {
    const first = run(openSend(REQUEST));
    const reopened = from(first, { type: 'back' }, openSend());
    expect(reopened.scene.name).toBe('send');
    expect(reopened.scene.key).toBeGreaterThan(first.scene.key);
  });

  test('every open and overlay hands out a larger key than the last', () => {
    const keys: number[] = [];
    let state = initialStage();
    for (const action of [
      openActivity,
      openDetail,
      { type: 'back' },
      { type: 'back' },
      openSend(),
      scanFrom('send'),
      { type: 'back' },
      openActivity,
      { type: 'link', request: REQUEST },
    ] as StageAction[]) {
      const next = stageReducer(state, action);
      if (next.key !== state.key) keys.push(next.key);
      state = next;
    }
    expect(keys).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.scene.key).toBe(6);
  });

  test('home keeps its instance through every way back to it', () => {
    const start = initialStage();
    const root = start.scene;
    expect(from(start, openActivity, { type: 'back' }).scene).toBe(root);
    expect(from(start, openSend(), { type: 'home' }).scene).toBe(root);
    expect(from(start, openActivity, openDetail, { type: 'reset' }).scene).toBe(
      root,
    );
    expect(
      from(start, openSettings, { type: 'tab', tab: 'Wallet' }).scene,
    ).toBe(root);
    expect(
      from(start, openActivity, { type: 'link', request: REQUEST }).stack[0],
    ).toBe(root);
  });
});

describe('the send prefill', () => {
  test('lives on the scene', () => {
    expect(run(openSend(REQUEST)).scene).toEqual({
      name: 'send',
      prefill: REQUEST,
      key: 1,
    });
  });

  test.each<[string, StageAction[]]>([
    ['back', [{ type: 'back' }]],
    ['home', [{ type: 'home' }]],
    ['reset', [{ type: 'reset' }]],
    ['the activity handoff', [openActivity, { type: 'back' }]],
    ['a tab', [{ type: 'tab', tab: 'Settings' }, { type: 'back' }]],
  ])('is discarded when %s leaves send', (_name, leave) => {
    const left = run(openSend(REQUEST), ...leave);
    expect(left.scene.name).toBe('home');
    expect(left.stack).toEqual([]);
    const next = from(left, openSend());
    expect(next.scene).toMatchObject({ name: 'send', prefill: '' });
  });
});

describe('busy', () => {
  const busy = run(openSend(REQUEST), { type: 'busy', busy: true });

  test.each<[string, StageAction]>([
    ['back', { type: 'back' }],
    ['home', { type: 'home' }],
    ['open', openActivity],
    ['link', { type: 'link', request: 'lnbcrt1other' }],
    ['overlay', scanFrom('send')],
  ])('blocks %s', (_name, action) => {
    expect(stageReducer(busy, action)).toBe(busy);
  });

  test('closes every scene to canOpen', () => {
    expect(canOpen(busy, 'activity')).toBe(false);
    expect(canOpen(busy, 'home')).toBe(false);
  });

  test('does not block reset, which clears everything', () => {
    const stepped = from(busy, { type: 'step', step: 'review' });
    expect(stageReducer(stepped, { type: 'reset' })).toEqual({
      scene: { name: 'home', key: 0 },
      stack: [],
      overlay: null,
      busy: false,
      step: null,
      key: 1,
    });
  });

  test('does not block a tab from the session', () => {
    const next = stageReducer(busy, { type: 'tab', tab: 'Activity' });
    expect(next.scene.name).toBe('activity');
    expect(names(next)).toEqual(['home']);
  });

  test('an unchanged flag returns the same state', () => {
    expect(stageReducer(busy, { type: 'busy', busy: true })).toBe(busy);
    const idle = stageReducer(busy, { type: 'busy', busy: false });
    expect(idle.busy).toBe(false);
    expect(stageReducer(idle, { type: 'back' }).scene.name).toBe('home');
  });
});

describe('tab', () => {
  test.each<['Wallet' | 'Activity' | 'Settings', string, string[]]>([
    ['Wallet', 'home', []],
    ['Activity', 'activity', ['home']],
    ['Settings', 'settings', ['home']],
  ])('%s lands on %s', (tab, scene, stack) => {
    for (const start of [
      run(),
      run(openSend(REQUEST)),
      run(openActivity, openDetail),
      run(openSettings),
    ]) {
      const next = stageReducer(start, { type: 'tab', tab });
      expect(next.scene.name).toBe(scene);
      expect(names(next)).toEqual(stack);
      expect(tabOf(next)).toBe(tab);
    }
  });

  test('tabOf reads Wallet for every scene that is not a tab of its own', () => {
    expect(tabOf(run())).toBe('Wallet');
    expect(tabOf(run(openSend()))).toBe('Wallet');
    expect(tabOf(run(openReceive))).toBe('Wallet');
    expect(tabOf(run(openDetail))).toBe('Wallet');
    expect(tabOf(run(openActivity))).toBe('Activity');
    expect(tabOf(run(openSettings))).toBe('Settings');
  });

  test('the scene already showing keeps its instance', () => {
    const settings = run(openSettings);
    const next = stageReducer(settings, { type: 'tab', tab: 'Settings' });
    expect(next.scene).toBe(settings.scene);
    expect(next.key).toBe(settings.key);
  });

  test('keeps a wallet being created open', () => {
    const creating = run(create, { type: 'busy', busy: true });
    const next = stageReducer(creating, { type: 'tab', tab: 'Wallet' });
    expect(next.overlay).toBe(creating.overlay);
    expect(next.busy).toBe(true);
  });

  test('closes a scan', () => {
    const scanning = run(scanFrom('home'));
    expect(
      stageReducer(scanning, { type: 'tab', tab: 'Wallet' }).overlay,
    ).toBeNull();
  });
});

describe('back', () => {
  test('closes an overlay before popping the stack', () => {
    const scanning = run(openSend(), scanFrom('send'));
    const closed = stageReducer(scanning, { type: 'back' });
    expect(closed.overlay).toBeNull();
    expect(closed.scene).toBe(scanning.scene);
    const popped = stageReducer(closed, { type: 'back' });
    expect(popped.scene.name).toBe('home');
  });

  test('closes an overlay over home', () => {
    const next = run(create, { type: 'back' });
    expect(next.overlay).toBeNull();
    expect(stageReducer(next, { type: 'back' })).toBe(next);
  });

  test('returns the same state at the root, so Android can exit', () => {
    const root = initialStage();
    expect(stageReducer(root, { type: 'back' })).toBe(root);
  });
});

describe('home', () => {
  test('returns to home from anywhere, closing any overlay', () => {
    const next = run(openActivity, openDetail, { type: 'home' });
    expect(next.scene).toEqual({ name: 'home', key: 0 });
    expect(next.stack).toEqual([]);
    expect(run(scanFrom('home'), { type: 'home' }).overlay).toBeNull();
  });

  test('is a no-op at the root', () => {
    const root = initialStage();
    expect(stageReducer(root, { type: 'home' })).toBe(root);
  });
});

describe('link', () => {
  test('opens send with the request over home', () => {
    const next = run(openSettings, { type: 'link', request: REQUEST });
    expect(next.scene).toEqual({
      name: 'send',
      prefill: REQUEST,
      key: 2,
    });
    expect(names(next)).toEqual(['home']);
  });

  test('closes an overlay', () => {
    expect(
      run(scanFrom('home'), { type: 'link', request: REQUEST }).overlay,
    ).toBeNull();
  });

  test('replaces an idle send with a fresh one', () => {
    const first = run(openSend('lnbcrt1first'));
    const next = from(first, { type: 'link', request: REQUEST });
    expect(next.scene).toMatchObject({ name: 'send', prefill: REQUEST });
    expect(next.scene.key).toBeGreaterThan(first.scene.key);
    expect(names(next)).toEqual(['home']);
  });

  test('is dropped while busy', () => {
    const busy = run(openSend('lnbcrt1first'), { type: 'busy', busy: true });
    const next = stageReducer(busy, { type: 'link', request: REQUEST });
    expect(next).toBe(busy);
    expect(next.scene).toMatchObject({ prefill: 'lnbcrt1first' });
  });
});

describe('overlay', () => {
  test('opens with a key of its own', () => {
    expect(run(scanFrom('home')).overlay).toEqual({
      name: 'scan',
      target: 'home',
      origin: { x: 180, y: 640 },
      key: 1,
    });
    expect(
      run({
        type: 'overlay',
        overlay: { name: 'create', restoring: true },
      }).overlay,
    ).toEqual({ name: 'create', restoring: true, key: 1 });
  });

  test('is ignored while another is open', () => {
    const scanning = run(scanFrom('home'));
    expect(stageReducer(scanning, create)).toBe(scanning);
  });

  test('is ignored while busy', () => {
    const busy = run({ type: 'busy', busy: true });
    expect(stageReducer(busy, create)).toBe(busy);
  });
});

describe('scanned', () => {
  test('a scan from home opens send with the code', () => {
    const next = run(scanFrom('home'), { type: 'scanned', value: REQUEST });
    expect(next.overlay).toBeNull();
    expect(next.scene).toEqual({
      name: 'send',
      prefill: REQUEST,
      key: 2,
    });
    expect(names(next)).toEqual(['home']);
  });

  test('a scan from send only closes the overlay', () => {
    const scanning = run(openSend(), scanFrom('send'));
    const next = stageReducer(scanning, { type: 'scanned', value: REQUEST });
    expect(next.overlay).toBeNull();
    expect(next.scene).toBe(scanning.scene);
    expect(next.scene).toMatchObject({ prefill: '' });
    expect(next.stack).toBe(scanning.stack);
  });

  test('without a scan open it changes nothing', () => {
    const creating = run(create);
    expect(stageReducer(creating, { type: 'scanned', value: REQUEST })).toBe(
      creating,
    );
    const root = initialStage();
    expect(stageReducer(root, { type: 'scanned', value: REQUEST })).toBe(root);
  });
});

describe('step', () => {
  test('is set by the surface that owns it', () => {
    const review = run(openSend(REQUEST), { type: 'step', step: 'review' });
    expect(review.step).toBe('review');
    expect(stageReducer(review, { type: 'step', step: 'review' })).toBe(review);
    expect(stageReducer(review, { type: 'step', step: null }).step).toBeNull();
  });

  test('is dropped when its surface stops being the innermost one', () => {
    const review = run(openSend(REQUEST), { type: 'step', step: 'review' });
    expect(from(review, openActivity).step).toBeNull();
    expect(from(review, scanFrom('send')).step).toBeNull();
    const scanning = run(scanFrom('home'), { type: 'step', step: 'denied' });
    expect(from(scanning, { type: 'back' }).step).toBeNull();
  });

  test('survives a change beneath an overlay that keeps it', () => {
    const creating = run(create, { type: 'step', step: 'restore' });
    expect(from(creating, { type: 'tab', tab: 'Activity' }).step).toBe(
      'restore',
    );
  });
});

test('every stack rests on home', () => {
  const actions: StageAction[] = [
    openActivity,
    openDetail,
    { type: 'back' },
    { type: 'tab', tab: 'Settings' },
    { type: 'back' },
    openSend(REQUEST),
    scanFrom('send'),
    { type: 'scanned', value: REQUEST },
    openActivity,
    openDetail,
    { type: 'link', request: REQUEST },
    { type: 'tab', tab: 'Activity' },
    { type: 'home' },
    scanFrom('home'),
    { type: 'scanned', value: REQUEST },
    { type: 'reset' },
  ];
  let state = initialStage();
  for (const action of actions) {
    state = stageReducer(state, action);
    const root = state.stack.length ? state.stack[0] : state.scene;
    expect(root.name).toBe('home');
  }
});
