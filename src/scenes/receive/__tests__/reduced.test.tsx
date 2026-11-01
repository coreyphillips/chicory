import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { ReduceMotion } from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../../../design/copy';
import { COPIED, CopyChip } from '../../../glyphs/CopyChip';
import { QR_SETTLED, QrBloom } from '../../../glyphs/QrBloom';
import { durations } from '../../../motion/tokens';
import * as tokens from '../../../motion/tokens';
import { ReceiveScreen } from '../../../screens/Receive';
import type { WalletAdapter } from '../../../services/wallet';
import { mount } from '../../../../test-support/guard';
import { enterAmount } from '../../../../test-support/keypad';
import { find } from '../../../../test-support/query';
import { ListeningPing } from '../ListeningPing';

/**
 * Receive under Reduce Motion (REDESIGN.md 8). Reanimated skips any animation
 * that does not opt out of the system setting, so a crossfade or a tint that
 * stands in for movement has to say ReduceMotion.Never, or nothing shows at
 * all. Jest's Reanimated lands every animation at once, so these read the
 * timings each one is started with.
 *
 * Reduce Motion, once read, holds for the rest of a file, so every test here
 * runs under it.
 */
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const noop = () => {};
const URI = 'bitcoin:bcrt1address?lightning=lnbcrt1invoice';

/** The timings and delays started while `run` runs. */
async function started(run: () => Promise<void>) {
  const timings = jest.spyOn(Reanimated, 'withTiming');
  const delays = jest.spyOn(Reanimated, 'withDelay');
  await run();
  const found = {
    timings: timings.mock.calls.map(([, config]) => config ?? {}),
    delays: delays.mock.calls.map(([, , reduce]) => reduce),
  };
  timings.mockRestore();
  delays.mockRestore();
  return found;
}

const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => find(tree, label)!.props.onPress());

test('a copy crossfades its glyph to a whole check and back', async () => {
  const tree = await mount(
    <CopyChip label="Transaction" value={'ab'.repeat(32)} />,
  );
  const { timings, delays } = await started(() =>
    press(tree, copy.receive.copyValue('Transaction')),
  );
  const fades = timings.filter(config => config.duration === COPIED.glyphOut);
  // Out and back, for the glyph and for the check.
  expect(fades).toHaveLength(4);
  for (const fade of fades) expect(fade.reduceMotion).toBe(ReduceMotion.Never);
  expect(delays.length).toBeGreaterThan(0);
  for (const reduce of delays) expect(reduce).toBe(ReduceMotion.Never);
  await act(async () => tree.unmount());
});

test('a refused control tints radish instead of shaking, and the tint plays', async () => {
  const shakes = jest.spyOn(tokens, 'shake');
  const onRefresh = jest.fn();
  const tree = await mount(
    <ReceiveScreen
      client={{ quoteReceive: jest.fn() } as unknown as WalletAdapter}
      receivableSats={10_000}
      disabled
      onActivity={noop}
      onBusy={noop}
      onRefresh={onRefresh}
    />,
  );
  const { timings, delays } = await started(() =>
    press(tree, copy.receive.continue),
  );
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(shakes).not.toHaveBeenCalled();
  expect(timings.length).toBeGreaterThan(0);
  for (const config of timings) {
    expect(config.reduceMotion).toBe(ReduceMotion.Never);
  }
  for (const reduce of delays) expect(reduce).toBe(ReduceMotion.Never);
  await act(async () => tree.unmount());
});

test('the moon refused offline tints the switch, and the tint plays', async () => {
  const client = {
    getConfig: jest.fn().mockResolvedValue({ offlineReceiveAvailable: true }),
    quoteReceive: jest.fn().mockRejectedValue(
      Object.assign(new Error('Your node cannot take this offline.'), {
        code: 'RECEIVE_UNAVAILABLE',
      }),
    ),
  } as unknown as WalletAdapter;
  const tree = await mount(
    <ReceiveScreen
      client={client}
      receivableSats={10_000}
      offlineReceivableSats={50_000}
      onActivity={noop}
      onBusy={noop}
    />,
  );
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: copy.receive.offline })
      .props.onPress();
  });
  await enterAmount(tree, '1000');
  const { timings } = await started(() => press(tree, copy.receive.continue));
  const tint = timings.filter(config => config.duration === durations.tick);
  expect(tint.length).toBeGreaterThan(0);
  for (const config of tint) {
    expect(config.reduceMotion).toBe(ReduceMotion.Never);
  }
  await act(async () => tree.unmount());
});

test("a request's frame draws no ping while it waits", async () => {
  const client = {
    quoteReceive: jest.fn().mockResolvedValue({
      id: 'q1',
      amountSats: 1000,
      description: '',
      feeSats: 0,
      netSats: 1000,
      expiresAt: Date.now() + 60_000,
      warnings: [],
    }),
    receive: jest.fn().mockResolvedValue({
      id: 'r1',
      uri: URI,
      address: 'bcrt1address',
      bolt11: 'lnbcrt1invoice',
      paymentHash: 'ab'.repeat(32),
      amountSats: 1000,
      description: '',
      feeSats: 0,
      expiresAt: Date.now() + 600_000,
      warnings: [],
      demo: false,
      bitcoinTracking: 'unique',
    }),
    getReceiveStatus: jest.fn().mockResolvedValue({
      phase: 'waiting',
      receivedSats: 0,
      confirmedSats: 0,
      pendingSats: 0,
      txids: [],
    }),
  } as unknown as WalletAdapter;
  const tree = await mount(
    <ReceiveScreen
      client={client}
      receivableSats={10_000}
      onActivity={noop}
      onBusy={noop}
    />,
  );
  await enterAmount(tree, '1000');
  await press(tree, copy.receive.continue);
  await press(tree, copy.receive.create);
  await act(async () => {
    jest.advanceTimersByTime(QR_SETTLED);
  });
  const ping = tree.root.findByType(ListeningPing);
  expect(ping.props.running).toBe(true);
  expect(ping.children).toEqual([]);
  await act(async () => tree.unmount());
});

test('a code fades in and out rather than cutting', async () => {
  const code = (state: 'shown' | 'expired') => (
    <QrBloom value={URI} size={160} state={state} accessibilityLabel="QR" />
  );
  let tree!: ReactTestRenderer;
  const arriving = await started(async () => {
    tree = await mount(code('shown'));
  });
  const leaving = await started(() =>
    act(async () => {
      tree.update(code('expired'));
    }),
  );
  for (const { timings } of [arriving, leaving]) {
    const fades = timings.filter(
      config => config.duration === durations.crossfade,
    );
    expect(fades.length).toBeGreaterThan(0);
    for (const fade of fades) {
      expect(fade.reduceMotion).toBe(ReduceMotion.Never);
    }
  }
  await act(async () => tree.unmount());
});
