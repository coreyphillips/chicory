import { AppState, NativeModules } from 'react-native';
import { Buffer } from 'buffer';
import { IrohTransport } from '@beignet/portable-engine';
import type {
  IrohEndpointFactory,
  IrohDiagnostics,
} from '@beignet/portable-engine';

interface NativeIroh {
  bind(
    id: string,
    key: string,
    relays: string,
    discovery: boolean,
  ): Promise<string>;
  connect(
    owner: string,
    id: string,
    peer: string,
    relay: string,
    addresses: string,
  ): Promise<void>;
  read(id: string, limit: number): Promise<string>;
  write(id: string, data: string): Promise<void>;
  closed(id: string): Promise<void>;
  diagnostics(id: string): Promise<string>;
  closeConnection(id: string): Promise<void>;
  closeEndpoint(id: string): Promise<void>;
}
let serial = 0;
const handle = () => `iroh-${Date.now()}-${++serial}`;

async function deadline<T>(
  operation: Promise<T>,
  ms: number,
  cancel: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new Error('Iroh connection timed out'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** BOLT 8 and wallet identity derivation stay in the portable engine. */
export const createNativeIrohEndpoint: IrohEndpointFactory = async options => {
  const native: NativeIroh | undefined = NativeModules.ChicoryIroh;
  if (!native)
    throw new Error('This build does not include the Iroh phone link.');
  let owner = handle();
  const sockets = new Set<IrohTransport>();
  let closed = false;
  let binding: Promise<string> | null = null;
  let cleanup: Promise<void> = Promise.resolve();
  const bind = () => {
    if (!binding) {
      const current = owner;
      let cancelled = false;
      const attempt = deadline(
        cleanup.then(() => {
          if (cancelled || closed || current !== owner)
            throw new Error('Iroh endpoint is closed');
          return native.bind(
            current,
            Buffer.from(options.secretKey).toString('base64'),
            options.relays === undefined ? '' : JSON.stringify(options.relays),
            options.discovery !== false,
          );
        }),
        15000,
        () => {
          cancelled = true;
          native.closeEndpoint(current).catch(() => {});
        },
      );
      binding = attempt;
      attempt.catch(() => {
        if (binding === attempt) binding = null;
      });
    }
    return binding;
  };
  const endpointId = await bind();
  let wasBackground = AppState.currentState === 'background';
  const lifecycle = AppState.addEventListener('change', state => {
    if (state === 'background') wasBackground = true;
    if (state !== 'active' || !wasBackground || closed) return;
    wasBackground = false;
    // iOS can suspend sockets without a close event. Rebind the same identity
    // on resume and let the engine reconnect its durable peer records.
    const previous = owner;
    owner = handle();
    binding = null;
    for (const socket of sockets) socket.destroy();
    cleanup = cleanup
      .then(() => native.closeEndpoint(previous))
      .catch(() => {});
    bind().catch(() => {});
  });
  return {
    address: () => ({ endpointId }),
    // Chicory is an outbound client. The native endpoint advertises no inbound ALPNs.
    listen() {},
    stopListening() {},
    async connect(address, timeoutMs) {
      if (closed) throw new Error('Iroh endpoint is closed');
      let current: string;
      do {
        current = owner;
        await bind();
      } while (!closed && current !== owner);
      if (closed) throw new Error('Iroh endpoint is closed');
      const id = handle();
      const close = () => {
        native.closeConnection(id).catch(() => {});
      };
      try {
        await deadline(
          native.connect(
            current,
            id,
            address.endpointId,
            address.relayUrl || '',
            JSON.stringify(address.directAddresses || []),
          ),
          timeoutMs,
          close,
        );
        if (closed || current !== owner)
          throw new Error('Iroh endpoint is closed');
        let diagnostics: IrohDiagnostics = {
          endpointId: address.endpointId,
          path: 'unknown',
        };
        let stopped = false;
        let updating = false;
        const update = async () => {
          if (stopped || updating) return;
          updating = true;
          try {
            diagnostics = JSON.parse(await native.diagnostics(id));
          } catch {
          } finally {
            updating = false;
          }
        };
        await update();
        const timer = setInterval(() => {
          update();
        }, 5000);
        const socket = new IrohTransport({
          read: async limit =>
            Buffer.from(await native.read(id, limit), 'base64'),
          writeAll: async data => {
            for (let offset = 0; offset < data.length; offset += 65536) {
              await native.write(
                id,
                Buffer.from(data.subarray(offset, offset + 65536)).toString(
                  'base64',
                ),
              );
            }
          },
          close,
          closed: () => native.closed(id),
          diagnostics: () => diagnostics,
        });
        sockets.add(socket);
        socket.on('close', () => {
          stopped = true;
          clearInterval(timer);
          sockets.delete(socket);
          close();
        });
        return socket;
      } catch (error) {
        close();
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      lifecycle.remove();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await Promise.all([cleanup, native.closeEndpoint(owner)]);
    },
  };
};
