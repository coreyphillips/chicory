/**
 * The gallery keeps to itself. Settings and the phases read the lock and
 * haptics preferences and the network profiles from the secure store as
 * they open, and a copy chip writes to the clipboard. Both are replaced
 * here, before anything is drawn, by stand-ins that answer at once and
 * remember only for the life of the process. Nothing the gallery draws
 * reaches the keychain, the clipboard, a vault or the engine.
 *
 * The screens read the keychain through its module's exports at call time,
 * so replacing those exports is enough. If they cannot be replaced, the
 * gallery refuses to start rather than draw against the real store.
 */
import * as Keychain from 'react-native-keychain';
import Clipboard from '@react-native-clipboard/clipboard';
import { setHapticsPreference } from '../../src/services/hapticsPreference';
import {
  defaultPreferences,
  saveNetworkPreferences,
} from '../../src/services/networks';

type Options = { service?: string } | undefined;

const entries = new Map<string, { username: string; password: string }>();
const serviceOf = (options: Options) => options?.service ?? 'default';

let biometry: string | null = null;

/** The biometry the lock and Settings are told this phone has. */
export function setBiometry(kind: string | null) {
  biometry = kind;
}

const keychain = {
  getGenericPassword: async (options?: Options) => {
    const service = serviceOf(options);
    const entry = entries.get(service);
    return entry ? { service, storage: 'gallery', ...entry } : false;
  },
  setGenericPassword: async (
    username: string,
    password: string,
    options?: Options,
  ) => {
    const service = serviceOf(options);
    entries.set(service, { username, password });
    return { service, storage: 'gallery' };
  },
  hasGenericPassword: async (options?: Options) =>
    entries.has(serviceOf(options)),
  resetGenericPassword: async (options?: Options) => {
    entries.delete(serviceOf(options));
    return true;
  },
  getAllGenericPasswordServices: async () => [...entries.keys()],
  getSupportedBiometryType: async () => biometry,
};

const clipboard = {
  getString: async () => '',
  setString: () => {},
};

Object.assign(Keychain, keychain);
Object.assign(Clipboard, clipboard);
if (
  Keychain.getGenericPassword !== (keychain.getGenericPassword as unknown) ||
  Clipboard.setString !== clipboard.setString
) {
  throw new Error('The gallery could not keep to itself; it will not start.');
}

// Network profiles already inspected for an older vault, so opening the
// network editor reads them here and never goes looking for one on disk.
saveNetworkPreferences({ ...defaultPreferences(), legacyNetwork: null });
// A few hundred states in a row would buzz the phone without a break, so
// the gallery starts with haptics off, as Settings would leave them.
setHapticsPreference(false);
