import React, { useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Body, Button, Eyebrow, LinkButton, Notice, Title } from './ui';
import { colors, radius, space, type } from '../theme';
import { haptic } from '../services/haptics';
import { normalizePaymentLink } from '../services/links';

/**
 * Point the camera at a payment request.
 *
 * The camera module is resolved optionally, so the JavaScript still runs in
 * Jest and in any build whose native side has not been rebuilt since the module
 * was added; without it this degrades to an honest explanation plus the paste
 * path rather than a blank or broken screen.
 *
 * A scanned code is handed to the send review exactly as a pasted one is.
 * Nothing is paid from here, and no frame or image leaves the device.
 */
type CameraModule = {
  Camera?: React.ComponentType<Record<string, unknown>>;
  CameraType?: { Back?: unknown };
};

let cameraKit: CameraModule | null = undefined as never;
function loadCamera(): CameraModule | null {
  if (cameraKit !== undefined) return cameraKit;
  try {
    cameraKit = require('react-native-camera-kit');
  } catch {
    cameraKit = null;
  }
  return cameraKit;
}

type Permission = 'checking' | 'granted' | 'denied';

export function Scanner({
  onDetected,
  onCancel,
}: {
  onDetected: (value: string) => void;
  onCancel: () => void;
}) {
  const lib = loadCamera();
  const Camera = lib?.Camera;
  const [permission, setPermission] = useState<Permission>(
    Platform.OS === 'android' ? 'checking' : 'granted',
  );
  // One code, once. A second frame carrying the same request must not stack
  // another review on top of the one already opening.
  const claimed = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !Camera) return;
    let active = true;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
      title: 'Read a payment request',
      message:
        'Chicory uses the camera only to read a payment code. Nothing is recorded or sent.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    })
      .then(result => {
        if (!active) return;
        setPermission(
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied',
        );
      })
      .catch(() => active && setPermission('denied'));
    return () => {
      active = false;
    };
  }, [Camera]);

  function accept(value: string | undefined) {
    if (claimed.current) return;
    const scanned = value?.trim();
    if (!scanned) return;
    claimed.current = true;
    haptic('success');
    onDetected(normalizePaymentLink(scanned) || scanned);
  }

  if (!Camera)
    return (
      <View style={styles.stack}>
        <Eyebrow>Scan</Eyebrow>
        <Title>Camera scanning is unavailable.</Title>
        <Notice icon="info">
          This build does not include the camera module. Rebuild the native app
          to enable scanning, or paste the request instead.
        </Notice>
        <PasteAction onAccept={accept} />
        <LinkButton label="Back to Send" onPress={onCancel} />
      </View>
    );

  if (permission === 'denied')
    return (
      <View style={styles.stack}>
        <Eyebrow>Camera</Eyebrow>
        <Title>Camera access is off.</Title>
        <Body>
          Chicory needs the camera only to read a payment request. Turn it on in
          your device settings, or paste the request instead.
        </Body>
        <PasteAction onAccept={accept} />
        <LinkButton label="Back to Send" onPress={onCancel} />
      </View>
    );

  return (
    <View style={styles.stack}>
      <Eyebrow>Scan</Eyebrow>
      <Title>Point at the code.</Title>
      <View style={styles.viewfinder}>
        {permission === 'granted' ? (
          <Camera
            scanBarcode
            allowedBarcodeTypes={['qr']}
            scanThrottleDelay={600}
            cameraType={lib?.CameraType?.Back}
            style={styles.camera}
            onReadCode={(event: {
              nativeEvent?: { codeStringValue?: string };
            }) => accept(event?.nativeEvent?.codeStringValue)}
            onError={() => setPermission('denied')}
          />
        ) : (
          <Text style={styles.hint}>Getting the camera ready…</Text>
        )}
        <View pointerEvents="none" style={styles.reticle} />
      </View>
      <PasteAction onAccept={accept} />
      <LinkButton label="Back to Send" onPress={onCancel} />
    </View>
  );
}

function PasteAction({ onAccept }: { onAccept: (value: string) => void }) {
  const [error, setError] = useState('');
  return (
    <>
      {error ? (
        <Notice kind="error" icon="alert">
          {error}
        </Notice>
      ) : null}
      <Button
        secondary
        icon="copy"
        label="Paste from clipboard"
        onPress={() => {
          Clipboard.getString()
            .then(value => {
              const request = value?.trim();
              if (!request) {
                setError('The clipboard is empty.');
                return;
              }
              onAccept(request);
            })
            .catch(() => setError('Could not read the clipboard.'));
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  reticle: {
    width: '68%',
    aspectRatio: 1,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  hint: { ...type.caption, color: colors.muted },
});
