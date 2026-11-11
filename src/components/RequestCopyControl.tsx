import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  requireNativeComponent,
  useWindowDimensions,
} from 'react-native';
import type {
  GestureResponderEvent,
  HostInstance,
  PressableProps,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { copy } from '../design/copy';
import { Glyph } from '../design/glyphs';
import { palette } from '../design/palette';
import { CopyChip } from '../glyphs/CopyChip';
import type { CopyChipProps } from '../glyphs/CopyChip';
import {
  WHISPER_DELAY,
  WhisperProvider,
  pillPlace,
  useWhisperHold,
} from '../glyphs/Whisper';
import type { Anchor } from '../glyphs/Whisper';
import { focusAfterTransition, focusOn } from '../motion/focus';
import { riseIn, sceneOut } from '../motion/presets';
import { durations } from '../motion/tokens';
import { useAppActive } from '../scenes/home/useAppActive';
import { GlyphButton, TARGET } from '../scenes/receive/controls';
import type { RequestCopyFormat } from '../scenes/receive/model';
import { usePaneActive } from '../stage/panes/Pane';
import { radius, space } from '../theme';

type Rail = Exclude<RequestCopyFormat, 'request'>;

// A full-screen iOS modal needs a keyboard responder for hardware Escape.
const EscapeKey =
  Platform.OS === 'ios'
    ? requireNativeComponent<{ onEscape: () => void }>('ChicoryModalEscapeKey')
    : null;

const labels = {
  lightning: copy.receive.copyLightning,
  bitcoin: copy.receive.copyBitcoin,
};

interface Props {
  formats: readonly Rail[];
  copies: number;
  copyScope: string;
  onCopy: (format: RequestCopyFormat) => void;
  chip?: Pick<CopyChipProps, 'label' | 'value' | 'glyph'>;
}

/** One responder owns both tap and hold, so asking what a glyph means
 * consumes its release without copying anything. */
function CopyOption({
  format,
  focusRef,
  onCopy,
}: {
  format: Rail;
  focusRef?: React.RefObject<HostInstance | null>;
  onCopy: () => void;
}) {
  const label = labels[format];
  const { source, explain } = useWhisperHold(label, { focusRef });
  return (
    <Pressable
      ref={source}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onCopy}
      delayLongPress={WHISPER_DELAY}
      onLongPress={explain}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
    >
      <Glyph
        name={format === 'lightning' ? 'bolt' : 'chain'}
        size={22}
        color={palette.cream}
      />
    </Pressable>
  );
}

/** Remount the trigger when the wallet, eligible choices or viewport changes.
 * A choice made on one request can never follow it to another request. */
export function RequestCopyControl({ copyScope, ...props }: Props) {
  const awake = useAppActive();
  const live = usePaneActive() && awake;
  const { width, height } = useWindowDimensions();
  return (
    <Control
      key={JSON.stringify([copyScope, props.formats, live, width, height])}
      {...props}
      live={live}
      width={width}
    />
  );
}

function Control({
  formats,
  copies,
  onCopy,
  chip,
  live,
  width,
}: Omit<Props, 'copyScope'> & { live: boolean; width: number }) {
  const trigger = useRef<HostInstance>(null);
  const first = useRef<HostInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [closing, setClosing] = useState(false);
  const open = useRef(false);
  const removal = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelFocus = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      open.current = false;
      clearTimeout(removal.current);
      cancelFocus.current?.();
    },
    [],
  );

  const restoreFocus = useCallback(() => {
    if (!open.current && trigger.current) {
      cancelFocus.current?.();
      cancelFocus.current = focusAfterTransition(() => trigger.current);
    }
  }, []);
  const close = useCallback(() => {
    if (!open.current) return;
    open.current = false;
    setClosing(true);
    // Keep the transparent window until its capsule has faded away.
    removal.current = setTimeout(() => {
      setAnchor(null);
      setClosing(false);
      if (Platform.OS !== 'ios') restoreFocus();
    }, durations.exit);
  }, [restoreFocus]);
  useLayoutEffect(() => {
    if (Platform.OS !== 'android' || !anchor) return;
    // Some Android versions dismiss the dialog on Escape key-down, before
    // React Native receives key-up. The activity regains focus in either case.
    const subscription = AppState.addEventListener('focus', close);
    return () => subscription.remove();
  }, [anchor, close]);

  const show = (event: GestureResponderEvent) => {
    if (!live || closing || open.current || !formats.length) return;
    cancelFocus.current?.();
    open.current = true;
    setAnchor(
      trigger.current?.getBoundingClientRect?.() ?? {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        width: 0,
        height: 0,
      },
    );
  };
  const choose = (format: Rail) => {
    if (!open.current) return;
    close();
    onCopy(format);
  };
  const onAction: PressableProps['onAccessibilityAction'] = event => {
    const format = formats.find(item => item === event.nativeEvent.actionName);
    if (format && live) onCopy(format);
  };
  const holdActions =
    live && formats.length
      ? {
          onLongPress: show,
          delayLongPress: WHISPER_DELAY,
          accessibilityActions: formats.map(name => ({
            name,
            label: labels[name],
          })),
          onAccessibilityAction: onAction,
        }
      : undefined;
  const hint = holdActions ? copy.receive.copyChoicesHint : undefined;
  const tap = () => {
    if (live && !anchor && !open.current) onCopy('request');
  };

  const place =
    anchor &&
    pillPlace(
      anchor,
      TARGET * formats.length + 2 * space.xxs,
      TARGET + 2 * space.xxs,
      width,
    );
  return (
    <>
      {chip ? (
        <CopyChip
          {...chip}
          interaction={{
            ...holdActions,
            focusRef: trigger,
            onPress: tap,
            accessibilityHint: hint,
            copies,
          }}
        />
      ) : (
        <GlyphButton
          glyph="copy"
          label={copy.receive.copy}
          hint={hint}
          confirm={copies}
          focusRef={trigger}
          holdActions={holdActions}
          haptic={false}
          onPress={tap}
        />
      )}
      <Modal
        visible={!!place}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onShow={() => focusOn(first.current)}
        onRequestClose={close}
        onDismiss={restoreFocus}
      >
        {place ? (
          <WhisperProvider>
            <View
              style={styles.root}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              {EscapeKey && <EscapeKey onEscape={close} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.receive.closeCopyChoices}
                onPress={close}
                style={StyleSheet.absoluteFill}
              />
              {!closing ? (
                <Reanimated.View
                  entering={riseIn(space.xxs)}
                  exiting={sceneOut()}
                  style={[styles.tray, { left: place.x, top: place.y }]}
                >
                  {formats.map((format, i) => (
                    <CopyOption
                      key={format}
                      format={format}
                      focusRef={i === 0 ? first : undefined}
                      onCopy={() => choose(format)}
                    />
                  ))}
                </Reanimated.View>
              ) : null}
            </View>
          </WhisperProvider>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tray: {
    position: 'absolute',
    flexDirection: 'row',
    padding: space.xxs,
    borderRadius: radius.pill,
    backgroundColor: palette.cocoa,
    boxShadow: [
      { offsetX: 0, offsetY: 2, blurRadius: 8, color: palette.scrim },
    ],
  },
  option: {
    width: TARGET,
    height: TARGET,
    borderRadius: TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: palette.husk },
});
