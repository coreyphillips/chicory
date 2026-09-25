import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AccessibilityActionEvent, LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { Odometer } from '../../glyphs/Odometer';
import { Vessel } from '../../glyphs/Vessel';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { ActionCircle } from '../../scenes/home/ActionCircle';
import type { Point } from '../../scenes/home/ActionCircle';
import {
  PULL_TRIGGER,
  heroPose,
  launchPose,
  pullOffset,
  vesselOpacity,
} from '../../scenes/home/motion';
import type { HeroFrame, Launch } from '../../scenes/home/motion';
import { isTestNetwork } from '../../scenes/home/visual';
import type { Panes } from '../../stage/panes/Pane';
import { usePaneActive } from '../../stage/panes/Pane';
import { space } from '../../theme';
import type { Unit } from '../../theme';

/** The pull's haptic, as the pan's worklets hand it back to JS. */
const feelPull = () => haptics.soft();

/** What the stale gate does to the action circles: they shrink to this. */
const GATED = 0.94;

/**
 * Home: the balance, the pill of what is spendable and what is on its way,
 * and the three things you do with it (REDESIGN.md 6, Wallet health). There
 * are no words on it. The balance is the hero, the vessel under it says what
 * is waiting and why, and the action row is three circles: Send, Scan and
 * Receive.
 *
 * Tapping the hero rolls it between sats and BTC, and a long press hides it;
 * a screen reader has both as actions. Pulling the pane down opens the
 * status row's mark petal by petal, through the canvas's `pull`, and letting
 * go once it is in full flower starts a refresh. An old balance gates the
 * actions, which say so and refresh when tapped rather than act.
 *
 * On the canvas `progress` carries the panes: `hero` shrinks the balance into
 * a mini strip in the status row, fading the vessel first, and `bar` fades
 * the action row, whose tapped circle grows toward the scene it opens while
 * the others shrink away. Drawn on its own it rests at home. The activity it
 * once previewed is the sheet's now; `onActivity` and `onDetail` stay for the
 * callers that still pass them.
 */
export function HomeScreen({
  snapshot,
  hidden = false,
  unit = 'sats',
  stale = false,
  onSend,
  onReceive,
  onScan,
  onToggleUnit,
  onToggleHidden,
  onRefresh,
  heroSats,
  progress,
  launching = 'none',
  arrived = 0,
}: {
  snapshot: WalletSnapshot;
  hidden?: boolean;
  unit?: Unit;
  stale?: boolean;
  onSend: () => void;
  onReceive: () => void;
  /** Opens the scan, growing from `origin`, where the circle is. */
  onScan?: (origin?: Point) => void;
  onActivity: () => void;
  onDetail: (item: Activity) => void;
  onToggleUnit?: () => void;
  onToggleHidden?: () => void;
  /** Refreshes the wallet, for the pull and for a tap on a gated action. */
  onRefresh?: () => void;
  /** What the hero shows, when not the total: Send's spendable amount. */
  heroSats?: number;
  /**
   * The canvas's panes, which move the hero and the action row, and take
   * the pull for the mark to open with.
   */
  progress?: Pick<Panes, 'hero' | 'bar'> & Partial<Pick<Panes, 'pull'>>;
  /** The scene the canvas is heading to, when one of the circles opens it. */
  launching?: Launch;
  /** A count that rises with each read that brought money in. */
  arrived?: number;
}) {
  // On the canvas, Home stays drawn while other scenes show, so its controls
  // only get their handlers while its pane is the one in use.
  const live = usePaneActive();
  const { reduced } = useMotionPrefs();
  const resting = useSharedValue(1);
  const hero = progress?.hero ?? resting;
  const bar = progress?.bar ?? resting;
  const frame = useSharedValue<HeroFrame>({ y: 0, height: 0 });
  // The pane follows the finger and springs back on its own; the canvas's
  // pull is only ever the finger, and 0 once it lets go.
  const drag = useSharedValue(0);
  const pull = progress?.pull;
  const armed = useSharedValue(false);
  const pop = useSharedValue(1);
  const gate = useSharedValue(stale ? GATED : 1);
  // Where the row's middle and the Send and Receive circles are across it,
  // so a launching circle knows how far it has to travel to the centre.
  const middle = useSharedValue(0);
  const sendAt = useSharedValue(0);
  const receiveAt = useSharedValue(0);
  const test = isTestNetwork(snapshot.wallet.network);
  const { balance } = snapshot;

  // The stale gate shrinks the circles. It is kept here rather than in each
  // circle, which is drawn anew as the gate closes, so the change is seen.
  useEffect(() => {
    const to = stale ? GATED : 1;
    gate.set(reduced ? to : withSpring(to, springs.snap));
  }, [stale, reduced, gate]);

  // Money arriving lifts the balance as it rolls to the new figure.
  useEffect(() => {
    if (!arrived || reduced) return;
    pop.set(
      withSequence(
        withTiming(1.06, { duration: durations.exit, easing: curves.enter }),
        withSpring(1, springs.reveal),
      ),
    );
  }, [arrived, reduced, pop]);

  const refresh = live ? onRefresh : undefined;
  const follow = (dy: number) => {
    'worklet';
    drag.set(Math.max(0, dy));
    pull?.set(Math.max(0, dy));
    const ready = dy >= PULL_TRIGGER;
    if (ready !== armed.get()) {
      armed.set(ready);
      if (ready) scheduleOnRN(feelPull);
    }
  };
  const pan = usePanGesture({
    enabled: !!refresh,
    // Only a pull down starts it, and a sideways swipe never does.
    activeOffsetY: 12,
    failOffsetX: [-20, 20],
    onActivate: event => {
      'worklet';
      follow(event.translationY);
    },
    onUpdate: event => {
      'worklet';
      follow(event.translationY);
    },
    onDeactivate: event => {
      'worklet';
      if (armed.get() && !event.canceled && refresh) scheduleOnRN(refresh);
      armed.set(false);
      pull?.set(0);
      drag.set(withSpring(0, springs.pane));
    },
  });

  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pullOffset(drag.get()) }],
  }));
  const heroMotion = useAnimatedStyle(() => {
    const pose = heroPose(hero.get(), frame.get());
    return {
      transform: [{ translateY: pose.translateY }, { scale: pose.scale }],
    };
  });
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.get() }],
  }));
  const vesselStyle = useAnimatedStyle(() => ({
    opacity: vesselOpacity(hero.get()),
  }));
  const barFade = useAnimatedStyle(() => ({ opacity: bar.get() }));
  // Reduce Motion keeps the circles where they are while the row fades.
  const row = { bar, gate, middle, launching: reduced ? 'none' : launching };
  const sendLaunch = useLaunchStyle(row, 'send', sendAt);
  const scanLaunch = useLaunchStyle(row, null);
  const receiveLaunch = useLaunchStyle(row, 'receive', receiveAt);

  const measureHero = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    frame.set({ y, height });
  };
  const measureRow = (event: LayoutChangeEvent) =>
    middle.set(event.nativeEvent.layout.width / 2);
  const centreOf = (at: SharedValue<number>) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    at.set(x + width / 2);
  };
  const whileLive = <T extends unknown[]>(action?: (...args: T) => void) =>
    live ? action : undefined;

  const switchUnit =
    live && onToggleUnit
      ? () => {
          haptics.tick();
          onToggleUnit();
        }
      : undefined;
  const toggleMask =
    live && onToggleHidden
      ? () => {
          haptics.tick();
          onToggleHidden();
        }
      : undefined;
  const heroActions = [
    ...(switchUnit ? [{ name: 'unit', label: copy.home.switchUnit }] : []),
    ...(toggleMask
      ? [
          {
            name: 'mask',
            label: hidden ? copy.home.showBalance : copy.home.hideBalance,
          },
        ]
      : []),
  ];
  const onHeroAction = heroActions.length
    ? (event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === 'unit') switchUnit?.();
        if (event.nativeEvent.actionName === 'mask') toggleMask?.();
      }
    : undefined;
  const label = hidden
    ? copy.home.balanceHidden
    : copy.home.totalBalance(balance.totalSats, unit);

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>
        <Reanimated.View style={[styles.stack, stackStyle]}>
          <View style={styles.middle}>
            <Reanimated.View
              testID="home-hero"
              onLayout={measureHero}
              style={[styles.hero, heroMotion]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint={copy.home.unitHint}
                accessibilityValue={
                  stale ? { text: copy.health.stale } : undefined
                }
                accessibilityActions={heroActions}
                onAccessibilityAction={onHeroAction}
                onPress={switchUnit}
                onLongPress={toggleMask}
                delayLongPress={400}
                style={styles.balance}
              >
                <Reanimated.View
                  style={popStyle}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Odometer
                    sats={heroSats ?? balance.totalSats}
                    unit={unit}
                    masked={hidden}
                    stale={stale}
                    variant="hero"
                    accessibilityLabel={label}
                  />
                </Reanimated.View>
              </Pressable>
            </Reanimated.View>
            <Reanimated.View style={[styles.vessel, vesselStyle]}>
              <Vessel
                availableSats={balance.availableSats}
                pendingSats={balance.pendingSats}
                lfbw={snapshot.wallet.lfbw}
                unit={unit}
                masked={hidden}
                stale={stale}
              />
            </Reanimated.View>
          </View>
          <Reanimated.View
            testID="home-bar"
            onLayout={measureRow}
            style={[styles.bar, barFade]}
          >
            <Reanimated.View style={sendLaunch} onLayout={centreOf(sendAt)}>
              <ActionCircle
                glyph="send"
                size={56}
                label={copy.home.send}
                hint={copy.home.sendHint}
                stale={stale}
                onAct={whileLive(onSend)}
                onRefresh={refresh}
              />
            </Reanimated.View>
            <Reanimated.View style={scanLaunch}>
              <ActionCircle
                glyph="scan"
                size={76}
                label={copy.home.scan}
                hint={copy.home.scanHint}
                primary
                test={test}
                stale={stale}
                onAct={whileLive(onScan)}
                onRefresh={refresh}
              />
            </Reanimated.View>
            <Reanimated.View
              style={receiveLaunch}
              onLayout={centreOf(receiveAt)}
            >
              <ActionCircle
                glyph="receive"
                size={56}
                label={copy.home.receive}
                hint={copy.home.receiveHint}
                stale={stale}
                onAct={whileLive(onReceive)}
                onRefresh={refresh}
              />
            </Reanimated.View>
          </Reanimated.View>
        </Reanimated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * One circle of the action row, shrunk by the stale `gate` and posed on the
 * way to `launching` (REDESIGN.md 7, T1 and T2). `own` is the scene the
 * circle opens, if any, and `at` its centre across the row, whose middle is
 * `middle`.
 */
function useLaunchStyle(
  {
    bar,
    gate,
    middle,
    launching,
  }: {
    bar: SharedValue<number>;
    gate: SharedValue<number>;
    middle: SharedValue<number>;
    launching: Launch;
  },
  own: Launch | null,
  at?: SharedValue<number>,
) {
  return useAnimatedStyle(() => {
    const toCentre = at ? middle.get() - at.get() : 0;
    const pose = launchPose(
      1 - bar.get(),
      launching === own,
      launching,
      toCentre,
    );
    return {
      transform: [
        { translateX: pose.translateX },
        { translateY: pose.translateY },
        { scale: pose.scale * gate.get() },
      ],
    };
  }, [launching, own]);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stack: {
    flex: 1,
    paddingHorizontal: space.xl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  // The balance and its vessel, centred in what the action row leaves.
  middle: { flex: 1, justifyContent: 'center', gap: space.md },
  // Scaled from its top edge, so the mini strip hangs from where it rises to.
  hero: { transformOrigin: 'top', alignItems: 'center' },
  balance: { alignItems: 'center', paddingVertical: space.xs },
  vessel: { paddingHorizontal: space.xxl },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingBottom: space.lg,
  },
});
