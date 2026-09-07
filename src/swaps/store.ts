/**
 * Where the reverse swap records live: one JSON document under the key
 * `swaps:reverse` of the host's IWalletDataStorage.
 *
 * Unlike the direct-funding payment record, a swap record IS key material:
 * it holds the claim private key and the preimage, because a claim after a
 * crash needs exactly those. A host must treat the storage it hands chicory
 * as it would a wallet file (encrypt at rest, restrict its mode). A
 * key-deriving hook, so nothing secret is written, is a documented
 * follow-up.
 */

import { IWalletDataStorage } from '../storage';
import { IReverseSwapRecord } from './types';

export const REVERSE_SWAP_STORAGE_KEY = 'swaps:reverse';

interface IDocument {
	version: 1;
	swaps: Record<string, IReverseSwapRecord>;
}

export class ReverseSwapStore {
	private doc: IDocument | null = null;

	constructor(private readonly storage: IWalletDataStorage) {}

	restore(): IReverseSwapRecord[] {
		const raw = this.storage.loadWalletData(REVERSE_SWAP_STORAGE_KEY);
		let doc: IDocument = { version: 1, swaps: {} };
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as Partial<IDocument>;
				if (
					parsed &&
					parsed.version === 1 &&
					parsed.swaps &&
					typeof parsed.swaps === 'object'
				) {
					doc = { version: 1, swaps: parsed.swaps };
				}
			} catch {
				// A corrupt document is treated as empty rather than fatal; the
				// host's storage is the authority and a fresh write repairs it.
			}
		}
		this.doc = doc;
		return this.list();
	}

	private load(): IDocument {
		if (!this.doc) this.restore();
		return this.doc!;
	}

	list(): IReverseSwapRecord[] {
		return Object.values(this.load().swaps).map((r) => ({ ...r }));
	}

	get(swapIdHex: string): IReverseSwapRecord | null {
		const r = this.load().swaps[swapIdHex];
		return r ? { ...r } : null;
	}

	has(paymentHashHex: string): boolean {
		return this.list().some((r) => r.paymentHashHex === paymentHashHex);
	}

	/** Write the record; synchronous, and FileStorage makes it atomic. */
	upsert(record: IReverseSwapRecord): IReverseSwapRecord {
		const doc = this.load();
		const stored = { ...record, updatedAt: Date.now() };
		doc.swaps[record.swapIdHex] = stored;
		this.storage.saveWalletData(REVERSE_SWAP_STORAGE_KEY, JSON.stringify(doc));
		return { ...stored };
	}
}
