/**
 * Node URI parsing. The same `pubkey@host:port` form every Lightning
 * implementation prints, plus beignet's `pubkey@ws://host:port` and
 * `pubkey@wss://host:port` WebSocket forms.
 */

import { transport } from 'beignet/lightning';

export interface INodeUri {
	/** 33-byte compressed public key, lowercase hex. */
	pubkeyHex: string;
	host: string;
	port: number;
	/** Set when the URI names a WebSocket endpoint rather than plain TCP. */
	webSocketUrl?: string;
}

/**
 * Parse a node URI. Throws on a malformed pubkey, host or port so a bad
 * address fails before anything dials it.
 */
export function parseNodeUri(uri: string): INodeUri {
	const parsed = transport.parsePeerUri(uri.trim());
	const out: INodeUri = {
		pubkeyHex: parsed.pubkey,
		host: parsed.host,
		port: parsed.port
	};
	if (parsed.transport?.type === 'ws') {
		out.webSocketUrl = parsed.transport.url;
	}
	return out;
}

/** Format a node URI from its parts. */
export function formatNodeUri(
	pubkeyHex: string,
	host: string,
	port: number
): string {
	const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return `${pubkeyHex}@${h}:${port}`;
}
