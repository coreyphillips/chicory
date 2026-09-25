import React from 'react';
import { Dimensions, PixelRatio, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Reanimated from 'react-native-reanimated';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../src/design/copy';
import { palette } from '../src/design/palette';
import { Bloom } from '../src/glyphs/Bloom';
import { Odometer } from '../src/glyphs/Odometer';
import { ActionCircle } from '../src/scenes/home/ActionCircle';
import { BackupTile } from '../src/scenes/home/BackupTile';
import { StatusRow } from '../src/scenes/home/StatusRow';
import { stripOpacity } from '../src/scenes/home/motion';
import { ReceiveScreen, SendScreen } from '../src/screens/Payments';
import { HomeScreen } from '../src/screens/Wallet';
import { Canvas, useCanvasView } from '../src/stage/Canvas';
import {
  HOME,
  PRIMARY_CONTROL,
  SLOT_PADDING,
  heroBox,
  launchLanding,
} from '../src/stage/layout';
import { CORNER_TARGET, CornerControl } from '../src/stage/panes/CornerControl';
import { LaunchProvider } from '../src/stage/panes/Launch';
import type { Launch } from '../src/stage/panes/Launch';
import { StageProvider, useStageStore } from '../src/stage/StageContext';
import type { StageStore } from '../src/stage/StageContext';
import { snapshotOf } from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { find } from '../test-support/query';

/**
 * The canvas and Home as a device showed them (the P7 walk on the iOS
 * simulator), each held to what REDESIGN.md asks. Jest sees no frame, so
 * motion is held to its arithmetic and to what is set up as a part mounts,
 * never to a frame in between.
 */

type Transform = Record<string, number | string>[];
const flat = (node: ReactTestInstance) =>
  (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown> & {
    transform?: Transform;
  };
const transformOf = (node: ReactTestInstance, key: string) =>
  flat(node).transform?.find(step => key in step)?.[key];
/** The first host view a component draws, where its style lands. */
const host = (node: ReactTestInstance) =>
  node.findAll(inner => typeof inner.type === 'string')[0];
const byTestID = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  );

afterEach(() => jest.restoreAllMocks());

/*
 * The canvas, as the stage draws it.
 */

const client = new DemoWalletClient();
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

function OnCanvas({
  read = snapshotOf(),
  live = session,
}: {
  read?: WalletSnapshot;
  live?: React.ComponentProps<typeof Canvas>['session'];
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
          snapshot={read}
          session={live}
          stale={false}
          backup={null}
          view={view}
        />
      </StageProvider>
    </GestureHandlerRootView>
  );
}

describe('the corner control and the backup tile', () => {
  test('the corner control is a 48pt target, the least any control gets', async () => {
    const tree = await mount(<OnCanvas />);
    const cog = tree.root
      .findByType(CornerControl)
      .find(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === copy.home.settings,
      );
    expect(flat(cog)).toMatchObject({
      width: CORNER_TARGET,
      height: CORNER_TARGET,
    });
    expect(CORNER_TARGET).toBe(48);
    await act(async () => tree.unmount());
  });

  test('the shield tile is a 48pt target around its 36pt pill', async () => {
    const tree = await mount(<BackupTile running={false} onOpen={jest.fn()} />);
    const tile = find(tree, copy.health.backupPending)!;
    expect(flat(tile).minHeight).toBe(48);
    await act(async () => tree.unmount());
  });
});

/*
 * Home.
 */

function HomeAt({
  hero = 1,
  bar = 1,
  veil,
  launching = 'none',
  landing,
  unit = 'sats',
}: {
  hero?: number;
  bar?: number;
  veil?: number;
  launching?: 'none' | 'send' | 'receive';
  landing?: Launch;
  unit?: 'sats' | 'btc';
}) {
  const panes = {
    hero: Reanimated.useSharedValue(hero),
    bar: Reanimated.useSharedValue(bar),
    veil: useVeil(veil),
  };
  const home = (
    <HomeScreen
      snapshot={snapshotOf({ wallet: { network: 'mainnet' } })}
      unit={unit}
      onSend={jest.fn()}
      onReceive={jest.fn()}
      onActivity={jest.fn()}
      onDetail={jest.fn()}
      progress={panes}
      launching={launching}
    />
  );
  return (
    <GestureHandlerRootView>
      {landing ? <LaunchProvider value={landing}>{home}</LaunchProvider> : home}
    </GestureHandlerRootView>
  );
}

/** The veil's clock, when a Reduce Motion crossfade is drawn. */
function useVeil(veil?: number) {
  const clock = Reanimated.useSharedValue(veil ?? 1);
  return veil === undefined ? undefined : clock;
}

/** Home's circles, Send, Scan and Receive: the views that pose each. */
const circles = (tree: ReactTestRenderer) =>
  tree.root
    .findByType(HomeScreen)
    .findAllByType(ActionCircle)
    .map(circle => host(circle.parent!));

describe('the mini strip', () => {
  const odometers = (tree: ReactTestRenderer) =>
    tree.root.findByType(HomeScreen).findAllByType(Odometer);

  test('draws the balance again at a size of its own, its unit readable', async () => {
    const tree = await mount(<HomeAt hero={0} bar={0} />);
    const strip = odometers(tree).find(node => node.props.variant === 'line');
    expect(strip).toBeDefined();
    const [shown] = byTestID(tree, 'home-strip');
    // Placed by a move alone: never scaled, so its unit is drawn at 15pt.
    expect(flat(shown).opacity).toBe(1);
    expect(transformOf(shown, 'scale')).toBeUndefined();
    // The hero, at a third of its size, has handed over.
    let faded: ReactTestInstance | null = odometers(tree).find(
      node => node.props.variant === 'hero',
    )!;
    while (faded && flat(faded).opacity === undefined) faded = faded.parent;
    expect(faded && flat(faded).opacity).toBe(0);
    await act(async () => tree.unmount());
  });

  test('is unseen at home, and takes over only as the hero lands', async () => {
    expect(stripOpacity(1)).toBe(0);
    expect(stripOpacity(0.5)).toBe(0);
    expect(stripOpacity(0)).toBe(1);
    const tree = await mount(<HomeAt />);
    expect(flat(byTestID(tree, 'home-strip')[0]).opacity).toBe(0);
    await act(async () => tree.unmount());
  });
});

describe('the hero', () => {
  test('keeps its line box when it steps down, so nothing under it moves', async () => {
    const tree = await mount(<HomeAt />);
    const [hero] = byTestID(tree, 'home-hero');
    expect(heroBox(1, 3)).toBe(72 + 2 * HOME.heroPad);
    const box = heroBox(Dimensions.get('window').fontScale, PixelRatio.get());
    expect(flat(hero).minHeight).toBe(box);
    const balance = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        typeof node.props.onLayout === 'function' &&
        node.props.accessibilityHint === copy.home.unitHint,
    );
    const laid = (height: number) =>
      act(async () =>
        balance.props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 300, height } },
        }),
      );
    // Drawn taller than the box once, as a device drew it in sats, and then
    // stepped down for BTC: the box keeps the taller height.
    await laid(box + 6);
    await laid(box - 9);
    expect(flat(byTestID(tree, 'home-hero')[0]).minHeight).toBe(box + 6);
    await act(async () => tree.unmount());
  });
});

describe('Send and Receive open from their circle', () => {
  test('the circle lands at the bottom centre of the slot, where the control is', () => {
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    expect(launchLanding(402, 874, insets)).toEqual({
      x: 201,
      y: 874 - 34 - SLOT_PADDING.bottom - PRIMARY_CONTROL / 2,
    });
    // A side cutout narrows the canvas, not its centre.
    expect(launchLanding(844, 390, { ...insets, left: 47, right: 47 }).x).toBe(
      422,
    );
  });

  test('the tapped circle travels there and grows into the 88pt control, whole until it lands', async () => {
    // Shared values live as long as their component, as on a device.
    const made = Reanimated.useSharedValue;
    jest
      .spyOn(Reanimated, 'useSharedValue')
      .mockImplementation(init => React.useState(() => made(init))[0]);
    const REST = { x: 93, y: 384, width: 56, height: 56 };
    const measure = jest.mocked(
      (
        View.prototype as unknown as {
          measureInWindow: (
            done: (x: number, y: number, w: number, h: number) => void,
          ) => void;
        }
      ).measureInWindow,
    );
    measure.mockImplementation(done =>
      done(REST.x - REST.width / 2, REST.y - REST.height / 2, 56, 56),
    );
    function Launching({ handover }: { handover: number }) {
      const landing: Launch = {
        x: Reanimated.useSharedValue(201),
        y: Reanimated.useSharedValue(764),
        handover: Reanimated.useSharedValue(handover),
      };
      landing.handover.set(handover);
      return <HomeAt hero={0} bar={0} launching="send" landing={landing} />;
    }
    try {
      const tree = await mount(<Launching handover={0} />);
      // Laid out, each circle finds where it rests in the window.
      const slots = byTestID(tree, 'home-slot');
      await act(async () =>
        slots[0].props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 56, height: 76 } },
        }),
      );
      await act(async () => tree.update(<Launching handover={0} />));
      const [send] = circles(tree);
      expect(transformOf(send, 'translateX')).toBe(201 - REST.x);
      expect(transformOf(send, 'translateY')).toBe(764 - REST.y);
      expect((transformOf(send, 'scale') as number) * 56).toBeCloseTo(88);
      // Whole on its way and where it lands: never a fading circle mid-screen.
      expect(flat(send).opacity).toBe(1);
      await act(async () => tree.update(<Launching handover={1} />));
      expect(flat(circles(tree)[0]).opacity).toBe(0);
      await act(async () => tree.unmount());
    } finally {
      measure.mockReset();
    }
  });

  test("lands on Send's review control and Receive's Continue as each scene measures them", async () => {
    const made = Reanimated.useSharedValue;
    let launch!: Launch;
    function Launching({ children }: { children: React.ReactNode }) {
      launch = React.useState<Launch>(() => ({
        x: made(201),
        y: made(764),
        handover: made(0),
      }))[0];
      return <LaunchProvider value={launch}>{children}</LaunchProvider>;
    }
    const noop = () => {};
    const none = {} as never;
    for (const [label, scene] of [
      [
        copy.send.review,
        <SendScreen
          client={none}
          onActivity={noop}
          onRefresh={noop}
          onBusy={noop}
        />,
      ],
      [
        copy.receive.continue,
        <ReceiveScreen
          client={none}
          receivableSats={10_000}
          onActivity={noop}
          onBusy={noop}
        />,
      ],
    ] as const) {
      const tree = await mount(
        <GestureHandlerRootView>
          <Launching>{scene}</Launching>
        </GestureHandlerRootView>,
      );
      // The view that holds the control, which the scene measures. Send's
      // waits for a request, so it is drawn with no onPress yet.
      let holder: ReactTestInstance | null = tree.root.find(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === label,
      ).parent;
      while (
        holder &&
        !(
          holder.type === View &&
          holder.props.collapsable === false &&
          holder.props.onLayout
        )
      ) {
        holder = holder.parent;
      }
      expect(holder?.props.onLayout).toEqual(expect.any(Function));
      // Where a device draws it: 752 on the 874pt phone, not 764.
      jest
        .mocked(holder!.instance.measureInWindow)
        .mockImplementationOnce(
          (done: (x: number, y: number, w: number, h: number) => void) =>
            done(157, 708, 88, 88),
        );
      await act(async () => holder!.props.onLayout());
      expect(launch.x.get()).toBe(201);
      expect(launch.y.get()).toBe(752);
      await act(async () => tree.unmount());
    }
  });

  test('on the canvas the circle hands over once Send has opened, and comes back with home', async () => {
    const tree = await mount(<OnCanvas />);
    await act(async () => stage.actions.openSend());
    await act(async () => tree.update(<OnCanvas />));
    expect(flat(circles(tree)[0]).opacity).toBe(0);
    await act(async () => stage.actions.back());
    await act(async () => tree.update(<OnCanvas />));
    expect(flat(circles(tree)[0]).opacity).toBe(1);
    await act(async () => tree.unmount());
  });
});

describe('under Reduce Motion', () => {
  test('the action row is under the veil with the balance', async () => {
    const tree = await mount(<HomeAt veil={0.5} />);
    // Halfway through the veil nothing it covers is seen: the circles
    // neither linger over the scene leaving nor pop in over it.
    for (const circle of circles(tree)) expect(flat(circle).opacity).toBe(0);
    await act(async () => tree.unmount());
    const rested = await mount(<HomeAt veil={1} />);
    for (const circle of circles(rested)) expect(flat(circle).opacity).toBe(1);
    await act(async () => rested.unmount());
  });
});

describe('the mark', () => {
  test('setup pending opens the petals to .6 and breathes the centre alone', async () => {
    const pending = snapshotOf({ primary: { setup: 'pending' } });
    const tree = await mount(<OnCanvas read={pending} />);
    const mark = () => {
      const { open, breath, mode } = tree.root
        .findByType(StatusRow)
        .findByType(Bloom).props;
      return { open, breath, mode };
    };
    expect(mark()).toEqual({ open: 0.6, breath: 'center', mode: 'breathe' });
    // While the wallet is still starting, the mark ratchets, still at .6.
    await act(async () =>
      tree.update(
        <OnCanvas read={pending} live={{ ...session, connecting: true }} />,
      ),
    );
    expect(mark()).toMatchObject({ open: 0.6, mode: 'ratchet' });
    await act(async () => tree.unmount());
  });
});

describe('a gated action on a test network', () => {
  test('keeps a slate ring on the main control, so the network still shows', async () => {
    const tree = await mount(
      <ActionCircle
        glyph="scan"
        size={76}
        label="Scan"
        hint=""
        primary
        test
        stale
      />,
    );
    const circle = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === 'Scan',
    );
    expect(flat(circle).borderColor).toBe(palette.slate);
    await act(async () => tree.unmount());
  });
});
