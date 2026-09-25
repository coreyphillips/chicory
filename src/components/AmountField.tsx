import React, { useEffect, useRef } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { copy } from '../design/copy';
import { AmountReadout } from '../scenes/keypad/AmountReadout';
import { digitsOnly, grouped } from '../scenes/keypad/keys';
import { usePaneActive } from '../stage/panes/Pane';
import { space } from '../theme';
import { Chip } from './ui';

/**
 * Satoshi entry, on the amount keypad (REDESIGN.md 10.3).
 *
 * The old field advertised `e.g. 10,000` while `parseSats` refuses anything but
 * digits, so following the placeholder produced "Enter a whole number of sats."
 * Here the separators are added for the reader and stripped before the value
 * ever leaves this component: `onChangeText` always reports bare digits, which
 * is exactly what `parseSats` accepts.
 *
 * Entry stays in satoshis even when balances are displayed in BTC. A decimal
 * amount field would put float parsing in the money path for the sake of a
 * display preference; the core's exact BigInt helpers are for rendering.
 *
 * There is no system keyboard. `label`, `placeholder` and `hint` are spoken
 * rather than drawn, and presets are chips labelled with their amount alone.
 * `autoFocus` moves a screen reader to the amount once it is shown.
 *
 * `editable` false means something else sets the amount: a lock shows and
 * the keypad goes. `busy` is a wait while the amount is used, as while a
 * quote is asked for: the keypad and presets stay, and take no touches.
 */
export function AmountField({
  label = copy.amount.field,
  value,
  onChangeText,
  placeholder,
  hint,
  editable = true,
  busy = false,
  presets,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  editable?: boolean;
  busy?: boolean;
  presets?: number[];
  autoFocus?: boolean;
}) {
  const live = usePaneActive();
  const digits = digitsOnly(value);
  const readout = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (autoFocus && readout.current) {
      AccessibilityInfo.sendAccessibilityEvent(readout.current, 'focus');
    }
  }, [autoFocus]);
  return (
    <AmountReadout
      ref={readout}
      accessibilityLabel={label}
      value={grouped(digits)}
      onChangeText={next => onChangeText(digitsOnly(next))}
      placeholder={placeholder}
      hint={hint}
      editable={editable}
      busy={busy}
    >
      {presets?.length ? (
        <View style={styles.presets}>
          {presets.map(preset => (
            <Chip
              key={preset}
              label={copy.amount.preset(preset)}
              selected={digits === String(preset)}
              disabled={!editable || busy}
              onPress={
                live && !busy ? () => onChangeText(String(preset)) : undefined
              }
            />
          ))}
        </View>
      ) : null}
    </AmountReadout>
  );
}

const styles = StyleSheet.create({
  presets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
  },
});
