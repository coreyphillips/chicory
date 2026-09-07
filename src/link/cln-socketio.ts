/**
 * clnrest's notification stream is a Socket.IO server (both the original
 * Python plugin and the Rust one shipped since CLN 24.11), mounted at
 * `/socket.io/`, authenticated by the `rune` header on the handshake, and
 * emitting every node notification as a `message` event whose payload is
 * the notification object (`{ custommsg: { peer_id, payload } }`).
 *
 * This is the minimal Socket.IO v4 client that needs: engine.io over a
 * WebSocket, the open packet answered with a namespace connect (`40`), pings
 * (`2`) answered with pongs (`3`), and `42[...]` events decoded. Nothing
 * else of the protocol is used, so no socket.io-client dependency.
 */

import { IHttpEndpoint } from './http';
import { ClnNotificationSource } from './cln-link';

interface IWebSocketLike {
	on(event: string, cb: (...args: unknown[]) => void): void;
	send(data: string): void;
	close(): void;
}

export interface IClnSocketIoOptions {
	host: string;
	port: number;
	rune: string;
	https?: boolean;
	ca?: IHttpEndpoint['ca'];
	rejectUnauthorized?: boolean;
	/** Override the WebSocket constructor (tests); default the `ws` package. */
	webSocket?: new (
		url: string,
		options: Record<string, unknown>
	) => IWebSocketLike;
}

export function clnSocketIoNotifications(
	options: IClnSocketIoOptions
): ClnNotificationSource {
	const scheme = options.https === false ? 'ws' : 'wss';
	const url = `${scheme}://${options.host}:${options.port}/socket.io/?EIO=4&transport=websocket`;
	return (onEvent, onClose): ReturnType<ClnNotificationSource> => {
		let Ctor = options.webSocket;
		if (!Ctor) {
			try {
				Ctor = require('ws');
			} catch {
				onClose(
					new Error(
						'ClnPeerLink needs the optional `ws` package for notifications ' +
							'(npm install ws), or a `notifications` source of your own'
					)
				);
				return { close: (): void => undefined };
			}
		}
		const ws = new Ctor!(url, {
			headers: { rune: options.rune },
			...(options.ca !== undefined ? { ca: options.ca } : {}),
			...(options.rejectUnauthorized !== undefined
				? { rejectUnauthorized: options.rejectUnauthorized }
				: {})
		});
		let settled = false;
		let attached: () => void = () => undefined;
		let detached: (err: Error) => void = () => undefined;
		const ready = new Promise<void>((resolve, reject) => {
			attached = resolve;
			detached = reject;
		});
		ready.catch(() => undefined);
		const finish = (err?: unknown): void => {
			if (settled) return;
			settled = true;
			detached(err instanceof Error ? err : new Error(String(err ?? 'closed')));
			onClose(err);
		};
		ws.on('message', (data: unknown) => {
			const text = String(data);
			// engine.io packet type is the first character; socket.io packet
			// type the second (0 connect, 2 event).
			if (text.startsWith('0')) {
				ws.send('40');
				return;
			}
			if (text === '2') {
				ws.send('3');
				return;
			}
			if (text.startsWith('40')) {
				// Namespace connect acknowledged: from here on broadcasts
				// reach this socket.
				attached();
				return;
			}
			if (text.startsWith('42')) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(text.slice(2));
				} catch {
					return;
				}
				if (!Array.isArray(parsed) || parsed.length < 2) return;
				const [name, payload] = parsed as [string, unknown];
				if (payload && typeof payload === 'object') {
					const body = payload as Record<string, unknown>;
					// clnrest emits `message` with the notification object; a
					// server that names the notification as the event is also
					// understood.
					onEvent(name === 'message' ? body : { [name]: body });
				}
				return;
			}
			if (text.startsWith('44')) {
				// Namespace connect refused (a rune the server rejected).
				finish(
					new Error(`clnrest refused the notification stream: ${text.slice(2)}`)
				);
				ws.close();
			}
		});
		ws.on('error', (err: unknown) => finish(err));
		ws.on('close', () => finish());
		return {
			ready,
			close: (): void => {
				settled = true;
				detached(new Error('closed'));
				ws.close();
			}
		};
	};
}
