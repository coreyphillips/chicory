import React from 'react';
import type { ReactNode } from 'react';
import { BackHandler } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { Activity } from '@beignet/wallet-core';
import * as Keychain from 'react-native-keychain';
import HapticFeedback from 'react-native-haptic-feedback';
import App from '../App';
import type { Phase } from '../src/stage/phase';
import {
  StageProvider,
  usePhaseBack,
  useSceneBack,
  useStageStore,
} from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { useBackHandler } from '../src/stage/useBackHandler';
import { find, press } from '../test-support/query';
import { activePhase } from '../test-support/scene';

/**
 * Android's back button against the stage (REDESIGN.md 2.2). The listener is
 * captured, so a press here is exactly what the platform would deliver, and
 * its answer is what decides whether the app is left.
 */
const payment: Activity = {
  id: 'a',
  kind: 'sent',
  title: 'Coffee',
  description: '',
  amountSats: 4200,
  feeSats: 1,
  status: 'completed',
  timestamp: Date.parse('2026-06-06T12:00:00Z'),
  reference: '',
};

let listener: (() => boolean | null | undefined) | null = null;
let stage!: StageStore;
const removed = jest.fn();

function Listener({ phase }: { phase: Phase['kind'] }) {
  useBackHandler(phase);
  return null;
}

function Harness({
  phase,
  children,
}: {
  phase: Phase['kind'];
  children?: ReactNode;
}) {
  stage = useStageStore();
  return (
    <StageProvider value={stage}>
      <Listener phase={phase} />
      {children}
    </StageProvider>
  );
}

/** A scene's own step, such as Send's review, that answers back while active. */
function SceneStep({
  handler,
  active = true,
}: {
  handler: () => boolean;
  active?: boolean;
}) {
  useSceneBack(handler, active);
  return null;
}

/** A panel a shell phase opened, such as its network editor. */
function PhaseStep({ handler }: { handler: () => boolean }) {
  usePhaseBack(handler);
  return null;
}

async function render(phase: Phase['kind'], children?: ReactNode) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Harness phase={phase}>{children}</Harness>);
  });
  return tree;
}

/** A step that is open until one press closes it. */
function openStep() {
  let open = true;
  return jest.fn(() => {
    if (!open) return false;
    open = false;
    return true;
  });
}

async function backPress() {
  let handled: boolean | null | undefined;
  await act(async () => {
    handled = listener!();
  });
  return handled;
}

beforeEach(() => {
  listener = null;
  removed.mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      listener = () =>
        handler({ type: 'hardwareBackPress', timeStamp: Date.now() });
      return { remove: removed } as never;
    });
});

afterEach(() => jest.restoreAllMocks());

test('with nothing open, the press is left to the system', async () => {
  const tree = await render('wallet');
  expect(await backPress()).toBe(false);
  expect(stage.state.scene.name).toBe('home');
  await act(async () => tree.unmount());
  expect(removed).toHaveBeenCalledTimes(1);
});

test('a scene returns to the one under it, one press at a time', async () => {
  const tree = await render('wallet');
  await act(async () => stage.actions.openActivity());
  await act(async () => stage.actions.openDetail(payment));
  expect(stage.state.scene.name).toBe('detail');
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('activity');
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('home');
  expect(await backPress()).toBe(false);
  await act(async () => tree.unmount());
});

test('a payment in flight swallows the press and is felt, not obeyed', async () => {
  const tree = await render('wallet');
  await act(async () => stage.actions.openSend());
  await act(async () => stage.actions.setBusy(true));
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('send');
  expect(jest.mocked(HapticFeedback.trigger)).toHaveBeenCalledWith(
    'notificationWarning',
    expect.anything(),
  );
  await act(async () => stage.actions.setBusy(false));
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('home');
  await act(async () => tree.unmount());
});

test('the new wallet sheet closes over a phase that has no canvas', async () => {
  const tree = await render('picker');
  await act(async () => stage.actions.openCreate(false));
  expect(await backPress()).toBe(true);
  expect(stage.state.overlay).toBeNull();
  expect(await backPress()).toBe(false);
  await act(async () => tree.unmount());
});

test('a stack left under another phase, or a locked app, never takes the press', async () => {
  const tree = await render('wallet');
  await act(async () => stage.actions.openSettings());
  await act(async () => tree.update(<Harness phase="picker" />));
  expect(await backPress()).toBe(false);
  await act(async () => tree.update(<Harness phase="locked" />));
  expect(await backPress()).toBe(false);
  expect(stage.state.scene.name).toBe('settings');
  await act(async () => tree.unmount());
});

test('a pane still on its way swallows the press and moves nothing', async () => {
  const tree = await render('wallet');
  await act(async () => stage.actions.openActivity());
  let moving = true;
  stage.panes.current = { moving: () => moving, follow: jest.fn() };
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('activity');
  // Nothing was refused that matters, so nothing is felt either.
  expect(jest.mocked(HapticFeedback.trigger)).not.toHaveBeenCalled();
  moving = false;
  expect(await backPress()).toBe(true);
  expect(stage.state.scene.name).toBe('home');
  await act(async () => tree.unmount());
});

describe('responders', () => {
  test('the innermost scene step goes back before the stack, and passes on what it does not take', async () => {
    const review = openStep();
    const tree = await render('wallet', <SceneStep handler={review} />);
    await act(async () => stage.actions.openActivity());
    await act(async () => stage.actions.openDetail(payment));
    expect(await backPress()).toBe(true);
    expect(review).toHaveBeenCalledTimes(1);
    expect(stage.state.scene.name).toBe('detail');
    expect(await backPress()).toBe(true);
    expect(review).toHaveBeenCalledTimes(2);
    expect(stage.state.scene.name).toBe('activity');
    await act(async () => tree.unmount());
  });

  test('the step that became active last is asked first, and an inactive one never', async () => {
    const outer = jest.fn(() => true);
    const inner = jest.fn(() => true);
    const steps = (outerActive: boolean, innerActive: boolean) => (
      <>
        <SceneStep handler={outer} active={outerActive} />
        <SceneStep handler={inner} active={innerActive} />
      </>
    );
    const tree = await render('wallet', steps(false, true));
    expect(await backPress()).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    // Opened after the other, so it is the innermost now.
    await act(async () =>
      tree.update(<Harness phase="wallet">{steps(true, true)}</Harness>),
    );
    expect(await backPress()).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
    await act(async () =>
      tree.update(<Harness phase="wallet">{steps(false, false)}</Harness>),
    );
    expect(await backPress()).toBe(false);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a scene step answers before a payment in flight holds the press', async () => {
    const review = openStep();
    const tree = await render('wallet', <SceneStep handler={review} />);
    await act(async () => stage.actions.openSend());
    await act(async () => stage.actions.setBusy(true));
    expect(await backPress()).toBe(true);
    expect(review).toHaveBeenCalledTimes(1);
    expect(jest.mocked(HapticFeedback.trigger)).not.toHaveBeenCalled();
    expect(await backPress()).toBe(true);
    expect(stage.state.scene.name).toBe('send');
    expect(jest.mocked(HapticFeedback.trigger)).toHaveBeenCalledWith(
      'notificationWarning',
      expect.anything(),
    );
    await act(async () => tree.unmount());
  });

  test('a phase closes what it opened only once the stage has nothing left to close', async () => {
    const editor = openStep();
    const tree = await render('picker', <PhaseStep handler={editor} />);
    await act(async () => stage.actions.openCreate(false));
    expect(await backPress()).toBe(true);
    expect(stage.state.overlay).toBeNull();
    expect(editor).not.toHaveBeenCalled();
    expect(await backPress()).toBe(true);
    expect(editor).toHaveBeenCalledTimes(1);
    expect(await backPress()).toBe(false);
    await act(async () => tree.unmount());
  });

  test('a locked app and a moving pane ask no responder', async () => {
    const scene = jest.fn(() => true);
    const phase = jest.fn(() => true);
    const both = (
      <>
        <SceneStep handler={scene} />
        <PhaseStep handler={phase} />
      </>
    );
    const tree = await render('locked', both);
    expect(await backPress()).toBe(false);
    await act(async () =>
      tree.update(<Harness phase="wallet">{both}</Harness>),
    );
    stage.panes.current = { moving: () => true, follow: jest.fn() };
    expect(await backPress()).toBe(true);
    expect(scene).not.toHaveBeenCalled();
    expect(phase).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a step that unmounts stops answering', async () => {
    const step = jest.fn(() => true);
    const tree = await render('welcome', <PhaseStep handler={step} />);
    await act(async () => tree.update(<Harness phase="welcome" />));
    expect(await backPress()).toBe(false);
    expect(step).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

test('back closes the device setup the first-run screen opened, then leaves', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<App />);
  });
  expect(activePhase(tree)).toBe('welcome');
  await press(tree, 'Network settings');
  expect(find(tree, 'Back')).toBeDefined();
  expect(await backPress()).toBe(true);
  expect(find(tree, 'Back')).toBeUndefined();
  expect(find(tree, 'Network settings')).toBeDefined();
  expect(await backPress()).toBe(false);
  await act(async () => tree.unmount());
});
