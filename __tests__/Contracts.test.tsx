import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import { Circle, G, Path, Rect } from 'react-native-svg';
import type { Activity } from '@beignet/wallet-core';
import { Scanner } from '../src/components/Scanner';
import { Bloom } from '../src/glyphs/Bloom';
import type { BloomTone } from '../src/glyphs/Bloom';
import { CopyChip, chipText } from '../src/glyphs/CopyChip';
import { ExpiryRing } from '../src/glyphs/ExpiryRing';
import { HoldButton } from '../src/glyphs/HoldButton';
import { Odometer } from '../src/glyphs/Odometer';
import { PulseDot } from '../src/glyphs/PulseDot';
import { QrBloom, qrLayers, qrModules } from '../src/glyphs/QrBloom';
import type { QrState } from '../src/glyphs/QrBloom';
import { StatusRing } from '../src/glyphs/StatusRing';
import type { RingVisual } from '../src/glyphs/StatusRing';
import { Vessel } from '../src/glyphs/Vessel';
import { Whisper, WhisperProvider } from '../src/glyphs/Whisper';
import { palette } from '../src/design/palette';
import { DetailCard } from '../src/stage/layers/DetailCard';
import { ScanReveal } from '../src/stage/layers/ScanReveal';
import { Pane, usePaneActive } from '../src/stage/panes/Pane';
import { SceneSlot } from '../src/stage/panes/SceneSlot';
import { MASK } from '../src/theme';
import { activate, componentName, visibleText } from '../test-support/query';

/**
 * The component contracts (REDESIGN.md 10). The parallel tracks draw these
 * for real; until then each renders a still version with the same props, and
 * this suite holds each to what its signature promises.
 */
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** The first host node below `node`, where its accessibility props land. */
const host = (node: ReactTestInstance) =>
  node.findAll(inner => typeof inner.type === 'string')[0];

/** The Pressable labelled `label`, where a control's handlers are. */
const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type !== 'string' &&
      componentName(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === label,
  )[0];

const payment: Activity = {
  id: 'a',
  kind: 'sent',
  title: 'Coffee',
  description: '',
  amountSats: 4200,
  feeSats: 1,
  status: 'completed',
  timestamp: 1_700_000_000_000,
  reference: '',
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Pane', () => {
  function Probe() {
    return <Text>{usePaneActive() ? 'in use' : 'set aside'}</Text>;
  }

  test('a pane not in use is out of reach of touch and screen readers', async () => {
    const tree = await render(
      <Pane active={false}>
        <Probe />
      </Pane>,
    );
    const props = host(tree.root).props;
    expect(props.pointerEvents).toBe('none');
    expect(props.accessibilityElementsHidden).toBe(true);
    expect(props.importantForAccessibility).toBe('no-hide-descendants');
    expect(visibleText(tree)).toEqual(['set aside']);
  });

  test('a pane is only in use while every pane around it is', async () => {
    const tree = await render(
      <Pane active={false}>
        <Pane active>
          <Probe />
        </Pane>
      </Pane>,
    );
    expect(visibleText(tree)).toEqual(['set aside']);
    const outside = await render(<Probe />);
    expect(visibleText(outside)).toEqual(['in use']);
  });
});

describe('SceneSlot', () => {
  test('names its scene with a header a screen reader reaches first', async () => {
    const tree = await render(
      <SceneSlot label="Payment details">
        <Text>4,200</Text>
      </SceneSlot>,
    );
    const slot = host(tree.root.findByType(SceneSlot));
    expect(slot.props.accessibilityLabel).toBeUndefined();
    const title = host(slot.children[0] as ReactTestInstance);
    expect(title.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'header',
      accessibilityLabel: 'Payment details',
    });
    expect(title.children).toEqual([]);
    expect(visibleText(tree)).toEqual(['4,200']);
  });

  test('without a label it draws no header', async () => {
    const tree = await render(
      <SceneSlot>
        <Text>4,200</Text>
      </SceneSlot>,
    );
    expect(
      tree.root.findAll(node => node.props.accessibilityRole === 'header'),
    ).toEqual([]);
  });
});

describe('Bloom', () => {
  // Each petal is a still drawing whose group sits at the centre of its own
  // Svg, inside a view that turns, scales and fades it.
  const petals = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(G)
      .filter(group => typeof group.props.transform === 'string');
  const flat = (node: ReactTestInstance) =>
    StyleSheet.flatten(node.props.style) ?? {};
  const turned = (group: ReactTestInstance) => {
    let at = group.parent;
    while (at && !(typeof at.type === 'string' && flat(at).transform)) {
      at = at.parent;
    }
    return flat(at!);
  };

  test.each<[BloomTone, number]>([
    ['live', 96],
    ['test', 96],
    ['dormant', 96],
    ['live', 28],
  ])('draws twelve petals, %s at %ipt', async (tone, size) => {
    const tree = await render(<Bloom size={size} tone={tone} halo />);
    expect(petals(tree)).toHaveLength(12);
  });

  test('a closed bud draws its petals faint', async () => {
    const tree = await render(<Bloom size={120} open={0} />);
    for (const petal of petals(tree)) expect(turned(petal).opacity).toBe(0.25);
  });

  test('is decoration unless it is given a label', async () => {
    const plain = await render(<Bloom size={28} />);
    expect(host(plain.root).props.accessibilityElementsHidden).toBe(true);
    const named = await render(
      <Bloom size={120} accessibilityLabel="Locked" mode="breathe" />,
    );
    expect(host(named.root).props).toMatchObject({
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: 'Locked',
    });
  });
});

describe('Odometer', () => {
  test('is one element that reads the amount in sats, whatever the unit', async () => {
    const tree = await render(
      <Odometer sats={123_456} unit="btc" variant="hero" />,
    );
    const root = host(tree.root);
    expect(root.props).toMatchObject({
      accessible: true,
      accessibilityLabel: '123,456 sats',
    });
    expect(visibleText(tree).join('')).toBe('0.00123456BTC');
  });

  test('a hidden amount shows the mask and says only that it is hidden', async () => {
    const tree = await render(
      <Odometer sats={4200} unit="sats" variant="row" masked sign="-" />,
    );
    expect(visibleText(tree).join('')).toContain(MASK);
    expect(visibleText(tree).join('')).not.toContain('4,200');
    expect(host(tree.root).props.accessibilityLabel).toBe('Amount hidden');
  });

  test('a label given is the one read', async () => {
    const tree = await render(
      <Odometer
        sats={4200}
        unit="sats"
        variant="amount"
        stale
        accessibilityLabel="Total balance 4,200 sats"
      />,
    );
    expect(host(tree.root).props.accessibilityLabel).toBe(
      'Total balance 4,200 sats',
    );
  });
});

describe('Vessel', () => {
  test('reads the split of what is here and what is arriving', async () => {
    const tree = await render(
      <Vessel availableSats={250_000} pendingSats={11_500} unit="sats" />,
    );
    expect(host(tree.root).props.accessibilityLabel).toBe(
      '250,000 sats ready to send, 11,500 sats arriving',
    );
  });

  test('a hidden balance hides the split too', async () => {
    const tree = await render(
      <Vessel
        availableSats={250_000}
        pendingSats={11_500}
        lfbw={{
          enabled: true,
          lastChannelize: { action: 'failed', at: 1 },
        }}
        unit="sats"
        masked
      />,
    );
    expect(host(tree.root).props.accessibilityLabel).toBe('Balance hidden');
  });
});

describe('PulseDot', () => {
  test.each([
    ['live', 'Connected.'],
    ['reconnecting', 'Reconnecting to your wallet.'],
    ['failed', 'The last refresh did not complete.'],
  ] as const)('%s says so', async (state, label) => {
    const tree = await render(<PulseDot state={state} pingKey={1} />);
    expect(host(tree.root).props.accessibilityLabel).toBe(label);
  });

  test('hidden draws nothing', async () => {
    const tree = await render(<PulseDot state="hidden" />);
    expect(tree.toJSON()).toBeNull();
  });
});

describe('StatusRing', () => {
  const PATTERNS: RingVisual['pattern'][] = [
    'full',
    'orbit',
    'dashed',
    'split',
    'held',
    'gap',
    'expired',
  ];

  test.each([40, 96, 120] as const)(
    'draws every pattern at %ipt, as decoration',
    async size => {
      for (const pattern of PATTERNS) {
        const tree = await render(
          <StatusRing
            size={size}
            visual={{
              tone: 'sage',
              pattern,
              progress: 0.5,
              split: 0.4,
              glyph: 'receive',
              badge: 'chain',
            }}
          />,
        );
        expect(host(tree.root).props.accessibilityElementsHidden).toBe(true);
      }
    },
  );
});

describe('CopyChip', () => {
  const TXID =
    'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';

  test('copies its value, and a screen reader hears that it did', async () => {
    const said = jest.spyOn(
      AccessibilityInfo,
      Platform.OS === 'ios'
        ? 'announceForAccessibilityWithOptions'
        : 'announceForAccessibility',
    );
    const tree = await render(<CopyChip label="Transaction" value={TXID} />);
    const chip = control(tree, 'Copy transaction');
    await act(async () => chip.props.onPress());
    expect(Clipboard.setString).toHaveBeenCalledWith(TXID);
    expect(said.mock.calls[0][0]).toBe('Transaction copied');
  });

  test('shows a long value shortened in the middle, and all of it on a long press', async () => {
    expect(chipText('bc1qexample')).toBe('bc1q exam ple');
    expect(chipText(TXID)).toBe('f418 4fc5 … 831e 9e16');
    const tree = await render(<CopyChip label="Transaction" value={TXID} />);
    expect(visibleText(tree)).toEqual([chipText(TXID)]);
    await act(async () =>
      control(tree, 'Copy transaction').props.onLongPress(),
    );
    expect(visibleText(tree)).toEqual([chipText(TXID, true)]);
  });

  test('in a pane not in use it cannot be pressed', async () => {
    const tree = await render(
      <Pane active={false}>
        <CopyChip label="Address" value="bcrt1qexample" glyph="chain" />
      </Pane>,
    );
    const chip = control(tree, 'Copy address');
    expect(chip.props.onPress).toBeUndefined();
    expect(chip.props.onLongPress).toBeUndefined();
  });
});

describe('HoldButton', () => {
  const LABEL = 'Send 4,200 sats';

  test('a tap does nothing: there is no onPress to call', async () => {
    const tree = await render(
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} />,
    );
    const button = control(tree, LABEL);
    expect(button.props.onPress).toBeUndefined();
    expect(button.props.accessibilityActions).toEqual([{ name: 'activate' }]);
  });

  test('a screen reader commits with one activate action', async () => {
    const onCommit = jest.fn();
    const tree = await render(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    await act(async () =>
      control(tree, LABEL).props.onAccessibilityAction({
        nativeEvent: { actionName: 'magicTap' },
      }),
    );
    expect(onCommit).not.toHaveBeenCalled();
    await activate(tree, LABEL);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test('the hold is 700ms, and 1000ms with warnings', async () => {
    const onCommit = jest.fn();
    const plain = await render(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} />,
    );
    expect(control(plain, LABEL).props.delayLongPress).toBe(700);
    await act(async () => control(plain, LABEL).props.onLongPress());
    expect(onCommit).toHaveBeenCalledTimes(1);
    const warned = await render(
      <HoldButton accessibilityLabel={LABEL} onCommit={onCommit} warning />,
    );
    expect(control(warned, LABEL).props.delayLongPress).toBe(1000);
  });

  test('disabled, busy or in a pane not in use, nothing can commit', async () => {
    for (const element of [
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} disabled />,
      <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} busy />,
      <Pane active={false}>
        <HoldButton accessibilityLabel={LABEL} onCommit={jest.fn()} />
      </Pane>,
    ]) {
      const tree = await render(element);
      const button = control(tree, LABEL);
      expect(button.props.onAccessibilityAction).toBeUndefined();
      expect(button.props.onLongPress).toBeUndefined();
    }
  });
});

describe('ExpiryRing', () => {
  test('reports expiry once, when the time runs out', async () => {
    jest.useFakeTimers();
    const onExpired = jest.fn();
    const now = Date.now();
    const tree = await render(
      <ExpiryRing
        size={96}
        createdAt={now - 58_000}
        expiresAt={now + 2_000}
        onExpired={onExpired}
      />,
    );
    expect(onExpired).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a new deadline, such as a refreshed quote, is reported in its turn', async () => {
    jest.useFakeTimers();
    const onExpired = jest.fn();
    const ring = (expiresAt: number) => (
      <ExpiryRing size={96} expiresAt={expiresAt} onExpired={onExpired} />
    );
    const tree = await render(ring(Date.now() + 1_000));
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(ring(Date.now() + 1_000)));
    expect(onExpired).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(onExpired).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
  });

  test('turns honey from lateAt, and never later than its last 10 seconds', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    const stroke = (tree: ReactTestRenderer) =>
      tree.root.findByType(Circle).props.stroke;
    const early = await render(
      <ExpiryRing size={96} expiresAt={now + 90_000} lateAt={now + 30_000} />,
    );
    const plain = await render(
      <ExpiryRing size={96} expiresAt={now + 90_000} />,
    );
    expect(stroke(early)).toBe(palette.bloom);
    await act(async () => jest.advanceTimersByTime(31_000));
    expect(stroke(early)).toBe(palette.honey);
    expect(stroke(plain)).toBe(palette.bloom);
    // A lateAt inside the last 10 seconds still warns at 10.
    const late = await render(
      <ExpiryRing
        size={96}
        expiresAt={Date.now() + 8_000}
        lateAt={Date.now() + 6_000}
      />,
    );
    expect(stroke(late)).toBe(palette.honey);
    await act(async () => {
      for (const tree of [early, plain, late]) tree.unmount();
    });
  });

  test('runs round a frame as well as a circle, in honey near the end', async () => {
    const tree = await render(
      <ExpiryRing
        size={0}
        shape="rect"
        width={240}
        height={240}
        radius={24}
        expiresAt={Date.now() + 5_000}
      />,
    );
    expect(tree.root.findByType(Rect).props.stroke).toBe(palette.honey);
    await act(async () => tree.unmount());
  });
});

describe('QrBloom', () => {
  const VALUE = 'bitcoin:bcrt1q?amount=0.0001';
  // Every band and finder square the code is split into, as drawn paths.
  const { bands, finders } = qrLayers(qrModules(VALUE));
  const layers = [...bands.filter(Boolean), ...finders.map(({ d }) => d)];
  const modules = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(Path).filter(node => layers.includes(node.props.d));

  test.each<[QrState, boolean]>([
    ['shown', true],
    ['expired', false],
    ['paid', false],
    ['scattered', false],
  ])('%s draws a scannable code: %s', async (state, drawn) => {
    const tree = await render(
      <QrBloom
        value={VALUE}
        size={200}
        state={state}
        onPress={jest.fn()}
        accessibilityLabel="Payment request QR code"
      />,
    );
    expect(modules(tree)).toHaveLength(drawn ? layers.length : 0);
    // Only a code that can still be paid is named, or takes a press.
    const card = control(tree, 'Payment request QR code');
    if (drawn) expect(typeof card.props.onPress).toBe('function');
    else expect(card).toBeUndefined();
  });
});

describe('Whisper', () => {
  test('is transparent: it draws what it wraps, with or without a provider', async () => {
    for (const element of [
      <Whisper label="Connected.">
        <Text>1</Text>
      </Whisper>,
      <WhisperProvider>
        <Whisper label="Connected.">
          <Text>1</Text>
        </Whisper>
      </WhisperProvider>,
    ]) {
      const tree = await render(
        <GestureHandlerRootView>{element}</GestureHandlerRootView>,
      );
      expect(visibleText(tree)).toEqual(['1']);
    }
  });

  test('a long press shows the label in a pill, which then goes', async () => {
    jest.useFakeTimers();
    const tree = await render(
      <GestureHandlerRootView>
        <WhisperProvider>
          <Whisper label="Reconnecting to your wallet.">
            <Text>1</Text>
          </Whisper>
        </WhisperProvider>
      </GestureHandlerRootView>,
    );
    const gesture = tree.root.findByType(GestureDetector).props.gesture;
    await act(async () =>
      fireGestureHandler(gesture, [
        { state: State.BEGAN },
        { state: State.ACTIVE, absoluteY: 300 },
        { state: State.END },
      ]),
    );
    expect(visibleText(tree)).toEqual(['1', 'Reconnecting to your wallet.']);
    await act(async () => jest.advanceTimersByTime(2_400));
    expect(visibleText(tree)).toEqual(['1']);
  });
});

describe('the scene layers', () => {
  test('ScanReveal hands the Scanner its callbacks', async () => {
    const onDetected = jest.fn();
    const onCancel = jest.fn();
    const tree = await render(
      <ScanReveal
        origin={{ x: 180, y: 640 }}
        target="home"
        onDetected={onDetected}
        onCancel={onCancel}
      />,
    );
    const scanner = tree.root.findByType(Scanner);
    // The overlay notes a code read on its way through, for the disc's exit,
    // and hands it on in the same call.
    scanner.props.onDetected('lnbcrt1scanned');
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith('lnbcrt1scanned');
    expect(scanner.props.onCancel).toBe(onCancel);
  });

  test('DetailCard draws its content', async () => {
    const tree = await render(
      <DetailCard item={payment} from={null}>
        <Text>4,200</Text>
      </DetailCard>,
    );
    expect(visibleText(tree)).toEqual(['4,200']);
  });
});
