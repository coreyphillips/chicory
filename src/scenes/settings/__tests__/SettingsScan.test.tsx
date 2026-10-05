import React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Scanner } from '../../../components/Scanner';
import { copy } from '../../../design/copy';
import { forgetPendingHaptics } from '../../../design/haptics';
import { forgetSafety } from '../../../motion/speech';
import { Canvas, useCanvasView } from '../../../stage/Canvas';
import { ScanReveal } from '../../../stage/layers/ScanReveal';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import {
  ADDRESS,
  clientOf,
  onMainnet,
} from '../../../../native-tests/gallery/fakes';
import { mount } from '../../../../test-support/guard';
import { field, find, holds, press } from '../../../../test-support/query';

/**
 * Settings' scans on the canvas (REDESIGN.md 2.3 and 7, T3): a field in
 * Settings asks the stage's scan overlay for a code, as Send's well does.
 * The disc grows from the field's scan button and, with a code read,
 * collapses into the field; the overlay holds each code to the field's own
 * check; a close fills nothing; and a screen reader lands back on the field
 * or the button, never on Settings' header. Android back steps out of Empty
 * wallet's review before it closes Settings.
 */
const words = copy.settings.empty;

let stage!: StageStore;
const client = clientOf();
const snapshot = onMainnet();

function OnCanvas() {
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
      </StageProvider>
    </GestureHandlerRootView>
  );
}

/** Lets the panes settle, and a focus move waiting on them be made. */
const settle = async () => {
  await act(async () => {});
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  });
};

/** Settings, open and still, with Empty wallet's form open in it. */
async function emptying() {
  const tree = await mount(<OnCanvas />);
  await act(async () => stage.actions.openSettings());
  await settle();
  await press(tree, words.link);
  await settle();
  return tree;
}

/** The measuring view around `node`, which the scan reads it through. */
function measured(node: ReactTestInstance): ReactTestInstance {
  let around: ReactTestInstance | null = node;
  while (
    around &&
    !(around.type === View && around.props.collapsable === false)
  ) {
    around = around.parent;
  }
  return around!;
}

/** Says where the view around `node` is in the window, the next time asked. */
function at(
  node: ReactTestInstance,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  jest
    .mocked(measured(node).instance.measureInWindow)
    .mockImplementationOnce(
      (done: (x: number, y: number, w: number, h: number) => void) =>
        done(x, y, width, height),
    );
}

/** What each focus move landed on: its label, or the text it holds. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, kind]) => kind === 'focus')
    .map(([node]) => {
      const { props } = node as unknown as ReactTestInstance;
      return {
        label: props.accessibilityLabel ?? props.children,
        role: props.accessibilityRole,
      };
    });

const back = () => newestFirst(stage.responders.sceneBack).some(ask => ask());

const detect = (tree: ReactTestRenderer, value: string) =>
  act(async () => {
    tree.root.findByType(ScanReveal).props.onDetected(value);
  });

beforeEach(() => {
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(() => {
  forgetSafety();
  forgetPendingHaptics();
  jest.restoreAllMocks();
});

test("the disc grows from the field's scan button and is set to collapse into the field", async () => {
  const tree = await emptying();
  at(find(tree, words.scan)!, 24, 500, 342, 52);
  at(field(tree, words.address), 24, 300, 342, 120);
  await press(tree, words.scan);
  expect(stage.state.overlay).toEqual({
    name: 'scan',
    target: 'settings',
    purpose: 'address',
    origin: { x: 195, y: 526 },
    into: { x: 195, y: 360 },
    key: expect.any(Number),
  });
  expect(tree.root.findByType(ScanReveal).props).toMatchObject({
    target: 'settings',
    purpose: 'address',
    origin: { x: 195, y: 526 },
    into: { x: 195, y: 360 },
  });
  await act(async () => tree.unmount());
});

test('a field that cannot say where it is still scans, from the bottom centre', async () => {
  const tree = await emptying();
  await press(tree, words.scan);
  expect(stage.state.overlay).toMatchObject({
    target: 'settings',
    purpose: 'address',
    origin: null,
  });
  expect(stage.state.overlay).not.toHaveProperty('into');
  await act(async () => tree.unmount());
});

test("the overlay holds each code to the field's own check, and a code read fills the field", async () => {
  const tree = await emptying();
  const key = stage.state.scene.key;
  await press(tree, words.scan);
  const scan = tree.root.findByType(Scanner);
  expect(scan.props.purpose).toBe('address');
  expect(() => scan.props.validate(`bitcoin:${ADDRESS}?amount=0.1`)).toThrow(
    words.noAmount,
  );
  expect(() => scan.props.validate('lnbc1scanned')).toThrow(words.addressOnly);
  expect(scan.props.validate(`bitcoin:${ADDRESS}`)).toBe(ADDRESS);
  await detect(tree, ADDRESS);
  expect(stage.state.overlay).toBeNull();
  expect(stage.state.scene).toMatchObject({ name: 'settings', key });
  expect(field(tree, words.address).props.value).toBe(ADDRESS);
  // Read, not reviewed: nothing went to the engine.
  expect(find(tree, words.review)?.props.accessibilityState).toMatchObject({
    disabled: false,
  });
  await act(async () => tree.unmount());
});

test("a code read lands on the field, and a close back on the scan button, never on Settings' header", async () => {
  const tree = await emptying();
  await act(async () => {
    field(tree, words.address).props.onChangeText('typed');
  });
  await press(tree, words.scan);
  await settle();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  await act(async () => {
    tree.root.findByType(ScanReveal).props.onCancel();
  });
  await settle();
  // A close fills nothing.
  expect(field(tree, words.address).props.value).toBe('typed');
  expect(focused()).toEqual([{ label: words.scan, role: 'button' }]);
  await press(tree, words.scan);
  await settle();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  await detect(tree, ADDRESS);
  await settle();
  expect(focused()).toEqual([{ label: words.address, role: undefined }]);
  expect(focused().map(move => move.label)).not.toContain(copy.settings.title);
  await act(async () => tree.unmount());
});

test("the primary node's scan returns focus to its field too", async () => {
  const tree = await mount(<OnCanvas />);
  await act(async () => stage.actions.openSettings());
  await settle();
  await press(tree, copy.settings.primary.change);
  await press(tree, copy.settings.primary.scan);
  expect(stage.state.overlay).toMatchObject({
    target: 'settings',
    purpose: 'primary',
  });
  await settle();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  const uri = `02${'a'.repeat(64)}@127.0.0.1:9735`;
  await detect(tree, uri);
  await settle();
  expect(field(tree, copy.settings.primary.address).props.value).toBe(uri);
  expect(focused().map(move => move.label)).toEqual([
    copy.settings.primary.address,
  ]);
  await act(async () => tree.unmount());
});

test('Android back steps from the review to the form, keeping the address, before Settings closes', async () => {
  const tree = await emptying();
  await act(async () => {
    field(tree, words.address).props.onChangeText(ADDRESS);
  });
  await press(tree, words.review);
  expect(holds(tree, words.send)).toHaveLength(1);
  let took = false;
  await act(async () => {
    took = back();
  });
  expect(took).toBe(true);
  expect(holds(tree, words.send)).toHaveLength(0);
  expect(field(tree, words.address).props.value).toBe(ADDRESS);
  expect(stage.state.scene.name).toBe('settings');
  await settle();
  expect(focused().at(-1)?.label).toBe(words.address);
  // Nothing of its own is left to step back from.
  expect(back()).toBe(false);
  await act(async () => tree.unmount());
});

test('under the scan, back is the overlay’s, and the review keeps its place', async () => {
  const tree = await emptying();
  await act(async () => {
    field(tree, words.address).props.onChangeText(ADDRESS);
  });
  await press(tree, words.review);
  await act(async () => stage.actions.openScan());
  // The review's own back is out of use while the scan covers it.
  expect(back()).toBe(false);
  await act(async () => stage.dispatch({ type: 'back' }));
  expect(stage.state.overlay).toBeNull();
  expect(holds(tree, words.send)).toHaveLength(1);
  await act(async () => tree.unmount());
});
