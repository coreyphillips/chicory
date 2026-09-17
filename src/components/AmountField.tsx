import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip } from './ui';
import { colors, fonts, number, radius, space, type } from '../theme';

/**
 * Satoshi entry.
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
 */
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, '');
const grouped = (digits: string) =>
  digits ? number(Number(digits)) : '';

export function AmountField({
  label = 'Amount in sats',
  value,
  onChangeText,
  placeholder,
  hint,
  editable = true,
  presets,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  editable?: boolean;
  presets?: number[];
  autoFocus?: boolean;
}) {
  const digits = digitsOnly(value);
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.display}>
        <TextInput
          accessibilityLabel={label}
          style={styles.input}
          value={grouped(digits)}
          onChangeText={next => onChangeText(digitsOnly(next))}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          selectionColor={colors.primary}
          keyboardType="number-pad"
          inputMode="numeric"
          autoCorrect={false}
          editable={editable}
          autoFocus={autoFocus}
          // 16 digits, the most the supply needs, plus their five separators.
          maxLength={21}
          returnKeyType="done"
        />
        <Text style={styles.suffix}>sats</Text>
      </View>
      {presets?.length ? (
        <View style={styles.presets}>
          {presets.map(preset => (
            <Chip
              key={preset}
              label={number(preset)}
              selected={digits === String(preset)}
              disabled={!editable}
              onPress={() => onChangeText(String(preset))}
            />
          ))}
        </View>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  label: { ...type.label, color: colors.text },
  display: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 72,
  },
  input: {
    flex: 1,
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -1.2,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  suffix: { ...type.caption, fontSize: 14, color: colors.muted, fontFamily: fonts.mono },
  presets: { flexDirection: 'row', gap: space.xs },
  hint: { ...type.caption, color: colors.muted },
});
