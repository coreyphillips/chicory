import { Platform, Vibration } from 'react-native';

/**
 * Physical feedback for the moments that move money.
 *
 * `react-native-haptic-feedback` is resolved lazily and optionally: the module
 * is absent under Jest and in any build that has not run `pod install` yet, and
 * a wallet must not fail to render because a taptic engine is missing. Android
 * falls back to a short `Vibration`, which is the only haptic core RN offers;
 * iOS simply stays silent rather than buzzing the whole device.
 */
type Feedback =
  | 'selection'
  | 'light'
  | 'medium'
  | 'rigid'
  | 'soft'
  | 'success'
  | 'warning'
  | 'error';

const RN_HAPTIC: Record<Feedback, string> = {
  selection: 'selection',
  light: 'impactLight',
  medium: 'impactMedium',
  rigid: 'rigid',
  soft: 'soft',
  success: 'notificationSuccess',
  warning: 'notificationWarning',
  error: 'notificationError',
};

const ANDROID_FALLBACK_MS: Record<Feedback, number> = {
  selection: 8,
  light: 10,
  medium: 18,
  rigid: 14,
  soft: 6,
  success: 24,
  warning: 32,
  error: 42,
};

let module: { trigger?: (type: string, options?: object) => void } | null =
  undefined as never;

function resolve() {
  if (module !== undefined) return module;
  try {
    const loaded = require('react-native-haptic-feedback');
    module = loaded?.default ?? loaded ?? null;
  } catch {
    module = null;
  }
  return module;
}

let enabled = true;
/** Turned off wholesale by Settings > Haptics, never by Reduce Motion. */
export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function haptic(kind: Feedback = 'light') {
  if (!enabled) return;
  const loaded = resolve();
  if (loaded?.trigger) {
    try {
      loaded.trigger(RN_HAPTIC[kind], {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      return;
    } catch {
      // fall through to the platform fallback
    }
  }
  if (Platform.OS === 'android') {
    try {
      Vibration.vibrate(ANDROID_FALLBACK_MS[kind]);
    } catch {
      // A device without a vibrator is not an error worth surfacing.
    }
  }
}
