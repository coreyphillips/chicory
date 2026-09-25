import React from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import { fireGestureHandler } from 'react-native-gesture-handler/jest-utils';
import { Bloom } from '../../src/glyphs/Bloom';
import type { BloomEvent, BloomMode, BloomTone } from '../../src/glyphs/Bloom';
import { Odometer } from '../../src/glyphs/Odometer';
import type { OdometerVariant } from '../../src/glyphs/Odometer';
import { PulseDot } from '../../src/glyphs/PulseDot';
import type { PulseState } from '../../src/glyphs/PulseDot';
import { StatusRing } from '../../src/glyphs/StatusRing';
import { Vessel } from '../../src/glyphs/Vessel';
import { Whisper, WhisperProvider } from '../../src/glyphs/Whisper';
import { copy } from '../../src/design/copy';
import { ringVisual } from '../../src/scenes/activity/visual';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import {
  everyActivity,
  guardData,
  snapshotOf,
} from '../../test-support/fixtures';
import type { Lfbw } from '../../test-support/fixtures';

/**
 * The glyphs under the copy guard (REDESIGN.md rule 1) and the
 * accessibility check (section 9): the bloom in every mode, tone and event,
 * the odometer in every variant, the vessel for every reason money waits,
 * the connection dot, a ring for every payment in the fixtures, and the
 * whisper. Each is drawn from test-support/fixtures.ts with `guardData` as
 * its data.
 */
const wallet = snapshotOf();
const data = guardData(wallet);
const { totalSats, availableSats, pendingSats } = wallet.balance;

const still = (name: string, element: React.ReactElement): GuardedState => ({
  name,
  render: () => mount(element),
  data,
});

const MODES: BloomMode[] = ['still', 'breathe', 'chase', 'ratchet'];
const TONES: BloomTone[] = ['live', 'test', 'dormant'];
const EVENTS: BloomEvent['kind'][] = ['burst', 'wilt', 'fold', 'fall', 'shake'];

const blooms: GuardedState[] = [
  ...MODES.flatMap(mode =>
    TONES.map(tone =>
      still(
        `the bloom, ${mode} in ${tone}`,
        <Bloom size={96} mode={mode} tone={tone} />,
      ),
    ),
  ),
  still('the bloom as the mark', <Bloom size={28} />),
  still('the bloom with a pending backup', <Bloom size={28} halo />),
  still(
    'the bloom as the opening loader',
    <Bloom size={96} mode="chase" accessibilityLabel={copy.phase.opening} />,
  ),
  still('a closed bud', <Bloom size={120} open={0.08} mode="breathe" />),
  ...EVENTS.map(kind => ({
    name: `the bloom after a ${kind}`,
    render: async () => {
      const tree = await mount(<Bloom size={96} />);
      await act(async () =>
        tree.update(<Bloom size={96} event={{ kind, key: 1 }} />),
      );
      return tree;
    },
    data,
  })),
];

const VARIANTS: OdometerVariant[] = [
  'hero',
  'amount',
  'amountDetail',
  'line',
  'row',
];

const odometers: GuardedState[] = [
  ...VARIANTS.map(variant =>
    still(
      `the ${variant} odometer`,
      <Odometer sats={totalSats} unit="sats" variant={variant} />,
    ),
  ),
  still(
    'the hero in BTC',
    <Odometer sats={totalSats} unit="btc" variant="hero" />,
  ),
  still(
    'the hero stepped down for the whole supply',
    <Odometer sats={2_100_000_000_000_000} unit="btc" variant="hero" />,
  ),
  still(
    'the hero hidden',
    <Odometer sats={totalSats} unit="sats" variant="hero" masked />,
  ),
  still(
    'the hero stale',
    <Odometer sats={totalSats} unit="sats" variant="hero" stale />,
  ),
  still(
    'a received row',
    <Odometer sats={4_200} unit="sats" variant="row" sign="+" />,
  ),
  still(
    'a sent row, hidden',
    <Odometer sats={4_200} unit="sats" variant="row" sign="-" masked />,
  ),
  {
    name: 'the hero after a roll',
    render: async () => {
      const tree = await mount(
        <Odometer sats={availableSats} unit="sats" variant="hero" />,
      );
      await act(async () =>
        tree.update(<Odometer sats={totalSats} unit="sats" variant="hero" />),
      );
      return tree;
    },
    data,
  },
];

const decided = (action: string, reason?: string): Partial<Lfbw> => ({
  lastChannelize: {
    action: action as NonNullable<Lfbw['lastChannelize']>['action'],
    at: 1,
    reason,
  },
});
const spliced = (state: 'conflicted' | 'reverted'): Partial<Lfbw> => ({
  lastSplice: { state, spliceTxid: null, conflictTxid: null, at: 1 },
});
const WAITS: Array<[string, Partial<Lfbw>]> = [
  ['money on its way', {}],
  ['below the channel floor', decided('wait', 'below-floor')],
  ['moving into the channel', decided('splice-in')],
  ['waiting on fees', decided('wait', 'fee-too-high')],
  ['a failed move', decided('failed')],
  ['confirming', decided('wait', 'channel-pending')],
  ['a conflicted splice', spliced('conflicted')],
  ['a reverted splice', spliced('reverted')],
  ['unpaired funding', { unpairedFunding: { at: 1 } }],
];

const vesselOf = (lfbw: Partial<Lfbw>, over: object = {}) => {
  const snapshot = snapshotOf({ lfbw });
  return (
    <Vessel
      availableSats={snapshot.balance.availableSats}
      pendingSats={snapshot.balance.pendingSats}
      lfbw={snapshot.wallet.lfbw}
      unit="sats"
      {...over}
    />
  );
};

const vessels: GuardedState[] = [
  ...WAITS.map(([why, lfbw]) => still(`the vessel for ${why}`, vesselOf(lfbw))),
  still(
    'the vessel with everything spendable',
    <Vessel availableSats={totalSats} pendingSats={0} unit="sats" />,
  ),
  still('the vessel hidden', vesselOf({}, { masked: true })),
  still('the vessel stale', vesselOf({}, { stale: true })),
  {
    name: 'the vessel opened by a tap',
    render: async () => {
      const tree = await mount(
        <Vessel
          availableSats={availableSats}
          pendingSats={pendingSats}
          unit="btc"
        />,
      );
      const root = tree.root.findByProps({ accessible: true });
      const touch = { nativeEvent: { pageX: 0, pageY: 0 } };
      await act(async () => {
        root.props.onResponderGrant(touch);
        root.props.onResponderRelease(touch);
      });
      return tree;
    },
    data,
  },
];

const PULSES: PulseState[] = ['live', 'reconnecting', 'failed', 'hidden'];
const dots = PULSES.map(state =>
  still(`the connection ${state}`, <PulseDot state={state} pingKey={1} />),
);

const payments = everyActivity();
const rings: GuardedState[] = [
  ...Object.entries(payments).map(([name, item]) =>
    still(
      `the ring for ${name}`,
      <StatusRing size={40} visual={ringVisual(item)} />,
    ),
  ),
  ...(['sent completed', 'sent uncertain', 'sent failed'] as const).flatMap(
    name =>
      ([96, 120] as const).map(size =>
        still(
          `the ${size}pt ring for ${name}`,
          <StatusRing size={size} visual={ringVisual(payments[name])} />,
        ),
      ),
  ),
  {
    name: 'a ring that has just completed',
    render: async () => {
      const tree = await mount(
        <StatusRing size={120} visual={ringVisual(payments['sent pending'])} />,
      );
      await act(async () =>
        tree.update(
          <StatusRing
            size={120}
            visual={ringVisual(payments['sent completed'])}
          />,
        ),
      );
      return tree;
    },
    data,
  },
];

const whispered = (
  <GestureHandlerRootView>
    <WhisperProvider>
      <Whisper label={copy.health.reconnecting}>
        <PulseDot state="reconnecting" />
      </Whisper>
    </WhisperProvider>
  </GestureHandlerRootView>
);

const whispers: GuardedState[] = [
  still('a whisper waiting to be asked', whispered),
  {
    name: 'a whisper shown',
    render: async () => {
      const tree = await mount(whispered);
      const gesture = tree.root.findByType(GestureDetector).props.gesture;
      await act(async () =>
        fireGestureHandler(gesture, [
          { state: State.BEGAN },
          { state: State.ACTIVE, absoluteX: 40, absoluteY: 60 },
          { state: State.END },
        ]),
      );
      return tree;
    },
    // Rule 3: the one text a person can summon outside Settings is the
    // string a screen reader already hears, in the pill.
    data: [...data, copy.health.reconnecting],
  },
  still(
    'a whisper outside a provider',
    <Whisper label={copy.health.fresh}>
      <Text>{'4,200'}</Text>
    </Whisper>,
  ),
];

const GUARDED: GuardedState[] = [
  ...blooms,
  ...odometers,
  ...vessels,
  ...dots,
  ...rings,
  ...whispers,
];

guard('glyphs', GUARDED);
