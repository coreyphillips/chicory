/**
 * An in-memory ISwapChain the tests script: transactions at heights (0 =
 * mempool), an unspent set derived from them, mining, eviction and a
 * broadcast that can be told to fail. Every transaction the chain holds is
 * real bitcoinjs bytes, so the swap's own checks run for real.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
	ISwapChain,
	ISwapChainOutput,
	ISwapFundingCandidate
} from '../../src/swaps/types';

export class MockChain implements ISwapChain {
	height = 1000;
	readonly txs = new Map<string, { tx: bitcoin.Transaction; height: number }>();
	readonly broadcasts: string[] = [];
	failNextBroadcasts = 0;
	feeRate: number | null = 3;
	/** Awaited inside estimateFeeRateSatPerVb: a slow fee backend (tests). */
	feeGate: (() => Promise<void>) | null = null;
	/**
	 * Transactions the source cannot answer about (beyond its scan window):
	 * confirmations null, no spender named, no bytes; the outputs they
	 * spent still read as spent.
	 */
	readonly unknownTxids = new Set<string>();

	async currentHeight(): Promise<number> {
		return this.height;
	}

	add(tx: bitcoin.Transaction, height = 0): string {
		this.txs.set(tx.getId(), { tx, height });
		return tx.getId();
	}

	confirm(txid: string, height = this.height): void {
		const entry = this.txs.get(txid);
		if (entry) entry.height = height;
	}

	evict(txid: string): void {
		this.txs.delete(txid);
	}

	mine(blocks = 1): number {
		this.height += blocks;
		// Everything in the mempool lands in the first new block.
		for (const entry of this.txs.values()) {
			if (entry.height === 0) entry.height = this.height - blocks + 1;
		}
		return this.height;
	}

	private spenderOf(txid: string, vout: number): string | null {
		const hash = Buffer.from(txid, 'hex').reverse();
		for (const [id, entry] of this.txs) {
			if (entry.tx.ins.some((i) => i.hash.equals(hash) && i.index === vout))
				return id;
		}
		return null;
	}

	async getTransaction(txidHex: string): Promise<Buffer | null> {
		if (this.unknownTxids.has(txidHex)) return null;
		return this.txs.get(txidHex)?.tx.toBuffer() ?? null;
	}

	async getOutput(
		txidHex: string,
		vout: number
	): Promise<ISwapChainOutput | null> {
		const entry = this.txs.get(txidHex);
		if (!entry) return null;
		const out = entry.tx.outs[vout];
		if (!out) return null;
		if (this.spenderOf(txidHex, vout)) return null;
		return {
			valueSat: BigInt(out.value),
			script: out.script,
			confirmations: entry.height > 0 ? this.height - entry.height + 1 : 0,
			height: entry.height
		};
	}

	async findOutputs(outputScript: Buffer): Promise<ISwapFundingCandidate[]> {
		const out: ISwapFundingCandidate[] = [];
		for (const [id, entry] of this.txs) {
			entry.tx.outs.forEach((o, vout) => {
				if (o.script.equals(outputScript)) {
					out.push({
						txidHex: id,
						vout,
						valueSat: BigInt(o.value),
						height: entry.height
					});
				}
			});
		}
		return out;
	}

	async findSpender(txidHex: string, vout: number): Promise<string | null> {
		const spender = this.spenderOf(txidHex, vout);
		return spender && this.unknownTxids.has(spender) ? null : spender;
	}

	async confirmations(txidHex: string): Promise<number | null> {
		if (this.unknownTxids.has(txidHex)) return null;
		const entry = this.txs.get(txidHex);
		if (!entry) return null;
		return entry.height > 0 ? this.height - entry.height + 1 : 0;
	}

	async broadcast(rawHex: string): Promise<string> {
		if (this.failNextBroadcasts > 0) {
			this.failNextBroadcasts--;
			throw new Error('broadcast refused');
		}
		const tx = bitcoin.Transaction.fromHex(rawHex);
		this.broadcasts.push(tx.getId());
		if (!this.txs.has(tx.getId())) this.add(tx, 0);
		return tx.getId();
	}

	async estimateFeeRateSatPerVb(): Promise<number | null> {
		if (this.feeGate) await this.feeGate();
		return this.feeRate;
	}
}
