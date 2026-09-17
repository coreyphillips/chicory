import React, { PropsWithChildren, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, fonts, HIT_SLOP, motion, radius, space, type } from '../theme';
import { haptic } from '../services/haptics';
import { motionReduced } from '../services/motion';

export type IconName =
  | 'arrowUp'
  | 'arrowDown'
  | 'wallet'
  | 'activity'
  | 'settings'
  | 'close'
  | 'chevron'
  | 'chevronDown'
  | 'check'
  | 'copy'
  | 'shield'
  | 'plus'
  | 'back'
  | 'eye'
  | 'eyeOff'
  | 'scan'
  | 'search'
  | 'lock'
  | 'link'
  | 'share'
  | 'refresh'
  | 'alert'
  | 'info'
  | 'bolt'
  | 'clock'
  | 'key';

const paths: Partial<Record<IconName, string>> = {
  arrowUp: 'M6 18 18 6M6 6h12v12',
  arrowDown: 'M18 6 6 18M6 6v12h12',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  chevronDown: 'm5 9 7 7 7-7',
  check: 'm5 12 4 4L19 6',
  copy: 'M8 8H4v12h12v-4M8 4h12v12H8z',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',
  plus: 'M12 4v16M4 12h16',
  back: 'M20 12H4m7-7-7 7 7 7',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z',
  eyeOff: 'M4 4l16 16M10.6 10.7a2 2 0 0 0 2.8 2.8M6.7 6.8C3.9 8.5 2 12 2 12s3.6 6 10 6c1.7 0 3.2-.4 4.5-1M20.9 14.4C21.6 13.3 22 12 22 12s-3.6-6-10-6c-.6 0-1.2.1-1.7.2',
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  link: 'M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 5.7 5.7l1-1',
  share: 'M12 15V3m0 0L8 7m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  alert: 'M12 4 2 20h20zM12 10v4M12 17.5v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.5',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  key: 'M15 3a6 6 0 1 0-4.5 10.4L4 20v1h4v-2h2v-2h2l1.5-1.5A6 6 0 0 0 15 3zM16.5 7.5v.01',
};

/**
 * Memoized. Its props are four primitives with no children and no callback, so
 * the comparison always settles it, and there are a few dozen of these on
 * screen at once, each one an SVG subtree that was being rebuilt whenever any
 * ancestor rendered.
 */
export const Icon = React.memo(function IconSvg({
  name,
  size = 24,
  color = colors.text,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'wallet' ? (
        <>
          <Rect x="3" y="5" width="18" height="15" rx="3" />
          <Path d="M3 9h18m-6 5h6" />
          <Circle cx="16" cy="14" r=".5" />
        </>
      ) : name === 'settings' ? (
        <>
          <Path d="M4 6h16M4 12h16M4 18h16" />
          <Circle cx="9" cy="6" r="2" fill={colors.background} />
          <Circle cx="16" cy="12" r="2" fill={colors.background} />
          <Circle cx="8" cy="18" r="2" fill={colors.background} />
        </>
      ) : name === 'eye' ? (
        <>
          <Path d={paths.eye} />
          <Circle cx="12" cy="12" r="2.6" />
        </>
      ) : (
        <Path d={paths[name]} />
      )}
    </Svg>
  );
});
Icon.displayName = 'Icon';

/** A press that dips slightly and settles, instead of a hard opacity step. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => {
    if (motionReduced()) return;
    Animated.timing(scale, {
      toValue: value,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  return {
    scale,
    onPressIn: () => to(0.97),
    onPressOut: () => to(1),
  };
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  disabled,
  busy,
  secondary,
  variant,
  icon,
  iconRight,
  accessibilityLabel,
  accessibilityHint,
  haptics = 'medium',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Retained shorthand for `variant="secondary"`. */
  secondary?: boolean;
  variant?: ButtonVariant;
  icon?: IconName;
  iconRight?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  haptics?: 'selection' | 'light' | 'medium' | 'success' | false;
  style?: StyleProp<ViewStyle>;
}) {
  const kind: ButtonVariant = variant ?? (secondary ? 'secondary' : 'primary');
  const press = usePressScale();
  const inactive = disabled || busy;
  const ink =
    kind === 'primary'
      ? colors.ink
      : kind === 'danger'
      ? colors.danger
      : colors.text;
  const glyph = (
    <>
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : icon ? (
        <Icon name={icon} color={ink} size={20} />
      ) : null}
    </>
  );
  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!inactive, busy: !!busy }}
        disabled={inactive}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          if (haptics) haptic(haptics);
          onPress();
        }}
        style={[
          styles.button,
          kind === 'secondary' && styles.secondaryButton,
          kind === 'ghost' && styles.ghostButton,
          kind === 'danger' && styles.dangerButton,
          inactive && styles.disabled,
        ]}
      >
        {iconRight ? null : glyph}
        <Text
          style={[
            styles.buttonLabel,
            kind !== 'primary' && styles.secondaryLabel,
            kind === 'danger' && styles.dangerLabel,
          ]}
        >
          {label}
        </Text>
        {iconRight ? glyph : null}
      </Pressable>
    </Animated.View>
  );
}

/** A square, icon-only control. Always carries its own label for screen readers. */
export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  size = 20,
  tone = 'default',
  disabled,
}: {
  name: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  size?: number;
  tone?: 'default' | 'primary' | 'plain';
  disabled?: boolean;
}) {
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        hitSlop={HIT_SLOP}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          haptic('selection');
          onPress();
        }}
        style={[
          styles.iconButton,
          tone === 'plain' && styles.iconButtonPlain,
          disabled && styles.disabled,
        ]}
      >
        <Icon
          name={name}
          size={size}
          color={tone === 'primary' ? colors.primary : colors.text}
        />
      </Pressable>
    </Animated.View>
  );
}

export function Field({
  label,
  hint,
  error,
  right,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.faint}
          selectionColor={colors.primary}
          autoCorrect={false}
          style={[
            styles.field,
            props.multiline && styles.multiline,
            !!error && styles.fieldError,
            !!right && styles.fieldWithAction,
          ]}
          {...props}
        />
        {right ? <View style={styles.fieldAction}>{right}</View> : null}
      </View>
      {error ? (
        <Text style={styles.fieldErrorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  style,
  tone = 'surface',
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  tone?: 'surface' | 'raised' | 'outline';
}>) {
  return (
    <View
      style={[
        styles.card,
        tone === 'raised' && styles.cardRaised,
        tone === 'outline' && styles.cardOutline,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}
export function Title({ children }: PropsWithChildren) {
  return <Text style={styles.title}>{children}</Text>;
}
export function Heading({ children }: PropsWithChildren) {
  return <Text style={styles.heading}>{children}</Text>;
}
export function Body({
  children,
  muted = true,
  style,
}: PropsWithChildren<{ muted?: boolean; style?: StyleProp<TextStyle> }>) {
  return (
    <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>
  );
}

export function Row({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueGroup}>
        <Text selectable style={[styles.rowValue, mono && styles.mono]}>
          {value}
        </Text>
        {action}
      </View>
    </View>
  );
}

export function Notice({
  children,
  kind = 'info',
  icon,
}: PropsWithChildren<{
  kind?: 'info' | 'error' | 'success' | 'warning';
  icon?: IconName;
}>) {
  const tint =
    kind === 'error'
      ? colors.danger
      : kind === 'success'
      ? colors.mint
      : kind === 'warning'
      ? colors.warning
      : colors.muted;
  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={kind === 'error' ? 'polite' : 'none'}
      style={[
        styles.notice,
        kind === 'error' && styles.errorNotice,
        kind === 'success' && styles.successNotice,
        kind === 'warning' && styles.warningNotice,
      ]}
    >
      {icon ? (
        <View style={styles.noticeIcon}>
          <Icon name={icon} size={17} color={tint} />
        </View>
      ) : null}
      <Text
        style={[
          styles.noticeText,
          kind === 'error' && styles.errorText,
          !!icon && styles.noticeTextWithIcon,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function LinkButton({
  label,
  onPress,
  disabled = false,
  tone = 'primary',
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'muted';
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      disabled={disabled}
      accessibilityState={{ disabled }}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
    >
      <Text
        style={[
          styles.linkText,
          tone === 'muted' && styles.linkTextMuted,
          disabled && styles.disabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Filter and option pills. `Segmented` lays a set of them out in a row. */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.segmented}>
      {options.map(option => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityLabel={option}
          accessibilityState={{ selected: option === value, disabled: !!disabled }}
          disabled={disabled}
          onPress={() => {
            haptic('selection');
            onChange(option);
          }}
          style={[
            styles.segment,
            option === value && styles.segmentSelected,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              option === value && styles.segmentTextSelected,
            ]}
          >
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StatusDot({
  tone = 'good',
}: {
  tone?: 'good' | 'wait' | 'bad';
}) {
  return (
    <View
      style={[
        styles.dot,
        tone === 'wait' && styles.dotWait,
        tone === 'bad' && styles.dotBad,
      ]}
    />
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A settings-style row: label, optional value, chevron, whole row tappable. */
export function ListRow({
  label,
  value,
  icon,
  onPress,
  destructive,
  accessibilityLabel,
  accessibilityHint,
  disabled,
}: {
  label: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  destructive?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
}) {
  const content = (
    <>
      {icon ? (
        <View style={styles.listIcon}>
          <Icon
            name={icon}
            size={18}
            color={destructive ? colors.danger : colors.muted}
          />
        </View>
      ) : null}
      <Text
        style={[styles.listLabel, destructive && styles.listLabelDestructive]}
      >
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={styles.listValue}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Icon name="chevron" size={16} color={colors.faint} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (value ? `${label}, ${value}` : label)
      }
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        styles.listRow,
        pressed && styles.listRowPressed,
        disabled && styles.disabled,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** A shimmering placeholder, so a first load has shape instead of a spinner. */
export function Skeleton({
  width,
  height = 16,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (motionReduced()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        { height, width: width as ViewStyle['width'], opacity: pulse },
        style,
      ]}
    />
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.xs + 2,
  },
  secondaryButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ghostButton: { backgroundColor: 'transparent' },
  dangerButton: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  buttonLabel: { ...type.label, fontSize: 16, color: colors.ink, fontWeight: '700' },
  secondaryLabel: { color: colors.text },
  dangerLabel: { color: colors.danger },
  disabled: { opacity: 0.45 },

  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  iconButtonPlain: { backgroundColor: 'transparent' },

  fieldGroup: { gap: space.xs },
  fieldLabel: { ...type.label, color: colors.text },
  fieldRow: { flexDirection: 'row', alignItems: 'stretch', gap: space.xs },
  field: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    fontSize: 16,
    color: colors.text,
  },
  fieldWithAction: { flexShrink: 1 },
  fieldAction: { justifyContent: 'center' },
  fieldError: { borderColor: colors.danger },
  fieldErrorText: { ...type.caption, color: colors.danger },
  multiline: { minHeight: 104, textAlignVertical: 'top' },
  hint: { ...type.caption, color: colors.muted },

  card: {
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    gap: space.sm + 2,
  },
  cardRaised: { backgroundColor: colors.raised },
  cardOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
  },

  eyebrow: { ...type.eyebrow, color: colors.muted, textTransform: 'uppercase' },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { color: colors.muted },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm - 1,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { ...type.caption, fontSize: 13, color: colors.muted, flexShrink: 0 },
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexShrink: 1,
  },
  rowValue: {
    ...type.caption,
    fontSize: 13,
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
    fontWeight: '500',
  },
  mono: { fontFamily: fonts.mono, fontSize: 11 },

  notice: {
    padding: space.md,
    backgroundColor: colors.neutralSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: space.xs + 2,
  },
  noticeIcon: { paddingTop: 1 },
  errorNotice: { backgroundColor: colors.dangerSoft },
  successNotice: { backgroundColor: colors.mintSoft },
  warningNotice: { backgroundColor: colors.warningSoft },
  noticeText: { ...type.caption, fontSize: 13, lineHeight: 20, color: colors.text, flex: 1 },
  noticeTextWithIcon: { flex: 1 },
  errorText: { color: colors.danger },

  link: { paddingVertical: space.sm, alignItems: 'center' },
  linkPressed: { opacity: 0.6 },
  linkText: { ...type.label, color: colors.primary },
  linkTextMuted: { color: colors.muted },

  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.cream, borderColor: colors.cream },
  chipText: { ...type.caption, color: colors.muted },
  chipTextSelected: { color: colors.ink, fontWeight: '700' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  segmentSelected: { backgroundColor: colors.raised },
  segmentText: { ...type.caption, color: colors.muted, fontWeight: '600' },
  segmentTextSelected: { color: colors.text },

  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.mint,
  },
  dotWait: { backgroundColor: colors.warning },
  dotBad: { backgroundColor: colors.danger },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.sm,
  },
  listRowPressed: { opacity: 0.6 },
  listIcon: { width: 22, alignItems: 'center' },
  listLabel: { ...type.body, fontSize: 15, color: colors.text, flexShrink: 0 },
  listLabelDestructive: { color: colors.danger },
  listValue: {
    ...type.caption,
    fontSize: 13,
    color: colors.muted,
    flex: 1,
    textAlign: 'right',
  },

  skeleton: {
    backgroundColor: colors.raised,
    borderRadius: radius.sm,
  },
});
