/**
 * Two in-memory IPeerLinks wired to each other: what the JIT and swap
 * clients see, without sockets. Delivery is asynchronous (setImmediate) so a
 * reply can never land before the listener that waits for it is armed, and
 * each listener runs isolated, as the real links deliver.
 */

import crypto from 'crypto';
import { crypto as bcrypto, message } from 'beignet/lightning';
import {
	ICustomMessage,
	IPeerLink,
	deliverIsolated
} from '../../src/link/types';

export class FakeLink implements IPeerLink {
	readonly id: string;
	readonly listeners = new Set<(msg: ICustomMessage) => void>();
	readonly sent: Array<{ to: string; subtype: number; payload: Buffer }> = [];
	peer: FakeLink | null = null;
	dropNext = 0;
	delayMs = 0;

	constructor(label: string) {
		const privkey = crypto.createHash('sha256').update(label).digest();
		this.id = bcrypto.getPublicKey(privkey).toString('hex');
	}

	nodeIdHex(): string {
		return this.id;
	}

	isPeerConnected(peerPubkeyHex: string): boolean {
		return this.peer?.id === peerPubkeyHex.toLowerCase();
	}

	async connectPeer(): Promise<void> {
		/* already wired */
	}

	sendCustomMessage(
		peerPubkeyHex: string,
		subtype: number,
		payload: Buffer
	): void {
		if (!this.peer || this.peer.id !== peerPubkeyHex.toLowerCase()) {
			throw new Error(`not connected to ${peerPubkeyHex}`);
		}
		this.sent.push({ to: peerPubkeyHex, subtype, payload });
		if (this.dropNext > 0) {
			this.dropNext--;
			return;
		}
		const target = this.peer;
		const deliver = (): void =>
			target.deliver({
				version: message.BEIGNET_CUSTOM_PROTOCOL_VERSION,
				peerPubkey: this.id,
				subtype,
				payload
			});
		if (this.delayMs > 0) setTimeout(deliver, this.delayMs);
		else setImmediate(deliver);
	}

	onCustomMessage(cb: (msg: ICustomMessage) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	deliver(msg: ICustomMessage): void {
		deliverIsolated([...this.listeners], msg, () => undefined);
	}

	close(): void {
		this.listeners.clear();
	}
}

export function linkPair(label = 'pair'): {
	client: FakeLink;
	provider: FakeLink;
} {
	const client = new FakeLink(
		`${label}-client-${crypto.randomBytes(4).toString('hex')}`
	);
	const provider = new FakeLink(
		`${label}-provider-${crypto.randomBytes(4).toString('hex')}`
	);
	client.peer = provider;
	provider.peer = client;
	return { client, provider };
}
