import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import App from '../App';
import { Scanner } from '../src/components/Scanner';
import * as DeviceWallet from '../src/embedded/client';
import * as SendRegion from '../src/scenes/send/SendScene';
import { HomeScreen } from '../src/screens/Wallet';
import { SendScreen } from '../src/screens/Payments';
import { defaultPreferences } from '../src/services/networks';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import { ScanReveal } from '../src/stage/layers/ScanReveal';
import { usePaneActive } from '../src/stage/panes/Pane';
import {
  StageProvider,
  useIsCurrentScene,
  useStageStore,
} from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { useScanReceiver } from '../src/stage/useScanReceiver';
import { field, pressableLabels, press } from '../test-support/query';
import { activeScene } from '../test-support/scene';

/**
 * The scan overlay (REDESIGN.md 2.3): a layer over the whole canvas, which
 * leaves the panes drawn beneath and out of use. A code it reads from home
 * opens Send with it; a code read for the Send already open goes to that
 * Send. Either way a code only fills in a request, and nothing is paid.
 */
const SCANNED = 'lnbcrt1scanned';

const scanner = (tree: ReactTestRenderer) => tree.root.findAllByType(Scanner);
const detect = (tree: ReactTestRenderer, value: string) =>
  act(async () => {
    tree.root.findByType(ScanReveal).props.onDetected(value);
  });

describe('from the app', () => {
  const wallet = {
    id: 'scan-wallet',
    name: 'Scan wallet',
    network: 'regtest' as const,
    status: 'running',
  };
  let device: EmbeddedWalletClient;
  let tree: ReactTestRenderer;
  const spies: jest.SpyInstance[] = [];

  beforeEach(async () => {
    const preferences = defaultPreferences();
    preferences.legacyNetwork = null;
    preferences.selectedNetwork = 'regtest';
    jest.mocked(Keychain.getGenericPassword).mockImplementation(async options =>
      options?.service === 'com.beignet.wallet.last-session'
        ? ({
            password: JSON.stringify({
              mode: 'device',
              network: 'regtest',
              walletId: wallet.id,
              locked: false,
            }),
          } as never)
        : options?.service === 'com.beignet.wallet.network-profiles'
        ? ({ password: JSON.stringify(preferences) } as never)
        : false,
    );
    device = new EmbeddedWalletClient({
      runtime: { request: jest.fn(), close: jest.fn() },
    });
    device.listWallets = jest.fn().mockResolvedValue([wallet]);
    device.startWallet = jest.fn().mockResolvedValue(undefined);
    device.snapshot = jest.fn().mockResolvedValue({
      ...(await new DemoWalletClient().snapshot()),
      wallet,
      demo: false,
    });
    device.send = jest.fn();
    spies.push(
      jest
        .spyOn(DeviceWallet, 'loadDevicePreferences')
        .mockResolvedValue(preferences),
      jest.spyOn(DeviceWallet, 'openDeviceWallet').mockResolvedValue(device),
    );
    await act(async () => {
      tree = create(<App />);
    });
  });

  afterEach(async () => {
    await act(async () => tree.unmount());
    for (const spy of spies.splice(0)) spy.mockRestore();
    jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  });

  test('home scan opens the overlay over a home that stays drawn, out of reach', async () => {
    expect(activeScene(tree)).toBe('home');
    await press(tree, 'Scan a payment request');
    const [reveal] = tree.root.findAllByType(ScanReveal);
    expect(reveal.props.target).toBe('home');
    expect(scanner(tree)).toHaveLength(1);
    // The scene under it has not changed, and none of it can be pressed.
    expect(activeScene(tree)).toBe('home');
    expect(tree.root.findAllByType(HomeScreen)).toHaveLength(1);
    const reachable = pressableLabels(tree);
    for (const label of ['Send', 'Receive', 'Settings', 'Activity']) {
      expect(reachable).not.toContain(label);
    }
  });

  test('a code read from home opens Send with it, and nothing is paid', async () => {
    await press(tree, 'Scan a payment request');
    await detect(tree, SCANNED);
    expect(tree.root.findAllByType(ScanReveal)).toHaveLength(0);
    expect(scanner(tree)).toHaveLength(0);
    expect(activeScene(tree)).toBe('send');
    expect(field(tree, 'Payment request or address').props.value).toBe(SCANNED);
    expect(device.send).not.toHaveBeenCalled();
  });

  test('closing the camera returns to home with nothing opened', async () => {
    await press(tree, 'Scan a payment request');
    await act(async () => {
      tree.root.findByType(ScanReveal).props.onCancel();
    });
    expect(tree.root.findAllByType(ScanReveal)).toHaveLength(0);
    expect(activeScene(tree)).toBe('home');
    expect(pressableLabels(tree)).toContain('Send');
  });
});

describe('inside Send', () => {
  let stage!: StageStore;
  let snapshot: WalletSnapshot;
  const client = new DemoWalletClient();

  beforeAll(async () => {
    snapshot = await client.snapshot();
  });

  function Receiver({
    onCode,
    active,
  }: {
    onCode: (value: string) => void;
    active: boolean;
  }) {
    useScanReceiver(onCode, active);
    return null;
  }

  function OnCanvas({
    receivers = [],
  }: {
    receivers?: { onCode: (value: string) => void; active: boolean }[];
  }) {
    stage = useStageStore();
    const view = useCanvasView();
    return (
      <StageProvider value={stage}>
        <Canvas
          scene={stage.state.scene}
          overlay={stage.state.overlay}
          client={client}
          snapshot={snapshot}
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
          stale={false}
          backup={null}
          view={view}
        />
        {receivers.map((receiver, index) => (
          <Receiver key={index} {...receiver} />
        ))}
      </StageProvider>
    );
  }

  async function render(element: React.ReactElement) {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(element);
    });
    return tree;
  }

  /** Opens Send, then the scan from inside it. */
  async function scanInSend(tree: ReactTestRenderer) {
    await act(async () => stage.actions.openSend());
    const send = stage.state.scene.key;
    await act(async () => stage.actions.openScan());
    expect(tree.root.findByType(ScanReveal).props.target).toBe('send');
    return send;
  }

  test('the Send already open takes the code, and stays the same Send', async () => {
    const onCode = jest.fn();
    const tree = await render(
      <OnCanvas receivers={[{ onCode, active: true }]} />,
    );
    const send = await scanInSend(tree);
    await detect(tree, SCANNED);
    expect(onCode).toHaveBeenCalledWith(SCANNED);
    expect(stage.state.overlay).toBeNull();
    expect(stage.state.scene).toMatchObject({ name: 'send', key: send });
    expect(tree.root.findByType(SendScreen).props.initialRequest).toBe('');
    await act(async () => tree.unmount());
  });

  test('the receiver that became active last takes it, and an inactive one never', async () => {
    const first = jest.fn();
    const last = jest.fn();
    const idle = jest.fn();
    const tree = await render(
      <OnCanvas
        receivers={[
          { onCode: first, active: true },
          { onCode: last, active: true },
          { onCode: idle, active: false },
        ]}
      />,
    );
    await scanInSend(tree);
    await detect(tree, SCANNED);
    expect(last).toHaveBeenCalledWith(SCANNED);
    expect(first).not.toHaveBeenCalled();
    expect(idle).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('with no receiver, the scan closes over the same Send', async () => {
    const tree = await render(<OnCanvas />);
    const send = await scanInSend(tree);
    await detect(tree, SCANNED);
    expect(stage.state.overlay).toBeNull();
    expect(stage.state.scene).toMatchObject({ name: 'send', key: send });
    await act(async () => tree.unmount());
  });

  test('a receiver in the Send scene, keyed to the scene, takes the code the overlay reads over it', async () => {
    // The Send scene the canvas draws, with two receivers inside it: one
    // active while its scene is the current one, as useScanReceiver asks,
    // and one active while its pane is in use, which the overlay ends.
    const { SendScene } = SendRegion;
    const keyed = jest.fn();
    const paned = jest.fn();
    function InScene({ sceneKey }: { sceneKey: number }) {
      useScanReceiver(keyed, useIsCurrentScene(sceneKey));
      useScanReceiver(paned, usePaneActive());
      return null;
    }
    const spy = jest
      .spyOn(SendRegion, 'SendScene')
      .mockImplementation(props => (
        <>
          <SendScene {...props} />
          <InScene sceneKey={props.sceneKey} />
        </>
      ));
    try {
      const tree = await render(<OnCanvas />);
      const send = await scanInSend(tree);
      expect(spy.mock.lastCall?.[0].sceneKey).toBe(send);
      await detect(tree, SCANNED);
      expect(keyed).toHaveBeenCalledWith(SCANNED);
      expect(paned).not.toHaveBeenCalled();
      expect(stage.state.overlay).toBeNull();
      expect(stage.state.scene).toMatchObject({ name: 'send', key: send });
      await act(async () => tree.unmount());
    } finally {
      spy.mockRestore();
    }
  });

  test('a code read from home never reaches a receiver', async () => {
    const onCode = jest.fn();
    const tree = await render(
      <OnCanvas receivers={[{ onCode, active: true }]} />,
    );
    await act(async () => stage.actions.openScan());
    await detect(tree, SCANNED);
    expect(onCode).not.toHaveBeenCalled();
    expect(stage.state.scene).toMatchObject({ name: 'send', prefill: SCANNED });
    await act(async () => tree.unmount());
  });
});
