import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ComponentRef, PropsWithChildren, ReactNode } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type {
  LayoutChangeEvent,
  StyleProp,
  TextInputProps,
  TextLayoutEvent,
  ViewStyle,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Reanimated, {
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { GLYPHS, GLYPH_LENGTHS, Glyph, strokeFor } from '../../design/glyphs';
import type { GlyphName } from '../../design/glyphs';
import { haptics } from '../../design/haptics';
import { palette } from '../../design/palette';
import { useFocus } from '../../motion/focus';
import { riseIn, smooth, stagger } from '../../motion/presets';
import { curves, durations, springs } from '../../motion/tokens';
import { useMotionPrefs } from '../../motion/useMotionPrefs';
import { PANE_SETTLE_MS } from '../../stage/layout';
import { usePaneActive } from '../../stage/panes/Pane';
import { HIT_SLOP, fonts, radius, space, type } from '../../theme';
import { drawPlan } from './motion';

/**
 * The Settings language (REDESIGN.md rule 2): the one place words stay on
 * screen, drawn in roast and espresso with cream and steam text and bloom
 * accents, each row led by its glyph. Sections grow and shrink on a linear
 * transition instead of jumping, new lines rise into place, and outcomes
 * draw their glyph in, so the page moves the way the rest of the app does.
 *
 * Every control here follows the canvas rule: it takes touches only while the
 * pane it is drawn in is in use.
 *
 * Settings has no ceiling on text size (REDESIGN.md 3.3), so nothing here is
 * laid out for one size: a heading gives its accessory a line of its own
 * rather than a sliver of width, words wrap rather than run past their
 * control, a label shrinks a little rather than break a word, a row of pills
 * breaks onto more lines, and the glyphs beside the words grow with them.
 */

/** The most a glyph beside Settings' words grows with the text size. */
export const GLYPH_SCALE_MAX = 2;

/**
 * How much the glyphs beside Settings' words grow at the text size
 * `fontScale`: with the words, from their own size up to twice it, so a row's
 * glyph still reads beside a large label without crowding it out. They never
 * shrink below their own size.
 */
export const glyphScale = (fontScale: number): number =>
  Math.min(Math.max(fontScale, 1), GLYPH_SCALE_MAX);

/** `size` grown with the text size (`glyphScale`), to a whole point. */
export function useGlyphSize(size: number): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(size * glyphScale(fontScale));
}

/**
 * Props that keep a short label's words whole at any text size. It wraps
 * between its words, takes no more lines than it has words, and shrinks
 * rather than take another: iOS breaks a word wider than its line wherever
 * the line ends, so a word that no longer fits would otherwise go on
 * without its last letters.
 */
export function wholeWords(text: string) {
  return {
    numberOfLines: Math.max(1, text.trim().split(/\s+/).length),
    adjustsFontSizeToFit: true,
    minimumFontScale: 0.5,
  };
}

/** The smallest a control is drawn (REDESIGN.md 3.4). */
const TOUCH = 48;

/** A section heading's glyph disc, and how far its honey halo reaches past it. */
const DISC = 32;
const HALO_REACH = 5;

/** The column a row's glyph sits in. */
const ROW_GLYPH = 32;

/** The accent a settings surface draws in, and the soft fill behind it. */
export interface Accent {
  accent: string;
  soft: string;
}

const BLOOM: Accent = { accent: palette.bloom, soft: palette.bloomSoft };
const SLATE: Accent = { accent: palette.slate, soft: palette.slateSoft };

/**
 * Bloom, or slate in its place for a wallet on a test network (REDESIGN.md
 * 3.1, and 6, Wallet health: slate replaces bloom everywhere), so the one
 * page that keeps words never draws play money in the colour of real money.
 */
export const accentFor = (test: boolean): Accent => (test ? SLATE : BLOOM);

/**
 * Whether what is drawn here is for a test network. Outside a provider it is
 * not, as for a setup surface with no wallet yet.
 */
const TestNetwork = createContext(false);

/** Draws everything under it in the tone of `network` (`accentFor`). */
export function SettingsNetwork({
  network,
  children,
}: PropsWithChildren<{ network: string }>) {
  return (
    <TestNetwork.Provider value={testNetwork(network)}>
      {children}
    </TestNetwork.Provider>
  );
}

/** The accent for whatever is drawn here: bloom, or slate on a test network. */
export const useAccent = (): Accent => accentFor(useContext(TestNetwork));

/**
 * The copy guard's marker (REDESIGN.md rule 2). Everything under it is a
 * settings-class surface whose words may stay on screen; the guard reads the
 * rest of the tree, and throws on a tree with two.
 */
export const SETTINGS_SURFACE = 'scene-settings';

/**
 * The root of a settings-class surface: Settings itself and the new wallet
 * sheet. The setup a phase opens, first-run network and device setup or the
 * recovery phrase, is drawn in the phase's setup panel, which carries the
 * marker for it. Only one is ever drawn at a time.
 */
export function SettingsSurface({
  style,
  children,
  ...rest
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  accessibilityViewIsModal?: boolean;
}>) {
  return (
    <View testID={SETTINGS_SURFACE} style={style} {...rest}>
      {children}
    </View>
  );
}

/** Whether the app is in front, so a loop can rest while nobody sees it. */
function useForeground(): boolean {
  const [front, setFront] = useState(true);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setFront(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return front;
}

/**
 * Something is being worked on: an orbit turning once every 1400ms, which
 * stands where "Loading..." would have. It turns only while the app is in
 * front, holds still under Reduce Motion, and is decoration unless labelled.
 * It is drawn in the accent unless given a colour.
 */
export function Working({
  size = 20,
  color,
  accessibilityLabel,
}: {
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}) {
  const { accent } = useAccent();
  const { reduced } = useMotionPrefs();
  const front = useForeground();
  const turn = useSharedValue(0);
  const running = front && !reduced;
  useEffect(() => {
    if (!running) return;
    turn.set(0);
    turn.set(
      withRepeat(
        withTiming(1, { duration: durations.orbit, easing: curves.linear }),
        -1,
      ),
    );
    return () => cancelAnimation(turn);
  }, [running, turn]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 360}deg` }],
  }));
  const labelled = !!accessibilityLabel;
  return (
    <Reanimated.View
      accessible={labelled}
      accessibilityRole={labelled ? 'progressbar' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={labelled ? { busy: true } : undefined}
      accessibilityElementsHidden={!labelled}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
      style={[{ width: size, height: size }, spin]}
    >
      <Glyph name="orbit" size={size} color={color ?? accent} />
    </Reanimated.View>
  );
}

/**
 * Breathes its children's opacity while `on`, one breath every `period`, for
 * a state that must keep being noticed. It rests while the app is in the
 * background and holds still under Reduce Motion, where the colour and the
 * shape still say it.
 */
export function Breathe({
  on,
  period = durations.pulse,
  style,
  children,
}: PropsWithChildren<{
  on: boolean;
  period?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const { reduced } = useMotionPrefs();
  const front = useForeground();
  const level = useSharedValue(1);
  const running = on && front && !reduced;
  useEffect(() => {
    if (!running) {
      cancelAnimation(level);
      level.set(1);
      return;
    }
    level.set(
      withRepeat(
        withTiming(0.35, { duration: period / 2, easing: curves.sine }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(level);
  }, [running, period, level]);
  const breathing = useAnimatedStyle(() => ({ opacity: level.get() }));
  return (
    <Reanimated.View style={[style, breathing]}>{children}</Reanimated.View>
  );
}

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/**
 * One part of a drawn glyph: a stroke that draws along its length after
 * `delay`, or, for a dot, which has no length to draw, one that pops to its
 * full width on the reveal spring.
 */
function DrawnPart({
  d,
  length,
  width,
  delay,
  duration,
  pop,
  reduced,
}: {
  d: string;
  length: number;
  width: number;
  delay: number;
  duration: number;
  pop: boolean;
  reduced: boolean;
}) {
  const drawn = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    drawn.set(
      withDelay(
        delay,
        pop
          ? withSpring(1, springs.reveal)
          : withTiming(1, { duration, easing: curves.enter }),
      ),
    );
    return () => cancelAnimation(drawn);
  }, [reduced, delay, duration, pop, drawn]);
  const arriving = useAnimatedProps(() => ({
    strokeWidth: pop ? width * drawn.get() : width,
    strokeDashoffset: pop ? 0 : length * (1 - drawn.get()),
  }));
  return (
    <AnimatedPath
      d={d}
      strokeDasharray={pop ? undefined : [length, length]}
      animatedProps={arriving}
    />
  );
}

/**
 * A glyph that draws itself in once, as an outcome's check or bang does,
 * part by part as `drawPlan` sets out (REDESIGN.md 4, Animated glyphs).
 * Under Reduce Motion it is simply there.
 */
function DrawnGlyph({
  name,
  size = 20,
  color,
}: {
  name: GlyphName;
  size?: number;
  color: string;
}) {
  const { reduced } = useMotionPrefs();
  const width = strokeFor(size);
  const plan = drawPlan(name);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {GLYPHS[name].map((part, index) => (
        <DrawnPart
          key={part.id}
          d={part.d}
          length={GLYPH_LENGTHS[name][index]}
          width={width}
          delay={plan[index].delay}
          duration={plan[index].duration}
          pop={plan[index].pop}
          reduced={reduced}
        />
      ))}
    </Svg>
  );
}

/** The page's title. `focus` lands a screen reader on it (see `useFocus`). */
export function Title({
  children,
  focus = false,
}: {
  children: string;
  focus?: boolean;
}) {
  const target = useFocus(focus);
  return (
    <Text
      ref={target}
      accessibilityRole="header"
      {...wholeWords(children)}
      style={styles.title}
    >
      {children}
    </Text>
  );
}

/** A quiet line of explanation. Settings keeps only the ones that protect. */
export function Body({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

/**
 * How many steps the sections cascade in. The rest arrive with the last
 * step, so the whole page lands inside the 350ms a handover may take.
 */
const CASCADE = 2;

/** The space between a heading and its accessory when they share a line. */
const ACCESSORY_GAP = space.sm;

/**
 * The text size past which a heading starts with its accessory below it,
 * before anything is measured: the accessibility sizes, where the primary
 * node's heading and its connection no longer share a phone's line. The
 * measure then settles it either way (`accessoryBelow`); starting close to
 * where it settles keeps the card from visibly changing height as Settings
 * arrives.
 */
const BELOW_FROM_SCALE = 1.5;

/** What a heading and its accessory measure, for `accessoryBelow`. */
export interface HeadingFit {
  /** The width the heading and its accessory share. */
  room: number;
  /** The accessory's own width. */
  accessory: number;
  /** The width of each line the heading was laid out in. */
  lines: readonly number[];
}

/**
 * How much to spare before an accessory comes back up beside its heading, so
 * a line measured a fraction of a point wider beside it than alone does not
 * send it straight back down.
 */
const RETURN_SLACK = 2;

/**
 * Whether a section heading's accessory takes the line below the heading.
 * Beside the accessory, a heading that needs a second line is being
 * squeezed, so the accessory drops. Below it, the accessory comes back up
 * only once the heading's one line and the accessory fit the room together
 * with a little to spare, so the two never trade places frame after frame.
 * Until all three are measured it stays where it is.
 *
 * Yoga's own wrapping is not trusted with this: on the phone a wrapping row
 * kept the accessory beside the heading and squeezed the heading to a
 * column a letter wide.
 */
export function accessoryBelow(below: boolean, fit: HeadingFit): boolean {
  const { room, accessory, lines } = fit;
  if (room <= 0 || accessory <= 0 || lines.length === 0) return below;
  if (!below) return lines.length > 1;
  const together = lines[0] + ACCESSORY_GAP + accessory + RETURN_SLACK;
  return !(lines.length === 1 && together <= room);
}

/**
 * Where a heading's accessory goes (`accessoryBelow`), and the measures that
 * decide it: the room the two share, the accessory's width, and the lines
 * the heading takes.
 */
function useAccessoryPlace(on: boolean) {
  const { fontScale } = useWindowDimensions();
  const [below, setBelow] = useState(() => on && fontScale > BELOW_FROM_SCALE);
  const fit = useRef<HeadingFit>({ room: 0, accessory: 0, lines: [] });
  const measured = (next: Partial<HeadingFit>) => {
    fit.current = { ...fit.current, ...next };
    setBelow(at => accessoryBelow(at, fit.current));
  };
  return {
    below,
    onRoom: (event: LayoutChangeEvent) =>
      measured({ room: event.nativeEvent.layout.width }),
    onAccessory: (event: LayoutChangeEvent) =>
      measured({ accessory: event.nativeEvent.layout.width }),
    onHeading: (event: TextLayoutEvent) =>
      measured({ lines: event.nativeEvent.lines.map(line => line.width) }),
  };
}

/**
 * One group of settings: an espresso card led by its glyph and heading. It
 * rises into place `index` steps after Settings arrives, and grows or shrinks
 * smoothly when what it holds changes. `tone` honey is for a section that
 * needs doing: a honey outline, and a halo that breathes around its glyph at
 * the halo's pace. `focus` lands a screen reader on its heading.
 *
 * The card clips what it holds. It grows on a linear transition while what
 * arrives in it is laid out at once where it will end up, so a line rising
 * into a card that has not grown to it yet, such as the first recovery word,
 * would otherwise be drawn over the card below for a frame.
 *
 * The heading's accessory, such as the primary node's connection, sits at
 * the heading's right while both fit, and drops to a line of its own below
 * the heading once they do not (`accessoryBelow`), so a large text size
 * never squeezes the heading into a column a few letters wide. The glyph and
 * its disc grow with the text size (`glyphScale`).
 */
export function Section({
  glyph,
  title,
  tone = 'plain',
  accessory,
  index = 0,
  focus = false,
  children,
}: PropsWithChildren<{
  glyph?: GlyphName;
  title?: string;
  tone?: 'plain' | 'honey';
  accessory?: ReactNode;
  index?: number;
  focus?: boolean;
}>) {
  const honey = tone === 'honey';
  const heading = useFocus(focus);
  const { accent } = useAccent();
  const disc = useGlyphSize(DISC);
  const mark = useGlyphSize(18);
  const place = useAccessoryPlace(!!accessory);
  // Beside its accessory the heading wraps freely, so a squeezed heading
  // shows as a second line and the accessory drops; on its own it keeps its
  // words whole.
  const beside = !!accessory && !place.below;
  return (
    <Reanimated.View
      entering={stagger(Math.min(index, CASCADE))}
      layout={smooth()}
      style={[styles.section, honey && styles.sectionHoney]}
    >
      {title ? (
        <View style={styles.sectionHeader}>
          {glyph ? (
            <View style={[styles.sectionGlyph, { width: disc, height: disc }]}>
              {honey ? (
                <Breathe
                  on
                  period={durations.halo}
                  style={[styles.halo, { margin: -HALO_REACH }]}
                >
                  <View
                    style={[
                      styles.haloRing,
                      { borderRadius: disc / 2 + HALO_REACH },
                    ]}
                  />
                </Breathe>
              ) : null}
              <View
                style={[
                  styles.disc,
                  { width: disc, height: disc, borderRadius: disc / 2 },
                  honey && styles.discHoney,
                ]}
              >
                <Glyph
                  name={glyph}
                  size={mark}
                  color={honey ? palette.honey : accent}
                />
              </View>
            </View>
          ) : null}
          <View
            onLayout={accessory ? place.onRoom : undefined}
            style={[styles.sectionWords, place.below && styles.wordsBelow]}
          >
            <Text
              ref={heading}
              accessibilityRole="header"
              onTextLayout={accessory ? place.onHeading : undefined}
              {...(beside ? null : wholeWords(title))}
              style={[
                beside ? styles.sectionTitle : styles.sectionTitleAlone,
                honey && styles.sectionTitleHoney,
              ]}
            >
              {title}
            </Text>
            {accessory ? (
              <View onLayout={place.onAccessory} style={styles.accessory}>
                {accessory}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {children}
    </Reanimated.View>
  );
}

/** A disclosure chevron that turns a quarter when what it opens is open. */
function Chevron({ open }: { open?: boolean }) {
  const { reduced } = useMotionPrefs();
  const size = useGlyphSize(16);
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    const target = open ? 1 : 0;
    turn.set(reduced ? target : withSpring(target, springs.snap));
  }, [open, reduced, turn]);
  const turning = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 90}deg` }],
  }));
  return (
    <Reanimated.View style={turning}>
      <Glyph name="chevron" size={size} color={palette.dust} />
    </Reanimated.View>
  );
}

/**
 * A row that does something: its glyph, its label and a chevron.
 * `expanded`, when given, says the row opens something below it and whether
 * that is open now; the chevron turns to match. The label wraps between its
 * words and shrinks rather than break one (`wholeWords`), and the glyphs grow
 * with the text size.
 */
export function Row({
  glyph,
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  expanded,
}: {
  glyph?: GlyphName;
  label: string;
  onPress: () => unknown;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  expanded?: boolean;
}) {
  const live = usePaneActive();
  const size = useGlyphSize(20);
  const slot = useGlyphSize(ROW_GLYPH);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      hitSlop={HIT_SLOP}
      onPress={
        live
          ? () => {
              haptics.tick();
              return onPress();
            }
          : undefined
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {glyph ? (
        <View style={[styles.rowGlyph, { width: slot }]}>
          <Glyph name={glyph} size={size} color={palette.steam} />
        </View>
      ) : null}
      <Text {...wholeWords(label)} style={styles.rowLabel}>
        {label}
      </Text>
      <Chevron open={expanded} />
    </Pressable>
  );
}

/**
 * A setting's value, shown and selectable but not a control. Its label keeps
 * its words whole; its value, which may be data such as a server's address,
 * wraps however it must rather than shrink or be cut short.
 */
export function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text {...wholeWords(label)} style={styles.lineLabel}>
        {label}
      </Text>
      <Text selectable style={styles.lineValue}>
        {value}
      </Text>
    </View>
  );
}

/** Cream a step of blue away: the same thumb to the eye, a new value to iOS. */
const CREAM_TWIN = '#F3ECE0';

/**
 * The thumb colour for a switch's `epoch`th showing on iOS. On iOS 26 a
 * switch's own thumb colour falls back to white (react-native#53856). React
 * Native sends the colour only when it changes, so each showing alternates
 * between cream and its twin, and the switch is told again (`useShowing`).
 */
export const thumbTint = (epoch: number): string =>
  epoch % 2 === 1 ? palette.cream : CREAM_TWIN;

/**
 * When a switch is told its thumb colour again after it is first laid out,
 * in ms: once Settings has slid in, and once more after the slide's spring
 * has come to rest and a slow first paint has landed. It is also told at
 * once, and on the next frame.
 *
 * iOS 26 drops a colour a UISwitch is given before it has been drawn. The
 * device pass saw it after a cold launch: the colour sent as the switch
 * mounted, and again as the effect after mount ran, both arrived before the
 * switch was on screen, and the thumb stayed white on every showing until
 * the app had been to the background and back. A recycled switch that had
 * already been drawn kept whatever it was told, which is why every showing
 * after that return was cream. Layout is the first sign the switch is about
 * to be drawn, so the colour is sent again from there, not from mount.
 */
export const RETINT_AFTER_MS = [PANE_SETTLE_MS, 1000] as const;

/**
 * Counts the showings of a switch on iOS, so its thumb is told its colour
 * again (`thumbTint`) once the switch is on screen: it starts at one, counts
 * one as the switch is first laid out (`onShown`), one on the frame after,
 * one at each of `RETINT_AFTER_MS`, and one each time the app comes back to
 * the front. Android keeps its thumb colour, so there it stays at its first.
 */
function useShowing(): { epoch: number; onShown: () => void } {
  const [epoch, setEpoch] = useState(1);
  const shown = useRef(false);
  // Cancels for what `onShown` schedules, one list for the switch's life.
  const pending = useRef<(() => void)[]>([]);
  useEffect(() => {
    const cancels = pending.current;
    if (Platform.OS !== 'ios') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setEpoch(at => at + 1);
    });
    return () => {
      subscription.remove();
      cancels.forEach(cancel => cancel());
    };
  }, []);
  const onShown = () => {
    if (Platform.OS !== 'ios' || shown.current) return;
    shown.current = true;
    const again = () => setEpoch(at => at + 1);
    again();
    const frame = requestAnimationFrame(again);
    pending.current.push(() => cancelAnimationFrame(frame));
    for (const ms of RETINT_AFTER_MS) {
      const timer = setTimeout(again, ms);
      pending.current.push(() => clearTimeout(timer));
    }
  };
  return { epoch, onShown };
}

/**
 * An on or off setting, its switch at the right, level with its label.
 *
 * React Native gives an iOS switch `alignSelf: 'flex-start'` under any style
 * of its own, which set it against the top of its 52pt row, 12pt above its
 * label's middle. The switch sits in a box of its own that the row centres,
 * and takes `alignSelf: 'center'` itself.
 *
 * The colours are set for each platform: on both the track is the accent
 * when on and husk when off, with a cream thumb; iOS fills the off track with
 * its own grey unless given a background, so it takes husk as one, and its
 * thumb is told its colour again once it is laid out and on each return to
 * the front (`useShowing`).
 */
export function Toggle({
  label,
  accessibilityLabel,
  value,
  disabled = false,
  onValueChange,
}: {
  label: string;
  accessibilityLabel: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void | Promise<void>;
}) {
  const live = usePaneActive();
  const { accent } = useAccent();
  const { epoch, onShown } = useShowing();
  const ios = Platform.OS === 'ios';
  return (
    <View style={styles.toggle}>
      <Text {...wholeWords(label)} style={styles.toggleLabel}>
        {label}
      </Text>
      <View onLayout={onShown} style={styles.switchBox}>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel={accessibilityLabel}
          value={value}
          disabled={disabled || !live}
          trackColor={{ true: accent, false: palette.husk }}
          thumbColor={ios ? thumbTint(epoch) : palette.cream}
          ios_backgroundColor={ios ? palette.husk : undefined}
          style={styles.switch}
          onValueChange={
            live
              ? next => {
                  haptics.tick();
                  return onValueChange(next);
                }
              : undefined
          }
        />
      </View>
    </View>
  );
}

/**
 * A text field with its label above it, which is also its name for a screen
 * reader. Its edge lights in the accent while it has focus. `focus` lands a
 * screen reader on it without raising the keyboard. `mono` sets what is typed
 * in the mono face, for a value such as a node address that is shown in mono
 * once saved.
 */
export function Field({
  label,
  focus = false,
  mono = false,
  onChangeText,
  onFocus,
  onBlur,
  multiline,
  ...props
}: TextInputProps & { label: string; focus?: boolean; mono?: boolean }) {
  const live = usePaneActive();
  const { accent } = useAccent();
  const [focused, setFocused] = useState(false);
  const target = useFocus<ComponentRef<typeof TextInput>>(focus);
  return (
    <View style={styles.field}>
      <Text {...wholeWords(label)} style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        ref={target}
        accessibilityLabel={label}
        placeholderTextColor={palette.dust}
        selectionColor={accent}
        autoCorrect={false}
        multiline={multiline}
        {...props}
        onChangeText={live ? onChangeText : undefined}
        onFocus={event => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          mono && styles.inputMono,
          multiline && styles.multiline,
          focused && { borderColor: accent },
        ]}
      />
    </View>
  );
}

/**
 * The page's buttons: `primary` in the accent for the one thing a section is
 * for, `quiet` for the rest, and `danger` in radish for what cannot be undone.
 * A press dips on the snap spring; `busy` turns the glyph into an orbit.
 * `focus` lands a screen reader on it.
 */
export function Action({
  label,
  glyph,
  onPress,
  tone = 'primary',
  busy = false,
  disabled = false,
  focus = false,
  accessibilityHint,
}: {
  label: string;
  glyph?: GlyphName;
  onPress: () => unknown;
  tone?: 'primary' | 'quiet' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  focus?: boolean;
  accessibilityHint?: string;
}) {
  const live = usePaneActive();
  const { accent } = useAccent();
  const { reduced } = useMotionPrefs();
  const target = useFocus(focus);
  const size = useGlyphSize(20);
  const scale = useSharedValue(1);
  const pressing = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  const dip = (to: number) => {
    if (!reduced) scale.set(withSpring(to, springs.snap));
  };
  const inactive = disabled || busy;
  const ink =
    tone === 'primary'
      ? palette.ink
      : tone === 'danger'
      ? palette.radish
      : palette.cream;
  return (
    <Reanimated.View style={pressing}>
      <Pressable
        ref={target}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPressIn={live ? () => dip(0.97) : undefined}
        onPressOut={live ? () => dip(1) : undefined}
        onPress={
          live
            ? () => {
                haptics.tap();
                return onPress();
              }
            : undefined
        }
        style={[
          styles.action,
          tone === 'primary' && { backgroundColor: accent },
          tone === 'quiet' && styles.actionQuiet,
          tone === 'danger' && styles.actionDanger,
          inactive && styles.inactive,
        ]}
      >
        {busy ? (
          <Working size={size} color={ink} />
        ) : glyph ? (
          <Glyph name={glyph} size={size} color={ink} />
        ) : null}
        <Text
          {...wholeWords(label)}
          style={[styles.actionLabel, { color: ink }]}
        >
          {label}
        </Text>
      </Pressable>
    </Reanimated.View>
  );
}

/**
 * A lighter control, set in words: a way out, a change, a cancel. Its `bloom`
 * tone is the accent, so slate on a test network. `focus` lands a screen
 * reader on it.
 */
export function Link({
  label,
  onPress,
  glyph,
  tone = 'bloom',
  disabled = false,
  focus = false,
}: {
  label: string;
  onPress: () => unknown;
  glyph?: GlyphName;
  tone?: 'bloom' | 'steam' | 'radish';
  disabled?: boolean;
  focus?: boolean;
}) {
  const live = usePaneActive();
  const { accent } = useAccent();
  const target = useFocus(focus);
  const size = useGlyphSize(16);
  const ink =
    tone === 'radish'
      ? palette.radish
      : tone === 'steam'
      ? palette.steam
      : accent;
  return (
    <Pressable
      ref={target}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      onPress={
        live
          ? () => {
              haptics.tick();
              return onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.link,
        pressed && styles.pressed,
        disabled && styles.inactive,
      ]}
    >
      {glyph ? <Glyph name={glyph} size={size} color={ink} /> : null}
      <Text {...wholeWords(label)} style={[styles.linkLabel, { color: ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Whether `network` is one whose coins have no value. */
export const testNetwork = (network: string) => network !== 'mainnet';

/** The glyph a network's pill leads with: a flask for play money. */
export const networkGlyph = (network: string): GlyphName =>
  testNetwork(network) ? 'flask' : 'bolt';

/**
 * A choice of networks as pills. The chosen one fills with its network's
 * colour, bloom for mainnet and slate for a test network. Each leads with its
 * glyph in that colour (`networkGlyph`): a flask for a test network, so the
 * difference is a shape as well as a colour, and mainnet's bolt, so every
 * label sits on the same axis in its pill. A test network also says what it
 * is to a screen reader.
 *
 * Only one can be chosen, so they are a radio group to a screen reader, the
 * chosen one checked. The pills share a line equally while their words fit,
 * and past that each takes the width its word needs, so a large text size
 * breaks the row onto more lines, or stacks it, and never breaks a word.
 */
export function NetworkChoice<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  labelFor = option => option,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  labelFor?: (option: T) => string;
}) {
  const live = usePaneActive();
  const size = useGlyphSize(14);
  return (
    <View accessibilityRole="radiogroup" style={styles.choice}>
      {options.map(option => {
        const selected = option === value;
        const test = testNetwork(option);
        const ink = selected ? palette.ink : palette.steam;
        const tone = test ? palette.slate : palette.bloom;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={labelFor(option)}
            accessibilityHint={
              test ? copy.settings.testNetwork(option) : undefined
            }
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={
              live
                ? () => {
                    haptics.tick();
                    onChange(option);
                  }
                : undefined
            }
            style={[
              styles.chip,
              selected && (test ? styles.chipTest : styles.chipLive),
              disabled && styles.inactive,
            ]}
          >
            <Glyph
              name={networkGlyph(option)}
              size={size}
              color={selected ? palette.ink : tone}
            />
            <Text
              {...wholeWords(option)}
              style={[styles.chipLabel, { color: ink }]}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type NoteTone = 'info' | 'pending' | 'success' | 'warning' | 'error';

interface NoteLook {
  glyph: GlyphName;
  ink: string;
  fill: string;
  draw: boolean;
}

// Something in flight is drawn in the accent, so its ink and fill are the
// accent's (`noteLook`).
const NOTE: Record<Exclude<NoteTone, 'pending'>, NoteLook> = {
  info: { glyph: 'info', ink: palette.steam, fill: palette.mocha, draw: false },
  success: {
    glyph: 'check',
    ink: palette.sage,
    fill: palette.sageSoft,
    draw: true,
  },
  warning: {
    glyph: 'alert',
    ink: palette.honey,
    fill: palette.honeySoft,
    draw: false,
  },
  error: {
    glyph: 'bang',
    ink: palette.radish,
    fill: palette.radishSoft,
    draw: true,
  },
};

/** How a note of `tone` is drawn, in `accent` when it is in flight. */
export function noteLook(tone: NoteTone, { accent, soft }: Accent): NoteLook {
  if (tone === 'pending') {
    return { glyph: 'orbit', ink: accent, fill: soft, draw: false };
  }
  return NOTE[tone];
}

/**
 * A line that matters: a safety line in honey, an outcome, or an error in
 * radish. It rises into place, and an outcome's check or bang draws itself
 * in, so a result is seen arriving rather than found. An error is an alert,
 * and is read out as it arrives, since it lands away from the press that
 * caused it. `focus` lands a screen reader on it.
 */
export function Note({
  tone = 'info',
  glyph,
  focus = false,
  children,
}: {
  tone?: NoteTone;
  glyph?: GlyphName;
  focus?: boolean;
  children: string;
}) {
  const look = noteLook(tone, useAccent());
  const shape = glyph ?? look.glyph;
  const target = useFocus(focus);
  const size = useGlyphSize(18);
  const error = tone === 'error';
  useEffect(() => {
    if (error) announce(children);
  }, [error, children]);
  return (
    <Reanimated.View
      entering={riseIn(8)}
      accessibilityRole={error ? 'alert' : undefined}
      style={[styles.note, { backgroundColor: look.fill }]}
    >
      <View style={styles.noteGlyph}>
        {tone === 'pending' ? (
          <Working size={size} color={look.ink} />
        ) : look.draw && !glyph ? (
          <DrawnGlyph name={shape} size={size} color={look.ink} />
        ) : (
          <Glyph name={shape} size={size} color={look.ink} />
        )}
      </View>
      <Text ref={target} style={styles.noteText}>
        {children}
      </Text>
    </Reanimated.View>
  );
}

/** A zero-width space: somewhere a line may break that draws nothing. */
const BREAK = '\u200B';

/**
 * A node address (`pubkey@host:port`) as it is drawn: the key in mono groups
 * of four (REDESIGN.md 3.3), which a line may break between, and a place to
 * break after the `@` and before the `:port` that draws nothing. Mono text
 * breaks wherever its line runs out otherwise, which split the host
 * (`…@127` over `.0.0.1:19846`) and left a port's last digit on a line of its
 * own. Anything that is not a node address is drawn as it is.
 */
export function nodeAddressText(uri: string): string {
  const match = /^([0-9a-fA-F]{66})(?:@(.+?)(:\d+)?)?$/.exec(uri.trim());
  if (!match) return uri;
  const [, key, host, port] = match;
  const groups = key.match(/.{1,4}/g)!.join(' ');
  if (!host) return groups;
  return `${groups}@${BREAK}${host}${port ? `${BREAK}${port}` : ''}`;
}

/**
 * A value worth copying, such as a node address: shown whole in mono, with a
 * copy glyph that turns to a sage check for a moment. A screen reader hears
 * it was copied; nothing else says so. `shown` draws the value in a form
 * easier to read than the one copied, such as a node address in groups
 * (`nodeAddressText`); the copy glyph still copies `value` as it is, and the
 * drawn form is not selectable, so its spaces and invisible breaks can never
 * be copied in the value's place. A value drawn as it is stays selectable.
 */
export function CopyLine({
  label,
  value,
  shown,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  shown?: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const live = usePaneActive();
  const size = useGlyphSize(18);
  const target = useGlyphSize(TOUCH);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <View style={styles.copyLine}>
      <View style={styles.flex}>
        <Text {...wholeWords(label)} style={styles.fieldLabel}>
          {label}
        </Text>
        <Text
          selectable={shown === undefined}
          style={[styles.lineValue, styles.mono, styles.left]}
        >
          {shown ?? value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copyLabel}
        hitSlop={HIT_SLOP}
        onPress={
          live
            ? () => {
                haptics.tick();
                Clipboard.setString(value);
                announce(copiedLabel);
                setCopied(true);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 1200);
              }
            : undefined
        }
        style={({ pressed }) => [
          styles.copy,
          { width: target, height: target, borderRadius: target / 2 },
          pressed && styles.pressed,
        ]}
      >
        {copied ? (
          <DrawnGlyph name="check" size={size} color={palette.sage} />
        ) : (
          <Glyph name="copy" size={size} color={palette.steam} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  left: { textAlign: 'left' },
  pressed: { opacity: 0.6 },
  inactive: { opacity: 0.45 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },

  title: { ...type.title, color: palette.cream },
  body: { ...type.body, color: palette.steam },

  section: {
    backgroundColor: palette.espresso,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm + 2,
    overflow: 'hidden',
  },
  sectionHoney: {
    backgroundColor: palette.honeyWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.honey,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
  },
  // The disc's size grows with the text (`glyphScale`), so it is set where
  // it is drawn.
  sectionGlyph: { alignItems: 'center', justifyContent: 'center' },
  disc: {
    backgroundColor: palette.mocha,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discHoney: { backgroundColor: palette.honeySoft },
  halo: { ...StyleSheet.absoluteFill },
  haloRing: { flex: 1, borderWidth: 1.5, borderColor: palette.honey },
  // The heading and its accessory share a line while both fit, the heading
  // taking what the accessory leaves; once they do not, the accessory takes
  // the line below (`accessoryBelow`).
  sectionWords: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ACCESSORY_GAP,
  },
  wordsBelow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.xs,
  },
  sectionTitle: { ...type.label, color: palette.steam, flex: 1 },
  // Alone on its line, the heading has the whole width.
  sectionTitleAlone: {
    ...type.label,
    color: palette.steam,
    alignSelf: 'stretch',
  },
  sectionTitleHoney: { color: palette.honey },
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexShrink: 0,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
  },
  rowGlyph: { alignItems: 'center' },
  rowLabel: { ...type.body, color: palette.cream, flex: 1 },

  // A value that does not fit beside its label takes the line below.
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: space.md,
    minHeight: 32,
  },
  lineLabel: { ...type.body, color: palette.steam, flexShrink: 1 },
  lineValue: {
    ...type.body,
    color: palette.cream,
    textAlign: 'right',
    flexGrow: 1,
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 52,
  },
  toggleLabel: { ...type.body, color: palette.cream, flex: 1 },
  switchBox: { minHeight: TOUCH, justifyContent: 'center' },
  // Over React Native's own `flex-start` for an iOS switch.
  switch: { alignSelf: 'center' },

  field: { gap: space.xs },
  fieldLabel: { ...type.label, color: palette.steam },
  input: {
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    backgroundColor: palette.mocha,
    borderWidth: 1,
    borderColor: palette.husk,
    borderRadius: radius.md,
    color: palette.cream,
    fontSize: 16,
  },
  // Near the size of the address it will be shown as once saved, in the same
  // face, and large enough to edit.
  inputMono: { fontFamily: fonts.mono, fontSize: 14 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },

  action: {
    minHeight: 52,
    borderRadius: radius.round,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
  },
  actionQuiet: { backgroundColor: palette.mocha },
  actionDanger: {
    backgroundColor: palette.radishSoft,
    borderWidth: 1,
    borderColor: palette.radish,
  },
  actionLabel: {
    ...type.label,
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
    textAlign: 'center',
  },

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: TOUCH,
  },
  linkLabel: { ...type.label, flexShrink: 1, textAlign: 'center' },

  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  // At least a third of the line, less the gaps, so three share it equally
  // until a word needs more.
  chip: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: '30%',
    minHeight: TOUCH,
    paddingHorizontal: space.xs,
    borderRadius: radius.round,
    borderWidth: 1,
    borderColor: palette.husk,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  chipLive: { backgroundColor: palette.bloom, borderColor: palette.bloom },
  chipTest: { backgroundColor: palette.slate, borderColor: palette.slate },
  chipLabel: { ...type.label, flexShrink: 1, textAlign: 'center' },

  note: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  noteGlyph: { paddingTop: 1 },
  noteText: { fontSize: 14, lineHeight: 20, color: palette.cream, flex: 1 },

  copyLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  copy: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: palette.mocha,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
