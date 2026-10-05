import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DemoWalletClient, EmbeddedWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import App from '../App';
import { Scanner } from '../src/components/Scanner';
import { copy } from '../src/design/copy';
import * as DeviceWallet from '../src/embedded/client';
import * as SendRegion from '../src/scenes/send/SendScene';
import { HomeScreen } from '../src/screens/Wallet';
import { SendScreen } from '../src/screens/Payments';
import { SettingsScreen } from '../src/screens/Settings';
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
import { useScanReceiver, useScanRequest } from '../src/stage/useScanReceiver';
import type { ScanRequest } from '../src/stage/useScanReceiver';
import { field, pressableLabels, press } from '../test-support/query';
import { activeScene } from '../test-support/scene';

/**
 * The scan overlay (REDESIGN.md 2.3): a layer over the whole canvas, which
 * leaves the panes drawn beneath and out of use. A code it reads from home
 * opens Send with it; a code read for the Send already open goes to that
 * Send. Either way a code only fills in a request, and nothing is paid.
 */
const SCANNED = 'lnbcrt1scanned';
/** A primary node's address, as its QR carries it. */
const NODE = `02${'a'.repeat(64)}@127.0.0.1:9735`;
/** A regtest address, the wallet the app opens being on regtest. */
const ADDRESS = 'bcrt1qpg0xyjz3p06mkjy8mju437lezq57ad90yq0hq3';

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

  /** Lets the panes report they have settled, which lifts the tap lock. */
  const settle = () => act(async () => {});
  /** The scene the canvas shows, key and all. */
  const shown = () => tree.root.findByType(Canvas).props.scene;

  /** Settings, opened from the cog, with its moves over. */
  async function inSettings() {
    await press(tree, copy.home.settings);
    await settle();
    expect(activeScene(tree)).toBe('settings');
  }

  test("from Settings, the primary node's scan opens over a Settings that stays drawn, and fills its field", async () => {
    device.updatePrimary = jest.fn();
    await inSettings();
    const settings = shown();
    await press(tree, copy.settings.primary.change);
    await press(tree, copy.settings.primary.scan);
    expect(tree.root.findByType(ScanReveal).props).toMatchObject({
      target: 'settings',
      purpose: 'primary',
    });
    // Settings is drawn beneath, as it was, and out of reach.
    expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(1);
    const reachable = pressableLabels(tree);
    for (const label of [
      copy.settings.primary.scan,
      copy.settings.primary.save,
      copy.settings.primary.cancel,
    ]) {
      expect(reachable).not.toContain(label);
    }
    // The scanner holds a code to the field's own check.
    const scan = tree.root.findByType(Scanner);
    expect(scan.props.purpose).toBe('primary');
    expect(() => scan.props.validate('not a node')).toThrow();
    expect(scan.props.validate(NODE)).toBe(NODE);
    await detect(tree, NODE);
    expect(tree.root.findAllByType(ScanReveal)).toHaveLength(0);
    expect(field(tree, copy.settings.primary.address).props.value).toBe(NODE);
    // Nothing is saved, and Settings is the same Settings.
    expect(device.updatePrimary).not.toHaveBeenCalled();
    expect(shown()).toBe(settings);
    expect(pressableLabels(tree)).toContain(copy.settings.primary.save);
  });

  test('from Settings, the address to empty the wallet to is scanned into its field', async () => {
    device.getConfig = jest
      .fn()
      .mockResolvedValue({ engineVersion: 'test', drainAvailable: true });
    device.prepareDrain = jest.fn();
    await inSettings();
    const settings = shown();
    const words = copy.settings.empty;
    await press(tree, words.link);
    await press(tree, words.scan);
    expect(tree.root.findByType(ScanReveal).props).toMatchObject({
      target: 'settings',
      purpose: 'address',
    });
    const scan = tree.root.findByType(Scanner);
    expect(scan.props.purpose).toBe('address');
    expect(() => scan.props.validate(SCANNED)).toThrow(words.addressOnly);
    expect(scan.props.validate(`bitcoin:${ADDRESS}`)).toBe(ADDRESS);
    await detect(tree, ADDRESS);
    expect(tree.root.findAllByType(ScanReveal)).toHaveLength(0);
    expect(field(tree, words.address).props.value).toBe(ADDRESS);
    expect(device.prepareDrain).not.toHaveBeenCalled();
    expect(shown()).toBe(settings);
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
    children,
  }: {
    receivers?: { onCode: (value: string) => void; active: boolean }[];
    children?: React.ReactNode;
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
          {children}
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

  test('the overlay takes the wallet’s network: slate and the flask on a test network, never on mainnet', async () => {
    const saved = snapshot;
    try {
      for (const [network, test] of [
        ['regtest', true],
        ['testnet', true],
        ['mainnet', false],
      ] as const) {
        snapshot = { ...saved, wallet: { ...saved.wallet, network } };
        const tree = await render(<OnCanvas />);
        await act(async () => stage.actions.openScan());
        expect(tree.root.findByType(ScanReveal).props.test).toBe(test);
        expect(scanner(tree)[0].props.test).toBe(test);
        const flasks = tree.root.findAll(
          node => node.props.testID === 'scan-flask',
        );
        expect(flasks.length > 0).toBe(test);
        await act(async () => tree.unmount());
      }
    } finally {
      snapshot = saved;
    }
  });

  describe('a Settings field asking for a scan', () => {
    let ask!: (request: ScanRequest) => void;
    function Asker() {
      ask = useScanRequest();
      return null;
    }
    /** The canvas in Settings, with a field of its own that asks. */
    async function onSettings() {
      const tree = await render(
        <OnCanvas>
          <Asker />
        </OnCanvas>,
      );
      await act(async () => stage.actions.openSettings());
      await act(async () => {});
      return tree;
    }
    const request = (over: Partial<ScanRequest> = {}): ScanRequest => ({
      purpose: 'address',
      validate: value => value.replace(/^bitcoin:/, ''),
      onCode: jest.fn(),
      onClose: jest.fn(),
      ...over,
    });

    test('hears the code it asked for, then the close, with the code read', async () => {
      const tree = await onSettings();
      const asked = request();
      await act(async () => ask(asked));
      expect(stage.state.overlay).toMatchObject({
        target: 'settings',
        purpose: 'address',
      });
      // The scanner holds a code to the field's check as it reads it.
      expect(
        tree.root.findByType(Scanner).props.validate(`bitcoin:${ADDRESS}`),
      ).toBe(ADDRESS);
      expect(asked.onClose).not.toHaveBeenCalled();
      await detect(tree, ADDRESS);
      expect(asked.onCode).toHaveBeenCalledWith(ADDRESS);
      expect(asked.onClose).toHaveBeenCalledWith(true);
      expect(stage.state.overlay).toBeNull();
      expect(stage.state.scene.name).toBe('settings');
      await act(async () => tree.unmount());
    });

    test('hears a close, with no code read, and fills nothing', async () => {
      const tree = await onSettings();
      const asked = request();
      await act(async () => ask(asked));
      await act(async () => {
        tree.root.findByType(ScanReveal).props.onCancel();
      });
      expect(asked.onCode).not.toHaveBeenCalled();
      expect(asked.onClose).toHaveBeenCalledWith(false);
      expect(asked.onClose).toHaveBeenCalledTimes(1);
      await act(async () => tree.unmount());
    });

    test('hears a close when the tap was refused while a pane moved', async () => {
      const tree = await render(
        <OnCanvas>
          <Asker />
        </OnCanvas>,
      );
      const asked = request();
      // Settings is still on its way in: the scan's tap is refused.
      await act(async () => {
        stage.actions.openSettings();
        ask(asked);
      });
      expect(stage.state.overlay).toBeNull();
      expect(asked.onClose).toHaveBeenCalledWith(false);
      await act(async () => tree.unmount());
    });

    test('a scan it did not ask for brings it nothing', async () => {
      const tree = await onSettings();
      const asked = request();
      await act(async () => ask(asked));
      await act(async () => {
        tree.root.findByType(ScanReveal).props.onCancel();
      });
      // Opened another way, over the same Settings: no receiver is armed.
      await act(async () => stage.actions.openScan());
      expect(stage.state.overlay).toMatchObject({ target: 'settings' });
      await detect(tree, ADDRESS);
      expect(asked.onCode).not.toHaveBeenCalled();
      expect(asked.onClose).toHaveBeenCalledTimes(1);
      expect(stage.state.overlay).toBeNull();
      expect(stage.state.scene.name).toBe('settings');
      await act(async () => tree.unmount());
    });
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
