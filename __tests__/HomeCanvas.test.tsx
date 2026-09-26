import React from 'react';
import { Dimensions, PixelRatio, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Reanimated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DemoWalletClient } from '@beignet/wallet-core';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../src/design/copy';
import { GLYPHS, strokeFor } from '../src/design/glyphs';
import { palette } from '../src/design/palette';
import { Bloom } from '../src/glyphs/Bloom';
import { HERO_SIZES, Odometer, unitScaleFor } from '../src/glyphs/Odometer';
import { ActionCircle } from '../src/scenes/home/ActionCircle';
import { BackupTile } from '../src/scenes/home/BackupTile';
import { HomePane } from '../src/scenes/home/HomePane';
import { StatusRow } from '../src/scenes/home/StatusRow';
import {
  LANDED_PT,
  MINI_IN_BAND,
  MINI_IN_ROW,
  figureShown,
  glyphMorph,
  glyphStroke,
  landedAt,
  launchPose,
  launchTravel,
} from '../src/scenes/home/motion';
import { isTestNetwork } from '../src/scenes/home/visual';
import { reviewOpensLive } from '../src/scenes/send/model';
import { springStep } from '../src/motion/springMath';
import { springs } from '../src/motion/tokens';
import { ReceiveScreen, SendScreen } from '../src/screens/Payments';
import { HomeScreen } from '../src/screens/Wallet';
import { Canvas, RISEN_BY, useCanvasView } from '../src/stage/Canvas';
import {
  HERO_MINI,
  HOME,
  PANE_SETTLE_MS,
  PRIMARY_CONTROL,
  SLOT_PADDING,
  heroBox,
  launchLanding,
  launchLook,
} from '../src/stage/layout';
import { rowWait } from '../src/stage/panes/usePaneMotion';
import { CORNER_TARGET, CornerControl } from '../src/stage/panes/CornerControl';
import { LaunchProvider, useLaunchLanding } from '../src/stage/panes/Launch';
import type { Launch } from '../src/stage/panes/Launch';
import { clearHeldRequests, holdRequest } from '../src/stage/heldRequests';
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
const flatStyle = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
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

/** A request the parser reads that names no amount. */
const ADDRESS = 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
/** The same request naming its amount, 4,200 sats. */
const PRICED = `${ADDRESS}?amount=0.000042`;

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
  landless,
  unit = 'sats',
}: {
  hero?: number;
  bar?: number;
  veil?: number;
  launching?: 'none' | 'send' | 'receive';
  landing?: Launch;
  landless?: boolean;
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
      landless={landless}
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
  /** The figure the hero shows, of the two it keeps in one place. */
  const seen = (tree: ReactTestRenderer) => {
    const drawn = ['home-total', 'home-spendable'].filter(
      id => flat(byTestID(tree, id)[0]).opacity !== 0,
    );
    expect(drawn).toHaveLength(1);
    return byTestID(tree, drawn[0])[0].findByType(Odometer);
  };

  test('is the hero itself, one element all the way, its unit readable', async () => {
    // The device pass (P10): a second odometer crossfaded in over the hero,
    // 8 to 12pt off it and rolling on a clock of its own, so for six frames
    // two balances showed. The total and what can be spent are both drawn
    // in the hero's one place, under its one scale, and only one is seen.
    const tree = await mount(<HomeAt hero={0} bar={0} />);
    const shown = odometers(tree);
    expect(shown).toHaveLength(2);
    for (const odometer of shown) {
      expect(odometer.props.variant).toBe('hero');
      expect(
        byTestID(tree, 'home-figures')[0].findAllByType(Odometer),
      ).toContain(odometer);
    }
    expect(seen(tree)).toBe(shown[0]);
    expect(byTestID(tree, 'home-strip')).toEqual([]);
    // Shrunk to a third, its unit is grown back to its 15pt.
    const unit = shown[0].find(
      node =>
        typeof node.type === 'string' &&
        flat(node).transformOrigin === '0% 77%',
    );
    const grown = transformOf(unit, 'scale') as number;
    expect(grown * HERO_MINI * 15).toBeCloseTo(15);
    await act(async () => tree.unmount());
    // At home it is as it is set.
    const home = await mount(<HomeAt />);
    const [hero] = odometers(home);
    const set = hero.find(
      node =>
        typeof node.type === 'string' &&
        flat(node).transformOrigin === '0% 77%',
    );
    expect(transformOf(set, 'scale')).toBe(1);
    await act(async () => home.unmount());
  });

  test('its unit holds a readable size, in step with a hero stepped down', () => {
    expect(unitScaleFor(1, 64)).toBe(1);
    expect(unitScaleFor(HERO_MINI, HERO_SIZES[0]) * HERO_MINI * 15).toBeCloseTo(
      15,
    );
    // A long BTC amount steps the hero down to 40: its unit keeps to three
    // quarters of the figures there, rather than outgrowing them.
    const smallest = HERO_SIZES[HERO_SIZES.length - 1];
    expect(unitScaleFor(HERO_MINI, smallest) * HERO_MINI * 15).toBeCloseTo(
      0.75 * smallest * HERO_MINI,
    );
  });

  test('changes in place when it shows another figure, and rolls only when money moves', async () => {
    const timings = jest.spyOn(Reanimated, 'withTiming');
    const read = snapshotOf({ wallet: { network: 'mainnet' } });
    const home = (spendable: boolean, snapshot = read) => (
      <GestureHandlerRootView>
        <HomeScreen
          snapshot={snapshot}
          spendable={spendable}
          onSend={jest.fn()}
          onReceive={jest.fn()}
          onActivity={jest.fn()}
          onDetail={jest.fn()}
        />
      </GestureHandlerRootView>
    );
    // A roll runs the odometer's value to the new figure; a swap sets it.
    const rolls = (to: number) =>
      timings.mock.calls.filter(([value]) => value === to).length;
    const tree = await mount(home(false));
    expect(seen(tree).props.sats).toBe(read.balance.totalSats);
    // Opening Send: what can be spent, in place. It never rolls down from
    // the total, which reads as money leaving.
    timings.mockClear();
    await act(async () => tree.update(home(true)));
    expect(seen(tree).props.sats).toBe(read.balance.availableSats);
    expect(rolls(read.balance.availableSats)).toBe(0);
    // Back home: the total again, in place, never rolling up.
    await act(async () => tree.update(home(false)));
    expect(seen(tree).props.sats).toBe(read.balance.totalSats);
    expect(rolls(read.balance.totalSats)).toBe(0);
    // Money that moves rolls.
    const paid = snapshotOf({
      wallet: { network: 'mainnet' },
      balance: { totalSats: read.balance.totalSats - 3_000 },
    });
    timings.mockClear();
    await act(async () => tree.update(home(false, paid)));
    expect(rolls(paid.balance.totalSats)).toBe(1);
    await act(async () => tree.unmount());
  });
});

describe('the hero', () => {
  test('changes figure under the move, never before it starts or once it has landed', () => {
    // The device pass (P12): the full hero swapped 123,963 to 122,433 a
    // frame before anything moved, reading as a drop, and coming back the
    // strip swapped to the total while Send was still drawn whole.
    const at = (hero: number, landing = MINI_IN_BAND) => ({ hero, landing });
    // T1: the frame the scene is drawn, nothing has moved yet.
    expect(figureShown(0, 1, at(1, MINI_IN_ROW), null)).toBe(0);
    expect(figureShown(0, 1, at(1, MINI_IN_ROW), at(1, MINI_IN_ROW))).toBe(0);
    // The first frame the hero shrinks, what can be spent.
    expect(figureShown(0, 1, at(0.98), at(1, MINI_IN_ROW))).toBe(1);
    // Coming back, the strip keeps what can be spent until it grows.
    expect(figureShown(1, 0, at(0, MINI_IN_BAND), at(0, MINI_IN_BAND))).toBe(1);
    expect(figureShown(1, 0, at(0.02, MINI_IN_ROW), at(0))).toBe(0);
    // From the list to Send the hero stays a strip, and moves to the band.
    expect(figureShown(0, 1, at(0, -20), at(0, MINI_IN_ROW))).toBe(1);
    // Once changed, nothing moves it back.
    expect(figureShown(1, 1, at(0.5), at(0.6))).toBe(1);
  });

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

describe('the circle becomes the control it lands on', () => {
  /** The pane spring's progress `ms` after it sets out. */
  const pane = (ms: number) => springStep(ms / 1000, springs.pane);
  /** From the Send circle's rest to the review control on the 874pt phone. */
  const DISTANCE = 752 - 384;

  test('it lands well ahead of the pane spring, and hands over only once it is on the control', () => {
    // The device pass (P10): on a fixed timer the circle faded 25 to 30pt
    // short, two circles showing. The spring alone is still points short at
    // the settle.
    expect((1 - pane(340)) * DISTANCE).toBeGreaterThan(4);
    // The circle, on launchTravel, is on the control by then, and not yet
    // at 250ms.
    expect(landedAt(pane(340), DISTANCE)).toBe(true);
    expect(landedAt(pane(250), DISTANCE)).toBe(false);
    expect(LANDED_PT).toBe(0.5);
    const pose = launchPose(pane(340), true, 'send', 0, DISTANCE);
    expect(DISTANCE - pose.translateY).toBeLessThan(LANDED_PT);
  });

  test('it sets out and lands smoothly, the same both ways', () => {
    expect(launchTravel(0)).toBe(0);
    expect(launchTravel(1)).toBe(1);
    expect(launchTravel(0.5)).toBe(0.5);
    for (const a of [0.1, 0.3, 0.7, 0.9]) {
      expect(launchTravel(1 - a)).toBeCloseTo(1 - launchTravel(a));
      expect(launchTravel(a + 0.05)).toBeGreaterThan(launchTravel(a));
    }
  });

  test('coming home, all three circles land on the row together', () => {
    // The moment Scan and Receive are within 1% of their size, `away` here.
    const away = 0.01 / (0.2 * 2.2);
    const others = launchPose(away, false, 'send');
    expect(others.scale).toBeCloseTo(0.99);
    // The Send circle was 8pt low then on the spring alone (P10 saw 10);
    // it is under a point now.
    expect(away * DISTANCE).toBeGreaterThan(8);
    expect(launchPose(away, true, 'send', 0, DISTANCE).translateY).toBeLessThan(
      1,
    );
  });

  test('the row waits for the scene to leave before it rises', () => {
    const at = (seam: 'gone' | 'home' | 'compact', bar: number) => ({
      seam,
      bar,
    });
    // From Send or Receive: the scene's content, a result's mark too, has
    // gone before the circles grow where it was drawn.
    expect(rowWait(at('gone', 0), at('home', 1))).toBe(140);
    expect(rowWait(at('compact', 0), at('home', 1))).toBe(0);
    expect(rowWait(at('home', 1), at('gone', 0))).toBe(0);
  });

  test('on the canvas, the row rises only once Send has gone, and the lock holds as long', async () => {
    const tree = await mount(<OnCanvas />);
    await act(async () => stage.actions.openSend());
    const delays = jest.spyOn(Reanimated, 'withDelay');
    const timings = jest.spyOn(Reanimated, 'withTiming');
    await act(async () => stage.actions.back());
    expect(stage.state.scene.name).toBe('home');
    expect(delays).toHaveBeenCalledWith(140, expect.anything());
    expect(
      timings.mock.calls.some(
        ([, config]) => config?.duration === PANE_SETTLE_MS + 140,
      ),
    ).toBe(true);
    await act(async () => tree.unmount());
  });

  test('it takes on the look of the control it becomes', () => {
    // Send's review, empty: its 32pt dust arrow on the 88pt control.
    const quiet = launchLook('send', { live: false, test: false });
    expect(glyphMorph(0, 24, 56, quiet.glyph)).toBe(1);
    expect(24 * glyphMorph(1, 24, 56, quiet.glyph) * (88 / 56)).toBeCloseTo(32);
    // Receive's Continue, held back, is drawn at .94: the circle grows to it.
    const held = launchLook('receive', { live: false, test: false });
    const landed = launchPose(1, true, 'receive', 0, 0, 88 * held.scale);
    expect(landed.scale * 56).toBeCloseTo(88 * 0.94);
  });

  test('its glyph keeps the weight of its line all the way, the control’s once it is the control', () => {
    // The device pass (P12): the arrow grew with the circle, 56 to 88, to
    // a 2.9pt line, and thinned to the control's as it handed over.
    for (const look of [
      launchLook('send', { live: true, test: false }),
      launchLook('receive', { live: false, test: false }),
    ]) {
      const home = strokeFor(24);
      const control = (strokeFor(look.glyph) * look.glyph * look.scale) / 24;
      for (let away = 0; away <= 1; away += 0.05) {
        // Points a grid unit is drawn at, as the glyph grows toward the
        // control's and the circle grows into it, `m` of the way there.
        const m = launchTravel(away);
        const pose = launchPose(away, true, 'send', 0, 0, 88 * look.scale);
        const drawn = glyphMorph(m, 24, 56, look.glyph) * pose.scale;
        expect(
          glyphStroke(m, control, 24, 56, look.glyph, look.scale) * drawn,
        ).toBeCloseTo(control);
        expect(
          glyphStroke(m, home, 24, 56, look.glyph, look.scale) * drawn,
        ).toBeCloseTo(home);
      }
      // Landed, it is drawn with the control's own stroke at the control's
      // own size: its twin.
      expect(
        glyphStroke(1, control, 24, 56, look.glyph, look.scale),
      ).toBeCloseTo(strokeFor(look.glyph));
    }
  });

  test('the travelling circle draws its glyph with that line, not scaled from its own', async () => {
    const look = launchLook('send', { live: true, test: false });
    function Travelling({ m }: { m: number }) {
      const toward = Reanimated.useSharedValue(m);
      return (
        <ActionCircle
          glyph="send"
          size={56}
          label="Send"
          hint=""
          stale={false}
          morph={{ look, toward }}
        />
      );
    }
    const tree = await mount(<Travelling m={1} />);
    // Not the grid's glyph scaled up with the circle, whose line swells
    // with it, but its strokes drawn with a line of their own
    // (`glyphStroke`): its own glyph and the control's over it.
    const drawings = tree.root.findAllByType(Svg);
    const send = GLYPHS.send.map(part => part.d);
    expect(
      drawings.map(svg => svg.findAllByType(Path).map(path => path.props.d)),
    ).toEqual([send, send]);
    for (const svg of drawings) expect(svg.props.strokeWidth).toBeUndefined();
    // At rest, with nowhere to go, it is the grid's glyph.
    const resting = await mount(
      <ActionCircle
        glyph="send"
        size={56}
        label="Send"
        hint=""
        stale={false}
      />,
    );
    const [still] = resting.root.findAllByType(Svg);
    expect(still.props.strokeWidth).toBe(strokeFor(24));
    await act(async () => tree.unmount());
    await act(async () => resting.unmount());
  });

  test("the look is the one Send's and Receive's controls draw", async () => {
    const noop = () => {};
    const none = {} as never;
    const drawn = async (label: string, scene: React.ReactElement) => {
      const tree = await mount(
        <GestureHandlerRootView>{scene}</GestureHandlerRootView>,
      );
      const control = tree.root.find(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === label,
      );
      const style = flat(control);
      const [glyph] = control.findAll(
        node => typeof node.type === 'string' && node.props.stroke,
      );
      const look = {
        fill: style.backgroundColor,
        ring: style.borderWidth ? style.borderColor : style.backgroundColor,
        ringWidth: style.borderWidth ?? 0,
        ink: glyph.props.stroke,
        glyph: glyph.props.width,
        scale: (transformOf(control, 'scale') as number | undefined) ?? 1,
      };
      await act(async () => tree.unmount());
      return look;
    };
    const send = (request: string) => (
      <SendScreen
        client={none}
        initialRequest={request}
        onActivity={noop}
        onRefresh={noop}
        onBusy={noop}
      />
    );
    // Live only for a request that can be paid and names its amount, since
    // the amount starts empty: the rule Home reads (`reviewOpensLive`).
    for (const request of ['', 'lnbc1', ADDRESS, PRICED]) {
      expect(await drawn(copy.send.review, send(request))).toEqual(
        launchLook('send', { live: reviewOpensLive(request), test: false }),
      );
    }
    expect([PRICED, ADDRESS, 'lnbc1', ''].map(reviewOpensLive)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    const receive = (receivableSats: number) => (
      <ReceiveScreen
        client={none}
        receivableSats={receivableSats}
        onActivity={noop}
        onBusy={noop}
      />
    );
    expect(await drawn(copy.receive.continue, receive(0))).toEqual(
      launchLook('receive', { live: false, test: false }),
    );
    expect(await drawn(copy.receive.continue, receive(10_000))).toEqual(
      launchLook('receive', { live: true, test: false }),
    );
  });

  test('the circle draws the look it becomes over its own as it goes', async () => {
    const look = launchLook('send', { live: false, test: false });
    function Becoming({ toward }: { toward: number }) {
      const value = Reanimated.useSharedValue(toward);
      return (
        <ActionCircle
          glyph="send"
          size={56}
          label="Send"
          hint=""
          stale={false}
          morph={{ look, toward: value }}
        />
      );
    }
    const at = async (toward: number) => {
      const tree = await mount(<Becoming toward={toward} />);
      // Its ring, 4pt on the control, in the circle's own points.
      const disc = tree.root.find(
        node =>
          typeof node.type === 'string' &&
          flat(node).backgroundColor === look.fill &&
          flat(node).borderWidth === (4 * 56) / 88,
      );
      const inks = tree.root
        .findAll(
          node =>
            typeof node.type === 'string' &&
            typeof node.props.stroke === 'string',
        )
        .map(node => node.props.stroke);
      const shown = { disc: flat(disc), inks };
      await act(async () => tree.unmount());
      return shown;
    };
    const home = await at(0);
    expect(home.disc.opacity).toBe(0);
    const landed = await at(1);
    expect(landed.disc.opacity).toBe(1);
    expect(landed.disc.borderColor).toBe(look.ring);
    expect(landed.inks).toEqual([palette.cream, look.ink]);
  });

  test('a scene can hold its control unseen until the circle hands over', async () => {
    const made = Reanimated.useSharedValue;
    const seen: unknown[] = [];
    function Control() {
      seen.push(flatStyle(useLaunchLanding().style).opacity);
      return null;
    }
    function Launching({ handover }: { handover: number }) {
      const launch = React.useState<Launch>(() => ({
        x: made(201),
        y: made(764),
        handover: made(handover),
      }))[0];
      return (
        <LaunchProvider value={launch}>
          <Control />
        </LaunchProvider>
      );
    }
    for (const element of [
      <Launching handover={0} />,
      <Launching handover={1} />,
      <Control />,
    ]) {
      const tree = await mount(element);
      await act(async () => tree.unmount());
    }
    // On its way, handed over, and off the canvas.
    expect(seen).toEqual([0, 1, 1]);
  });

  test("Send's review and Receive's Continue stay unseen until the circle hands over", async () => {
    const made = Reanimated.useSharedValue;
    const noop = () => {};
    const none = {} as never;
    const scenes: [string, React.ReactElement][] = [
      [
        copy.send.review,
        <SendScreen
          client={none}
          initialRequest={PRICED}
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
    ];
    function Launching({
      handover,
      children,
    }: React.PropsWithChildren<{ handover?: number }>) {
      const launch = React.useState<Launch>(() => ({
        x: made(201),
        y: made(764),
        handover: made(handover ?? 0),
      }))[0];
      return handover === undefined ? (
        <>{children}</>
      ) : (
        <LaunchProvider value={launch}>{children}</LaunchProvider>
      );
    }
    for (const [label, scene] of scenes) {
      const seen: unknown[] = [];
      for (const handover of [0, 1, undefined]) {
        const tree = await mount(
          <GestureHandlerRootView>
            <Launching handover={handover}>{scene}</Launching>
          </GestureHandlerRootView>,
        );
        const control = tree.root.find(
          node =>
            typeof node.type === 'string' &&
            node.props.accessibilityLabel === label,
        );
        // The view the scene measures holds the one that fades, so the
        // circle still lands where the control is drawn.
        const measured = tree.root.find(
          node =>
            typeof node.type === 'string' &&
            node.props.collapsable === false &&
            node.findAll(inner => inner === control).length > 0,
        );
        let at = control.parent;
        while (at && at !== measured && flat(at).opacity === undefined) {
          at = at.parent;
        }
        expect(flat(measured).opacity).toBeUndefined();
        seen.push(at && at !== measured ? flat(at).opacity : 'no fade');
        await act(async () => tree.unmount());
      }
      // On its way, handed over, and off the canvas.
      expect(seen).toEqual([0, 1, 1]);
    }
  });

  test('on the canvas, Home is told the look of the control Send lands on', async () => {
    const read = snapshotOf();
    const test = isTestNetwork(read.wallet.network);
    const tree = await mount(<OnCanvas read={read} />);
    await act(async () => stage.actions.openSend());
    await act(async () => tree.update(<OnCanvas read={read} />));
    expect(tree.root.findByType(HomeScreen).props.lands).toEqual(
      launchLook('send', { live: false, test }),
    );
    await act(async () => tree.unmount());
    // A link that brings a request naming its amount lands on a live
    // review; one without an amount, or one refused, on a review in dust.
    for (const [prefill, live] of [
      [PRICED, true],
      [ADDRESS, false],
      ['lnbc1', false],
    ] as const) {
      const linked = await mount(<OnCanvas read={read} />);
      await act(async () => stage.actions.openSend(prefill));
      await act(async () => linked.update(<OnCanvas read={read} />));
      expect(linked.root.findByType(HomeScreen).props.lands).toEqual(
        launchLook('send', { live, test }),
      );
      await act(async () => linked.unmount());
    }
  });
});

describe('coming home', () => {
  /** The pane Home is drawn in on the canvas. */
  const homePane = (tree: ReactTestRenderer) => {
    let at = tree.root.findByType(HomePane).parent;
    while (at && !(typeof at.type === 'string' && flat(at).top !== undefined)) {
      at = at.parent;
    }
    return at!;
  };

  test('the circle that opened the scene is drawn over the rising sheet until the row is back', async () => {
    // The device pass (P12): coming back from Send the sheet rose over the
    // circle where it landed, the other two came up first, and it came out
    // from behind the sheet's top edge about 170ms late.
    jest.useFakeTimers();
    try {
      const tree = await mount(<OnCanvas />);
      expect(flat(homePane(tree)).zIndex).toBeUndefined();
      for (const open of [
        () => stage.actions.openSend(),
        () => stage.actions.openReceive(),
      ]) {
        await act(async () => open());
        await act(async () => jest.advanceTimersByTime(RISEN_BY));
        // Nothing to rise over while the scene is open.
        expect(flat(homePane(tree)).zIndex).toBeUndefined();
        await act(async () => stage.actions.home());
        expect(flat(homePane(tree)).zIndex).toBe(1);
        // Once the row is back it goes under the sheet again, as the sheet's
        // drag and the list need it: as the row reports back, and by the
        // time the move's lock lets go at the latest.
        await act(async () => jest.advanceTimersByTime(RISEN_BY - 1));
        expect(flat(homePane(tree)).zIndex).toBe(1);
        await act(async () => jest.advanceTimersByTime(1));
        expect(flat(homePane(tree)).zIndex).toBeUndefined();
      }
      // Back from the list, nothing was launched: it stays under.
      await act(async () => stage.actions.openActivity());
      await act(async () => jest.advanceTimersByTime(RISEN_BY));
      await act(async () => stage.actions.home());
      expect(flat(homePane(tree)).zIndex).toBeUndefined();
      await act(async () => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a request that is held or already paid', () => {
  afterEach(() => clearHeldRequests());

  test('opens Send with no control for the circle to land on', async () => {
    // The device pass (P12): a link to a held request, and to a paid one,
    // sent the circle in the live review's look to a review the held ring
    // and the paid mark never draw, over their history glyph for 270ms.
    const read = snapshotOf();
    const opened = async (prefill: string) => {
      const tree = await mount(<OnCanvas read={read} />);
      await act(async () => stage.actions.openSend(prefill));
      await act(async () => tree.update(<OnCanvas read={read} />));
      const { lands, landless } = tree.root.findByType(HomeScreen).props;
      await act(async () => tree.unmount());
      return { lands, landless };
    };
    // A request that can be paid lands on its live review.
    expect(await opened(PRICED)).toEqual({
      lands: launchLook('send', {
        live: true,
        test: isTestNetwork(read.wallet.network),
      }),
      landless: false,
    });
    // Its payment still under way: the held ring, and nowhere to land.
    holdRequest(PRICED, { status: 'pending', calling: true });
    expect(await opened(PRICED)).toEqual({ lands: null, landless: true });
    // Paid: its mark at rest, however it is spelled, and nowhere to land.
    holdRequest(PRICED, { status: 'completed' });
    expect(await opened(PRICED.toUpperCase())).toEqual({
      lands: null,
      landless: true,
    });
  });

  test('sends no circle travelling: all three go as the two not tapped do', async () => {
    const tree = await mount(
      <HomeAt hero={0} bar={0} launching="send" landless />,
    );
    const [send, scan, receive] = circles(tree);
    for (const circle of [send, scan, receive]) {
      expect(transformOf(circle, 'translateX')).toBe(0);
      expect(transformOf(circle, 'translateY')).toBe(0);
      expect(transformOf(circle, 'scale')).toBeCloseTo(0.8);
      expect(flat(circle).opacity).toBe(0);
    }
    // Where it has somewhere to land, it travels there.
    const landing = await mount(<HomeAt hero={0} bar={0} launching="send" />);
    expect(transformOf(circles(landing)[0], 'translateY')).not.toBe(0);
    await act(async () => tree.unmount());
    await act(async () => landing.unmount());
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
