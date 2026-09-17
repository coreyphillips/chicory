import EventEmitter from 'eventemitter3';
import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { Socks5Client } from './socks';
import {
  ensureTorReady,
  isOnionHost,
  TOR_SOCKS_HOST,
  TOR_SOCKS_PORT,
} from '../services/tor';

type NativeSocket = ReturnType<typeof TcpSocket.createConnection>;
type WriteCallback = (error?: Error) => void;

const CONNECT_TIMEOUT_MS = 20000;
/**
 * An onion circuit is far slower to open than a direct dial, and Tor's own SOCKS
 * deadline is the usual bound. This only catches a daemon that answers nothing.
 */
const TOR_HANDSHAKE_TIMEOUT_MS = 180000;

/** Adapt native TCP/TLS to the byte-stream surface used by Beignet's Noise layer. */
export class NativeWalletSocket extends EventEmitter {
  private socket: NativeSocket;
  private queuedBytes = 0;
  private connected = false;
  private ended = false;
  /** The SOCKS5 exchange in progress; null once the tunnel carries wallet bytes. */
  private tunnel: Socks5Client | null = null;
  /** Whether the native socket was told to connect. It rejects calls before that. */
  private dialed = false;
  private pending: { bytes: Buffer; callback?: WriteCallback }[] = [];
  private pendingEncoding: string | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private ready: () => void;
  readonly remoteAddress: string;
  readonly remotePort: number;
  destroyed = false;

  constructor({
    host,
    port,
    tls,
  }: {
    host: string;
    port: number;
    tls: boolean;
  }) {
    super();
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid wallet connection endpoint.');
    }
    const onion = isOnionHost(host);
    if (onion && tls) {
      // The onion address is itself the server's key, and the circuit is already
      // encrypted end to end. Wrapping TLS around it would only verify a
      // certificate for a name no authority issues.
      throw new Error(
        'An onion endpoint connects through Tor without TLS. Turn off TLS for this server.',
      );
    }
    this.remoteAddress = host;
    this.remotePort = port;
    const options = {
      host,
      port,
      connectTimeout: CONNECT_TIMEOUT_MS,
      tlsCheckValidity: true,
    };
    this.socket = onion
      ? new TcpSocket.Socket()
      : tls
      ? TcpSocket.connectTLS(options)
      : TcpSocket.createConnection(options, () => {});
    this.dialed = !onion;
    const onConnected = () => {
      if (this.connected || this.destroyed) {
        return;
      }
      this.connected = true;
      this.emit('connect');
      if (tls) {
        this.emit('secureConnect');
      }
    };
    this.ready = onConnected;
    if (onion) {
      // The proxy connection opening is not the destination answering.
      this.socket.on('connect', () => this.openTunnel());
    } else {
      this.socket.on(tls ? 'secureConnect' : 'connect', onConnected);
    }
    this.socket.on('data', data => {
      if (this.tunnel) {
        this.advanceTunnel(
          typeof data === 'string'
            ? Buffer.from(data, 'binary')
            : Buffer.from(data),
        );
        return;
      }
      this.emit('data', typeof data === 'string' ? data : Buffer.from(data));
    });
    // The native socket reports its errors as strings. The engine records
    // err.message and the diagnostics show it, so hand up an Error.
    this.socket.on('error', error =>
      this.emit(
        'error',
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
    this.socket.on('close', hadError => {
      if (this.ended) {
        return;
      }
      this.ended = true;
      this.destroyed = true;
      this.queuedBytes = 0;
      this.clearHandshakeTimer();
      this.emit('close', hadError);
    });
    this.socket.on('timeout', () => this.emit('timeout'));
    this.socket.on('end', () => this.emit('end'));
    this.socket.on('drain', () => this.emit('drain'));
    if (onion) {
      this.dialThroughTor(host, port);
    }
  }

  /** Start Tor only for the connection that needs it, then dial the local proxy. */
  private async dialThroughTor(host: string, port: number) {
    try {
      await ensureTorReady();
      if (this.destroyed) {
        return;
      }
      this.tunnel = new Socks5Client(host, port);
      this.socket.connect({
        host: TOR_SOCKS_HOST,
        port: TOR_SOCKS_PORT,
        connectTimeout: CONNECT_TIMEOUT_MS,
      });
      // Only a socket that was actually dialled may be written to or closed.
      this.dialed = true;
      // Tor bounds its own SOCKS request, but a wedged daemon would otherwise
      // leave the wallet connecting with nothing to report.
      this.handshakeTimer = setTimeout(
        () =>
          this.fail(
            new Error(`Tor did not open a connection to ${host}:${port}.`),
          ),
        TOR_HANDSHAKE_TIMEOUT_MS,
      );
    } catch (error) {
      this.fail(error);
    }
  }

  private openTunnel() {
    if (!this.tunnel) {
      return;
    }
    try {
      this.socket.write(this.tunnel.greeting());
    } catch (error) {
      this.fail(error);
    }
  }

  private advanceTunnel(chunk: Buffer) {
    const tunnel = this.tunnel;
    if (!tunnel) {
      return;
    }
    try {
      const progress = tunnel.push(chunk);
      if (progress.send) {
        this.socket.write(progress.send);
      }
      if (!progress.ready) {
        return;
      }
      this.tunnel = null;
      this.clearHandshakeTimer();
      if (this.pendingEncoding !== null) {
        const encoding = this.pendingEncoding;
        this.pendingEncoding = null;
        this.socket.setEncoding(
          encoding as Parameters<NativeSocket['setEncoding']>[0],
        );
      }
      this.flush();
      this.ready();
      if (progress.leftover?.length) {
        this.emit('data', progress.leftover);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private flush() {
    const queued = this.pending;
    this.pending = [];
    for (const item of queued) {
      try {
        this.socket.write(item.bytes, undefined, error => {
          this.queuedBytes = Math.max(0, this.queuedBytes - item.bytes.length);
          item.callback?.(error);
        });
      } catch (error) {
        this.queuedBytes = Math.max(0, this.queuedBytes - item.bytes.length);
        item.callback?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.fail(error);
        return;
      }
    }
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private fail(error: unknown) {
    this.destroy(error instanceof Error ? error : new Error(String(error)));
  }

  get writableLength() {
    return this.queuedBytes;
  }
  get connecting() {
    return !this.connected && !this.destroyed;
  }
  get readyState() {
    return this.destroyed ? 'closed' : this.connected ? 'open' : 'opening';
  }

  write(
    value: Uint8Array | string,
    encodingOrCallback?: string | WriteCallback,
    callback?: WriteCallback,
  ): boolean {
    if (this.destroyed) {
      throw new Error('Wallet connection is closed.');
    }
    const cb =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
    const bytes =
      typeof value === 'string'
        ? Buffer.from(value, encoding)
        : Buffer.from(value);
    this.queuedBytes += bytes.length;
    // Tor is still starting, or the tunnel is mid-handshake. Hold the bytes
    // rather than interleaving them with the SOCKS conversation.
    if (!this.dialed || this.tunnel) {
      this.pending.push({ bytes, callback: cb });
      return true;
    }
    try {
      return this.socket.write(bytes, undefined, error => {
        this.queuedBytes = Math.max(0, this.queuedBytes - bytes.length);
        cb?.(error);
      });
    } catch (error) {
      this.queuedBytes = Math.max(0, this.queuedBytes - bytes.length);
      throw error;
    }
  }

  setTimeout(milliseconds: number, callback?: () => void) {
    if (callback) {
      this.once('timeout', callback);
    }
    if (this.dialed) {
      this.socket.setTimeout(milliseconds);
    }
    return this;
  }
  setKeepAlive(enable = true, initialDelay = 0) {
    if (this.dialed) {
      this.socket.setKeepAlive(enable, initialDelay);
    }
    return this;
  }
  setNoDelay(enable = true) {
    if (this.dialed) {
      this.socket.setNoDelay(enable);
    }
    return this;
  }
  setEncoding(encoding: string) {
    // Decoding must not start before the tunnel does, or the SOCKS reply
    // arrives as text and its bytes are lost.
    if (!this.dialed || this.tunnel) {
      this.pendingEncoding = encoding;
      return this;
    }
    this.socket.setEncoding(
      encoding as Parameters<NativeSocket['setEncoding']>[0],
    );
    return this;
  }
  pause() {
    if (this.dialed) {
      this.socket.pause();
    }
    return this;
  }
  resume() {
    if (this.dialed) {
      this.socket.resume();
    }
    return this;
  }
  end(data?: Uint8Array | string) {
    if (data) {
      this.write(data);
    }
    if (this.dialed) {
      this.socket.end();
    } else {
      this.destroy();
    }
    return this;
  }
  destroy(error?: Error) {
    if (this.destroyed) {
      return this;
    }
    this.destroyed = true;
    this.tunnel = null;
    this.pending = [];
    this.clearHandshakeTimer();
    if (error) {
      this.emit('error', error);
    }
    if (this.dialed) {
      this.socket.destroy();
      return this;
    }
    // Nothing was dialed, so no native close event will arrive. Report the
    // close here so a caller waiting on the connection is not left hanging.
    if (!this.ended) {
      this.ended = true;
      this.queuedBytes = 0;
      this.emit('close', !!error);
    }
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}

export const nativeSocketFactory = (options: {
  host: string;
  port: number;
  tls: boolean;
}) => new NativeWalletSocket(options);
