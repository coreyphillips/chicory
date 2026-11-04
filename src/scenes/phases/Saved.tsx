import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Network } from '@beignet/wallet-core';
import { LinkButton } from '../../components/ui';
import { copy } from '../../design/copy';
import { Bloom } from '../../glyphs/Bloom';
import type { BloomEvent } from '../../glyphs/Bloom';
import { NetworkSettings } from '../../screens/NetworkSettings';
import { useFocus } from '../../motion/focus';
import type { useWalletSession } from '../../services/useWalletSession';
import { usePhaseBack } from '../../stage/StageContext';
import { space } from '../../theme';
import {
  GlyphButton,
  nameStyle,
  PhaseRoot,
  refused,
  SetupPanel,
  StatusPip,
} from './parts';
import { bloomTone, savedVisual, SIZES } from './visual';

type Session = ReturnType<typeof useWalletSession>;

/**
 * The wallet saved on this device, not open, and the ways back into it: a
 * dormant bloom over the wallet's name, a refresh that opens it again, and a
 * cog for the network editor, which opens as a setup panel in the Settings
 * language with the device's connection settings under it.
 *
 * Most often the open failed, and the bloom half wilts as Welcome's does,
 * with a radish pip that holds the reason; the wilt lifts while a retry runs
 * and comes back with the next failure. Without a failure it only rests
 * (`savedVisual`).
 *
 * The refresh stands on the axis the bloom and the name share, with the cog
 * to its right, as Welcome's and Offline's primaries do; the place a
 * secondary takes on those is kept empty here, since there is nothing else
 * to offer before the wallet opens.
 */
export function Saved({
  name,
  network,
  error,
  switchError,
  connecting,
  networkEditor,
  openWallet,
  setError,
  setNetworkEditor,
  setDeviceVisible,
  switchNetwork,
}: Pick<
  Session,
  | 'error'
  | 'switchError'
  | 'connecting'
  | 'networkEditor'
  | 'openWallet'
  | 'setError'
  | 'setNetworkEditor'
  | 'setDeviceVisible'
  | 'switchNetwork'
> & {
  name?: string;
  network: Network;
}) {
  // Back closes the network editor before it leaves the app.
  usePhaseBack(() => {
    if (!networkEditor) return false;
    setNetworkEditor(false);
    return true;
  });
  const focus = useFocus();
  const reason = switchError || error;
  const look = savedVisual({ error: reason, opening: connecting });
  // Each new failure wilts it again, and the wilt lifts with the failure or
  // a retry, as Welcome's does. The count carries on across a lift, so the
  // next failure is a new wilt that plays.
  const [wilt, setWilt] = useState<{ key: number; event?: BloomEvent }>({
    key: 0,
  });
  useEffect(() => {
    setWilt(last => {
      if (!look.wilted) return last.event ? { key: last.key } : last;
      const key = last.key + 1;
      return { key, event: { kind: 'wilt', key } };
    });
  }, [look.wilted, reason]);
  // The bloom speaks for what the screen does not write: whose wallet it is
  // when there is no name to show, and that it is still here.
  const spoken = [
    name ? '' : copy.phase.yourWallet,
    reason ? copy.phase.saved : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <PhaseRoot>
      <View style={styles.identity}>
        <View style={styles.bloom}>
          <Bloom
            size={SIZES.loader}
            open={look.open}
            tone="dormant"
            event={wilt.event}
            accessibilityLabel={spoken || undefined}
          />
          {reason ? (
            <View style={styles.pip}>
              <StatusPip tone="radish" label={reason} />
            </View>
          ) : null}
        </View>
        {name ? <Text style={styles.name}>{name}</Text> : null}
      </View>
      <View style={styles.controls}>
        <View style={styles.balance} />
        <GlyphButton
          ref={focus}
          glyph="refresh"
          look="fill"
          tone={bloomTone(network)}
          size={SIZES.retry}
          label={copy.phase.openDevice}
          busy={connecting}
          onPress={() => {
            openWallet().catch(refused(setError));
          }}
        />
        <GlyphButton
          glyph={networkEditor ? 'close' : 'cog'}
          size={SIZES.cog}
          label={
            networkEditor ? copy.phase.hideNetwork : copy.phase.changeNetwork
          }
          disabled={connecting}
          onPress={() => setNetworkEditor(!networkEditor)}
        />
      </View>
      {networkEditor ? (
        <SetupPanel network={network}>
          <NetworkSettings initialNetwork={network} onApply={switchNetwork} />
          <LinkButton
            label={copy.phase.deviceSettings}
            tone="muted"
            disabled={connecting}
            onPress={() => setDeviceVisible(true)}
          />
        </SetupPanel>
      ) : null}
    </PhaseRoot>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: space.md },
  bloom: { width: SIZES.loader, height: SIZES.loader },
  pip: { position: 'absolute', right: 0, bottom: 0 },
  name: nameStyle,
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  // The cog's place mirrored on the left, so the refresh stands centred.
  balance: { width: SIZES.cog, height: SIZES.cog },
});
