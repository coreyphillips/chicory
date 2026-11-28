import 'react-native-url-polyfill/auto';
import { openOwnedDeviceWallet, loadOwnedPreferences } from './deviceRuntime';
import { setDiagnosticSink } from '../services/diagnosticLog';
import { forwardWalletPerf } from '../services/perf';
import { walletHost } from './walletHostNative';
import { failure } from './walletHostProtocol';
import type { HostRequest, HostEvent } from './walletHostProtocol';

type Wallet = Awaited<ReturnType<typeof openOwnedDeviceWallet>>;
let active:
  | {
      session: string;
      wallet: Wallet;
      notes?: ReturnType<Wallet['openPaymentNotes']>;
    }
  | undefined;
let failedClose: { session: string; wallet: Wallet } | undefined;
let lifecycle: Promise<unknown> = Promise.resolve();

// Serialize vault opens, migration, erases and closes. Ordinary wallet reads
// and requests keep the portable engine's own concurrency and shutdown rules.
function exclusive<T>(operation: () => Promise<T>) {
  const result = lifecycle.then(operation);
  lifecycle = result.catch(() => {});
  return result;
}

function emit(session: string, event: HostEvent) {
  try {
    walletHost.notify(session, JSON.stringify(event));
  } catch {
    // A detached diagnostics view cannot interrupt a payment.
  }
}

async function dispatch(message: HostRequest): Promise<unknown> {
  switch (message.op) {
    case 'preferences':
      return exclusive(loadOwnedPreferences);
    case 'erase':
      return exclusive(async () => {
        if (active)
          throw new Error('Close the device wallet before erasing it.');
        const { eraseDeviceStorage } = await import('./storage');
        await eraseDeviceStorage();
      });
    case 'open':
      return exclusive(async () => {
        if (active) throw new Error('The device wallet is already open.');
        const { session } = message;
        const send = (event: HostEvent) => emit(session, event);
        setDiagnosticSink(event => send({ type: 'log', event }));
        forwardWalletPerf(message.perfUntil, send);
        try {
          const wallet = await openOwnedDeviceWallet(
            message.settings,
            event => send({ type: 'diagnostic', event }),
            message.options,
          );
          active = { session, wallet };
          failedClose = undefined;
        } catch (error) {
          forwardWalletPerf(0);
          setDiagnosticSink(undefined);
          throw error;
        }
      });
    case 'close':
      return exclusive(async () => {
        const owner =
          active?.session === message.session ? active : failedClose;
        if (owner?.session !== message.session) return;
        active = undefined;
        try {
          await owner.wallet.close();
          failedClose = undefined;
        } catch (error) {
          failedClose = owner;
          throw error;
        } finally {
          forwardWalletPerf(0);
          setDiagnosticSink(undefined);
        }
      });
  }
  if (!active || active.session !== message.session) {
    throw Object.assign(
      new Error('Unlock the local wallet before continuing.'),
      { code: 'ENGINE_CLOSED' },
    );
  }
  switch (message.op) {
    case 'request':
      return active.wallet.request(message.request);
    case 'background':
      return active.wallet.setAppBackgrounded(message.background);
    case 'readNotes':
    case 'saveNote':
    case 'moveNotes': {
      const notes = (active.notes ??= active.wallet.openPaymentNotes());
      if (message.op === 'readNotes')
        return [...(await notes.read(message.scope))];
      if (message.op === 'saveNote')
        return notes.save(message.scope, message.key, message.note);
      return notes.move(message.scope, new Map(message.moves));
    }
    default:
      throw new Error('Unknown device wallet operation.');
  }
}

export async function handleEngineMessage(payload: string): Promise<string> {
  let value;
  try {
    value = await dispatch(JSON.parse(payload));
  } catch (error) {
    return failure(error);
  }
  // If encoding the result fails, the transport has lost the reply. Only
  // an exception from dispatch itself can be returned as an engine refusal.
  return JSON.stringify({ value });
}
