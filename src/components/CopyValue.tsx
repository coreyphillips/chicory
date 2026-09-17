import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { IconButton } from './ui';
import { useToast } from './Toast';
import { colors, fonts, space, type } from '../theme';

/**
 * A reference value with a copy button.
 *
 * Payment hashes, transaction ids and addresses used to be selectable text
 * only, which on a phone means a long-press and two drag handles over a 64
 * character string. The value stays selectable as well, for anyone who wants
 * part of it.
 */
export function CopyValue({
  label,
  value,
  monospace = true,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  const toast = useToast();
  return (
    <View style={styles.wrap}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text selectable style={[styles.value, monospace && styles.mono]}>
          {value}
        </Text>
      </View>
      <IconButton
        name="copy"
        size={17}
        accessibilityLabel={`Copy ${label.toLowerCase()}`}
        onPress={() => {
          Clipboard.setString(value);
          toast(`${label} copied`, 'success', 'copy');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  text: { flex: 1, gap: 3 },
  label: { ...type.micro, color: colors.muted },
  value: { ...type.caption, fontSize: 12, color: colors.text },
  mono: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17 },
});
