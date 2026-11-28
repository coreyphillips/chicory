import { validateProfile } from '../services/networks';
import type { NetworkProfile } from '../services/networks';
import { isOnionHost } from '../services/tor';

export type DeviceSettings = NetworkProfile;
export function validateDeviceSettings(value: DeviceSettings) {
  validateProfile(value, true);
  if (
    !value.electrum?.host?.trim() ||
    !Number.isInteger(value.electrum.port) ||
    value.electrum.port < 1 ||
    value.electrum.port > 65535
  ) {
    throw new Error('Enter an Electrum server and a valid port.');
  }
  if (value.transport !== 'native' && value.transport !== 'relay')
    throw new Error('Choose a connection method.');
  if (isOnionHost(value.electrum.host) && value.electrum.tls)
    throw new Error(
      'An onion Electrum server connects through Tor without TLS. Turn off TLS for this server.',
    );
  if (value.transport === 'relay') {
    const url = new URL(value.relayUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(
      url.hostname,
    );
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'wss:' &&
        !(url.protocol === 'ws:' && loopback && __DEV__))
    ) {
      throw new Error(
        'Use a WSS relay address without credentials or query parameters.',
      );
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value.relayToken))
      throw new Error('Enter the relay’s private connection token.');
  }
}
