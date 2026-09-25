import React, { useEffect, useRef, useState } from 'react';
import type { ComponentRef, PropsWithChildren, ReactNode } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
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
 */

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
 */
export function Working({
  size = 20,
  color = palette.bloom,
  accessibilityLabel,
}: {
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}) {
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
      <Glyph name="orbit" size={size} color={color} />
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
    <Text ref={target} accessibilityRole="header" style={styles.title}>
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

/**
 * One group of settings: an espresso card led by its glyph and heading. It
 * rises into place `index` steps after Settings arrives, and grows or shrinks
 * smoothly when what it holds changes. `tone` honey is for a section that
 * needs doing: a honey outline, and a halo that breathes around its glyph at
 * the halo's pace. `focus` lands a screen reader on its heading.
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
  return (
    <Reanimated.View
      entering={stagger(Math.min(index, CASCADE))}
      layout={smooth()}
      style={[styles.section, honey && styles.sectionHoney]}
    >
      {title ? (
        <View style={styles.sectionHeader}>
          {glyph ? (
            <View style={styles.sectionGlyph}>
              {honey ? (
                <Breathe on period={durations.halo} style={styles.halo}>
                  <View style={styles.haloRing} />
                </Breathe>
              ) : null}
              <View style={[styles.disc, honey && styles.discHoney]}>
                <Glyph
                  name={glyph}
                  size={18}
                  color={honey ? palette.honey : palette.bloom}
                />
              </View>
            </View>
          ) : null}
          <Text
            ref={heading}
            accessibilityRole="header"
            style={[styles.sectionTitle, honey && styles.sectionTitleHoney]}
          >
            {title}
          </Text>
          {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
        </View>
      ) : null}
      {children}
    </Reanimated.View>
  );
}

/** A disclosure chevron that turns a quarter when what it opens is open. */
function Chevron({ open }: { open?: boolean }) {
  const { reduced } = useMotionPrefs();
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
      <Glyph name="chevron" size={16} color={palette.dust} />
    </Reanimated.View>
  );
}

/**
 * A row that does something: its glyph, its label and a chevron.
 * `expanded`, when given, says the row opens something below it and whether
 * that is open now; the chevron turns to match.
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
        <View style={styles.rowGlyph}>
          <Glyph name={glyph} size={20} color={palette.steam} />
        </View>
      ) : null}
      <Text style={styles.rowLabel}>{label}</Text>
      <Chevron open={expanded} />
    </Pressable>
  );
}

/** A setting's value, shown and selectable but not a control. */
export function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text selectable style={styles.lineValue}>
        {value}
      </Text>
    </View>
  );
}

/** An on or off setting, its switch at the right. */
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
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={accessibilityLabel}
        value={value}
        disabled={disabled || !live}
        trackColor={{ true: palette.bloom, false: palette.husk }}
        thumbColor={palette.cream}
        ios_backgroundColor={palette.husk}
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
  );
}

/**
 * A text field with its label above it, which is also its name for a screen
 * reader. Its edge lights in bloom while it has focus. `focus` lands a screen
 * reader on it without raising the keyboard.
 */
export function Field({
  label,
  focus = false,
  onChangeText,
  onFocus,
  onBlur,
  multiline,
  ...props
}: TextInputProps & { label: string; focus?: boolean }) {
  const live = usePaneActive();
  const [focused, setFocused] = useState(false);
  const target = useFocus<ComponentRef<typeof TextInput>>(focus);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={target}
        accessibilityLabel={label}
        placeholderTextColor={palette.dust}
        selectionColor={palette.bloom}
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
          multiline && styles.multiline,
          focused && styles.inputFocused,
        ]}
      />
    </View>
  );
}

/**
 * The page's buttons: `primary` in bloom for the one thing a section is for,
 * `quiet` for the rest, and `danger` in radish for what cannot be undone.
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
  const { reduced } = useMotionPrefs();
  const target = useFocus(focus);
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
          tone === 'quiet' && styles.actionQuiet,
          tone === 'danger' && styles.actionDanger,
          inactive && styles.inactive,
        ]}
      >
        {busy ? (
          <Working size={20} color={ink} />
        ) : glyph ? (
          <Glyph name={glyph} size={20} color={ink} />
        ) : null}
        <Text style={[styles.actionLabel, { color: ink }]}>{label}</Text>
      </Pressable>
    </Reanimated.View>
  );
}

/**
 * A lighter control, set in words: a way out, a change, a cancel. `focus`
 * lands a screen reader on it.
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
  const target = useFocus(focus);
  const ink =
    tone === 'radish'
      ? palette.radish
      : tone === 'steam'
      ? palette.steam
      : palette.bloom;
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
      {glyph ? <Glyph name={glyph} size={16} color={ink} /> : null}
      <Text style={[styles.linkLabel, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

/** Whether `network` is one whose coins have no value. */
export const testNetwork = (network: string) => network !== 'mainnet';

/**
 * A choice of networks as pills. The chosen one fills with its network's
 * colour, bloom for mainnet and slate for a test network, which also carries
 * a flask so the difference is a shape as well as a colour, and says what a
 * test network is to a screen reader.
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
  return (
    <View style={styles.choice}>
      {options.map(option => {
        const selected = option === value;
        const test = testNetwork(option);
        const ink = selected ? palette.ink : palette.steam;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={labelFor(option)}
            accessibilityHint={
              test ? copy.settings.testNetwork(option) : undefined
            }
            accessibilityState={{ selected, disabled }}
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
            {test ? (
              <Glyph
                name="flask"
                size={14}
                color={selected ? palette.ink : palette.slate}
              />
            ) : null}
            <Text style={[styles.chipLabel, { color: ink }]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type NoteTone = 'info' | 'pending' | 'success' | 'warning' | 'error';

const NOTE: Record<
  NoteTone,
  { glyph: GlyphName; ink: string; fill: string; draw: boolean }
> = {
  info: { glyph: 'info', ink: palette.steam, fill: palette.mocha, draw: false },
  pending: {
    glyph: 'orbit',
    ink: palette.bloom,
    fill: palette.bloomSoft,
    draw: false,
  },
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
  const look = NOTE[tone];
  const shape = glyph ?? look.glyph;
  const target = useFocus(focus);
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
          <Working size={18} color={look.ink} />
        ) : look.draw && !glyph ? (
          <DrawnGlyph name={shape} size={18} color={look.ink} />
        ) : (
          <Glyph name={shape} size={18} color={look.ink} />
        )}
      </View>
      <Text ref={target} style={styles.noteText}>
        {children}
      </Text>
    </Reanimated.View>
  );
}

/**
 * A value worth copying, such as a node address: shown whole in mono and
 * selectable, with a copy glyph that turns to a sage check for a moment. A
 * screen reader hears it was copied; nothing else says so.
 */
export function CopyLine({
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const live = usePaneActive();
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
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text selectable style={[styles.lineValue, styles.mono, styles.left]}>
          {value}
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
        style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
      >
        {copied ? (
          <DrawnGlyph name="check" size={18} color={palette.sage} />
        ) : (
          <Glyph name="copy" size={18} color={palette.steam} />
        )}
      </Pressable>
    </View>
  );
}

/** The smallest a control is drawn (REDESIGN.md 3.4). */
const TOUCH = 48;

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
  sectionGlyph: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.mocha,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discHoney: { backgroundColor: palette.honeySoft },
  halo: { ...StyleSheet.absoluteFill, margin: -5 },
  haloRing: {
    flex: 1,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: palette.honey,
  },
  sectionTitle: { ...type.label, color: palette.steam, flex: 1 },
  sectionTitleHoney: { color: palette.honey },
  accessory: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
  },
  rowGlyph: { width: 32, alignItems: 'center' },
  rowLabel: { ...type.body, color: palette.cream, flex: 1 },

  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
    minHeight: 32,
  },
  lineLabel: { ...type.body, color: palette.steam },
  lineValue: {
    ...type.body,
    color: palette.cream,
    textAlign: 'right',
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
  inputFocused: { borderColor: palette.bloom },
  multiline: { minHeight: 96, textAlignVertical: 'top' },

  action: {
    minHeight: 52,
    borderRadius: radius.round,
    backgroundColor: palette.bloom,
    paddingHorizontal: space.lg,
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
  actionLabel: { ...type.label, fontSize: 15, lineHeight: 20 },

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: TOUCH,
  },
  linkLabel: { ...type.label },

  choice: { flexDirection: 'row', gap: space.xs },
  chip: {
    flex: 1,
    minHeight: TOUCH,
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
  chipLabel: { ...type.label },

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
