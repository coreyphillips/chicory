import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react';
import type { PropsWithChildren } from 'react';
import type { HostInstance } from 'react-native';
import { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { steady } from '../../motion/steady';
import { springs } from '../../motion/tokens';

/**
 * The hand-over from Home's action circle to the scene it opens (REDESIGN.md
 * 7, T1 and T2). The tapped circle travels to where the scene draws its own
 * 88pt control and grows into it, whole all the way, and fades only once it
 * has landed, under the control that has come up over it in the same place,
 * so the two read as one element and never as two circles.
 *
 * `x` and `y` are that control's centre in window points: the bottom centre
 * of the slot (`launchLanding` in stage/layout) until the scene measures its
 * own (`useLaunchLanding`). `handover` runs from 0, while the circle is on
 * its way, to 1 once the control has taken over: Home starts it as the
 * circle arrives on the control (`landedAt`), and the canvas only makes
 * sure it comes, and turns it back to 0 as the scene leaves.
 */
export interface Launch {
  x: SharedValue<number>;
  y: SharedValue<number>;
  handover: SharedValue<number>;
}

const LaunchContext = createContext<Launch | null>(null);

export const LaunchProvider = LaunchContext.Provider;

/** The canvas's hand-over, or null off the canvas. */
export function useLaunch(): Launch | null {
  return useContext(LaunchContext);
}

/**
 * For a scene's primary control: a ref and an `onLayout` for the view that
 * holds it, so the circle that opened the scene lands on it exactly rather
 * than on the slot's bottom centre, and a `style` for an animated view
 * around it that holds the control unseen until the circle has landed and
 * hands over, so the two are never drawn apart. Off the canvas the ref and
 * the layout do nothing and the style shows the control.
 */
export function useLaunchLanding() {
  const launch = useLaunch();
  const style = useAnimatedStyle(
    () => ({ opacity: launch ? launch.handover.get() : 1 }),
    [launch],
  );
  const ref = useRef<HostInstance>(null);
  const onLayout = useCallback(() => {
    if (!launch) return;
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      launch.x.set(steady(withSpring(x + width / 2, springs.pane)));
      launch.y.set(steady(withSpring(y + height / 2, springs.pane)));
    });
  }, [launch]);
  return { ref, onLayout, style };
}

/**
 * A scene an action circle opens, Send or Receive, which tells the hand-over
 * as it comes and goes: `onOpen` as it opens, before anything else of it
 * runs, and `onLeave` as it goes.
 */
export function Launched({
  onOpen,
  onLeave,
  children,
}: PropsWithChildren<{ onOpen: () => void; onLeave: () => void }>) {
  const calls = useRef({ onOpen, onLeave });
  useLayoutEffect(() => {
    calls.current = { onOpen, onLeave };
  });
  useLayoutEffect(() => {
    const { current } = calls;
    current.onOpen();
    return () => current.onLeave();
  }, []);
  return <>{children}</>;
}
