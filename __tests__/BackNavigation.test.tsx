import React from 'react';
import { BackHandler } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { Activity } from '@beignet/wallet-core';
import HapticFeedback from 'react-native-haptic-feedback';
import type { Phase } from '../src/stage/phase';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { useBackHandler } from '../src/stage/useBackHandler';

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

function Harness({ phase }: { phase: Phase['kind'] }) {
  stage = useStageStore();
  return (
    <StageProvider value={stage}>
      <Listener phase={phase} />
    </StageProvider>
  );
}

async function render(phase: Phase['kind']) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Harness phase={phase} />);
  });
  return tree;
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
