import { AppState, Platform } from 'react-native';
import { EmbeddedWalletClient } from '@beignet/wallet-core';
import { appendDiagnostic } from '../services/diagnosticLog';
import {
  getBootPerfDeadline,
  includeWalletMark,
  includeWalletSqlite,
} from '../services/perf';
import { loadNetworkPreferences } from '../services/networks';
import type { WalletAdapter } from '../services/wallet';
import type { NetworkPreferences } from '../services/networks';
import type { PaymentNote, PaymentNoteStore } from '../services/paymentNotes';
import type { DeviceSettings } from './deviceSettings';
import { validateDeviceSettings } from './deviceSettings';
import { walletHost } from './walletHostNative';
import type {
  Diagnostic,
  HostEvent,
  HostRequest,
  OpenOptions,
} from './walletHostProtocol';
export { validateDeviceSettings };
export type { DeviceSettings };

let sequence = 0;
const listeners = new Map<string, (event: Diagnostic) => void>();
export function receiveWalletEvent(session: string, payload: string) {
  const listener = listeners.get(session);
  if (!listener) return;
  const event = JSON.parse(payload) as HostEvent;
  switch (event.type) {
    case 'diagnostic':
      return listener(event.event);
    case 'log':
      return appendDiagnostic(event.event);
    case 'boot':
      return includeWalletMark(event.name, event.at, event.detail);
    case 'sqlite':
      return includeWalletSqlite(event.tally);
  }
}

async function call<T>(message: HostRequest): Promise<T> {
  const payload = JSON.stringify(message);
  let response: string;
  try {
    response = await walletHost.dispatch(payload);
  } catch (transportError) {
    // A lost reply can follow a durable mutation. Let wallet-core classify
    // that case separately from a failed read, and never replay the command.
    if (message.op === 'request') throw new Error();
    throw new Error(
      transportError instanceof Error
        ? transportError.message
        : 'The wallet runtime is unavailable.',
    );
  }
  const { value, error } = JSON.parse(response);
  if (error) throw Object.assign(new Error(error.message), error);
  return value;
}

export async function loadDevicePreferences(): Promise<NetworkPreferences> {
  const saved = await loadNetworkPreferences();
  if (saved.legacyNetwork !== undefined) return saved;
  return call({ op: 'preferences' });
}
export async function loadDeviceSettings(): Promise<DeviceSettings> {
  const preferences = await loadDevicePreferences();
  return preferences.profiles[preferences.selectedNetwork];
}
export function eraseDeviceWallet(): Promise<void> {
  return call({ op: 'erase' });
}

export async function openDeviceWallet(
  settings: DeviceSettings,
  onDiagnostic?: (event: Diagnostic) => void,
  options?: OpenOptions,
): Promise<EmbeddedWalletClient & Pick<WalletAdapter, 'openPaymentNotes'>> {
  validateDeviceSettings(settings);
  const session = `${Date.now()}-${++sequence}`;
  listeners.set(session, onDiagnostic ?? (() => {}));
  let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
  let opened = false;
  try {
    await call({
      op: 'open',
      session,
      settings,
      options,
      perfUntil: getBootPerfDeadline(),
    });
    opened = true;
    if (Platform.OS === 'android') {
      const update = (state: typeof AppState.currentState) => {
        if (state === 'active' || state === 'background')
          return call<void>({
            op: 'background',
            session,
            background: state === 'background',
          });
      };
      subscription = AppState.addEventListener('change', state => {
        update(state)?.catch(() => {});
      });
      await update(AppState.currentState);
    }
    const client = new EmbeddedWalletClient({
      runtime: {
        request: request => call({ op: 'request', session, request }),
        close: async () => {
          try {
            subscription?.remove();
          } finally {
            subscription = undefined;
            try {
              await call({ op: 'close', session });
            } finally {
              listeners.delete(session);
            }
          }
        },
      },
    });
    const openPaymentNotes = (): PaymentNoteStore => ({
      async read(scope) {
        return new Map(
          await call<[string, PaymentNote][]>({
            op: 'readNotes',
            session,
            scope,
          }),
        );
      },
      save: (scope, key, note) =>
        call<void>({ op: 'saveNote', session, scope, key, note }),
      move: (scope, moves) =>
        call<void>({ op: 'moveNotes', session, scope, moves: [...moves] }),
    });
    return Object.assign(client, { openPaymentNotes });
  } catch (error) {
    try {
      subscription?.remove();
    } finally {
      if (opened) await call({ op: 'close', session }).catch(() => {});
      listeners.delete(session);
    }
    throw error;
  }
}
