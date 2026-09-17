import { Buffer } from 'buffer';

/**
 * Minimal SOCKS5 client for the local Tor proxy. Tor resolves the destination,
 * so the request always carries the hostname (RFC 1928 ATYP 0x03) and never a
 * locally resolved address: a .onion name has no DNS answer, and leaking the
 * lookup would defeat the circuit.
 *
 * This speaks only the no-authentication method, which is what an app-local
 * SOCKS port on loopback offers.
 */
const VERSION = 0x05;
const NO_AUTH = 0x00;
const CONNECT = 0x01;
const ADDRESS_DOMAIN = 0x03;

const REPLY_MESSAGES: Record<number, string> = {
  0x01: 'The Tor proxy could not open the connection.',
  0x02: 'The Tor proxy refused the connection.',
  0x03: 'Tor could not reach the network.',
  0x04: 'Tor could not reach this address. An onion service that is offline or unpublished reports this.',
  0x05: 'The destination refused the connection.',
  0x06: 'The connection through Tor expired.',
  0x07: 'The Tor proxy rejected the request type.',
  0x08: 'The Tor proxy rejected the address type.',
};

export class Socks5Error extends Error {
  readonly reply: number;
  constructor(reply: number, endpoint: string) {
    super(
      `${
        REPLY_MESSAGES[reply] ?? 'The Tor proxy rejected the connection.'
      } (${endpoint})`,
    );
    this.reply = reply;
    this.name = 'Socks5Error';
  }
}

export interface Socks5Progress {
  /** Bytes to hand to the proxy before waiting for more input. */
  send?: Buffer;
  /** The tunnel is open; everything after this belongs to the destination. */
  ready?: boolean;
  /** Destination bytes that arrived in the same chunk as the final reply. */
  leftover?: Buffer;
}

/**
 * Drives one SOCKS5 CONNECT exchange. It owns no socket, so the caller decides
 * how bytes move and the handshake stays directly testable.
 */
export class Socks5Client {
  private stage: 'greeting' | 'reply' | 'open' = 'greeting';
  private buffer = Buffer.alloc(0);
  private readonly hostBytes: Buffer;

  constructor(private readonly host: string, private readonly port: number) {
    this.hostBytes = Buffer.from(host, 'ascii');
    if (this.hostBytes.length < 1 || this.hostBytes.length > 255) {
      throw new Error('The destination hostname is not a valid SOCKS address.');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('The destination port is not valid.');
    }
  }

  private get endpoint() {
    return `${this.host}:${this.port}`;
  }

  /** The first bytes to write once the proxy connection is open. */
  greeting(): Buffer {
    return Buffer.from([VERSION, 0x01, NO_AUTH]);
  }

  private request(): Buffer {
    const request = Buffer.alloc(7 + this.hostBytes.length);
    request[0] = VERSION;
    request[1] = CONNECT;
    request[2] = 0x00;
    request[3] = ADDRESS_DOMAIN;
    request[4] = this.hostBytes.length;
    this.hostBytes.copy(request, 5);
    request.writeUInt16BE(this.port, 5 + this.hostBytes.length);
    return request;
  }

  /** Feed proxy bytes. Throws on a rejected or malformed exchange. */
  push(chunk: Uint8Array): Socks5Progress {
    if (this.stage === 'open') {
      throw new Error('The Tor tunnel is already open.');
    }
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : Buffer.from(chunk);
    if (this.stage === 'greeting') {
      if (this.buffer.length < 2) return {};
      const [version, method] = [this.buffer[0], this.buffer[1]];
      if (version !== VERSION) {
        throw new Error('The local Tor proxy did not answer with SOCKS5.');
      }
      if (method !== NO_AUTH) {
        throw new Error('The local Tor proxy asked for an unsupported login.');
      }
      this.buffer = Buffer.from(this.buffer.subarray(2));
      this.stage = 'reply';
      const send = this.request();
      // A well-behaved proxy sends nothing before the request, but keep any
      // trailing bytes so an early reply is still parsed in order.
      return this.buffer.length
        ? { send, ...this.push(Buffer.alloc(0)) }
        : { send };
    }
    if (this.buffer.length < 5) return {};
    if (this.buffer[0] !== VERSION) {
      throw new Error('The local Tor proxy did not answer with SOCKS5.');
    }
    const type = this.buffer[3];
    const addressLength =
      type === 0x01
        ? 4
        : type === ADDRESS_DOMAIN
        ? this.buffer[4] + 1
        : type === 0x04
        ? 16
        : -1;
    if (addressLength < 0) {
      throw new Error('The local Tor proxy returned an unknown address type.');
    }
    const total = 4 + addressLength + 2;
    if (this.buffer.length < total) return {};
    const reply = this.buffer[1];
    if (reply !== 0x00) {
      throw new Socks5Error(reply, this.endpoint);
    }
    const leftover = Buffer.from(this.buffer.subarray(total));
    this.buffer = Buffer.alloc(0);
    this.stage = 'open';
    return { ready: true, ...(leftover.length ? { leftover } : {}) };
  }
}
