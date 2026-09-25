import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Notice, Title } from '../../components/ui';
import { colors, radius, space } from '../../theme';

/**
 * What someone sees when the app lock is on and they have not authenticated.
 *
 * Nothing about the wallet is shown here, no name, no network, no balance,
 * because the point of the lock is that the phone's holder has not proved they
 * are the owner yet.
 */
export function LockScreen({
  prompting,
  error,
  onUnlock,
}: {
  prompting: boolean;
  error: string;
  onUnlock: () => void;
}) {
  return (
    <SafeAreaView
      style={styles.root}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.lockScreen}>
        <View style={styles.lockMark}>
          <Icon name="lock" size={30} color={colors.primary} />
        </View>
        <Title>Locked</Title>
        {error ? (
          <Notice kind="error" icon="alert">
            {error}
          </Notice>
        ) : null}
        <Button label="Unlock" icon="key" busy={prompting} onPress={onUnlock} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  lockScreen: {
    flex: 1,
    gap: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  lockMark: {
    height: 72,
    width: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
});
