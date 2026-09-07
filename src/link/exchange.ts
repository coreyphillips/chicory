/**
 * One round trip on the custom message type: arm the listener for the
 * reply BEFORE sending, so a fast peer cannot answer into silence; release
 * the listener and the timer whichever way the wait ends. Shared by the JIT
 * and swap clients.
 */

import { message } from 'beignet/lightning';
import { ICustomMessage, IPeerLink } from './types';

export interface IExchangeParams<T> {
	peerHex: string;
	requestSubtype: number;
	requestPayload: Buffer;
	replySubtype: number;
	requestId: Buffer;
	decode: (payload: Buffer) => T;
	timeoutMs: number;
	timeoutMessage: string;
}

export function exchange<T extends { requestId: Buffer }>(
	link: IPeerLink,
	params: IExchangeParams<T>
): Promise<T> {
	const peerHex = params.peerHex.toLowerCase();
	return new Promise<T>((resolve, reject) => {
		let unsubscribe: () => void = () => undefined;
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(params.timeoutMessage));
		}, params.timeoutMs);
		timer.unref?.();
		const onMessage = (msg: ICustomMessage): void => {
			if (msg.peerPubkey.toLowerCase() !== peerHex) return;
			if (msg.subtype !== params.replySubtype) return;
			if (msg.version !== message.BEIGNET_CUSTOM_PROTOCOL_VERSION) return;
			let decoded: T;
			try {
				decoded = params.decode(msg.payload);
			} catch {
				// Malformed; a well-formed reply may still follow.
				return;
			}
			if (!decoded.requestId.equals(params.requestId)) return;
			clearTimeout(timer);
			unsubscribe();
			resolve(decoded);
		};
		unsubscribe = link.onCustomMessage(onMessage);
		try {
			link.sendCustomMessage(
				peerHex,
				params.requestSubtype,
				params.requestPayload
			);
		} catch (err) {
			clearTimeout(timer);
			unsubscribe();
			reject(err);
		}
	});
}
