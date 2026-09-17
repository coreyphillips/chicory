import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, motion, radius, space, type } from '../theme';
import { Icon, IconName } from './ui';
import { motionReduced } from '../services/motion';

/**
 * Transient confirmation for actions that leave no trace on screen: copying a
 * request, sharing it, linking an old one.
 *
 * Deliberately not used for anything a user must act on. Errors and settings
 * outcomes stay in place next to the control that produced them, the way the
 * browser app does it, so a message about money never disappears on a timer.
 */
type Tone = 'default' | 'success' | 'error';
type Toast = { id: number; message: string; tone: Tone; icon?: IconName };

const ToastContext = createContext<(message: string, tone?: Tone, icon?: IconName) => void>(
  () => {},
);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, tone: Tone = 'default', icon?: IconName) => {
      counter.current += 1;
      setToast({ id: counter.current, message, tone, icon });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const progress = useRef(new Animated.Value(motionReduced() ? 1 : 0)).current;
  useEffect(() => {
    if (motionReduced()) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  const tint =
    toast.tone === 'success'
      ? colors.mint
      : toast.tone === 'error'
      ? colors.danger
      : colors.text;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.toast}
      >
        <Icon
          name={
            toast.icon ??
            (toast.tone === 'error'
              ? 'alert'
              : toast.tone === 'success'
              ? 'check'
              : 'info')
          }
          size={17}
          color={tint}
        />
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xxxl + space.lg,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    backgroundColor: colors.overlay,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  text: { ...type.caption, fontSize: 13, color: colors.text, flexShrink: 1 },
});
