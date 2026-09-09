/**
 * A scripted ISwapFunder over a MockChain: builds a real transaction paying
 * the address, and records the storage snapshot at the moment it was
 * called so a test can prove the funding attempt was persisted BEFORE the
 * wallet was asked.
 */

import crypto from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { crypto as bcrypto } from 'beignet/lightning';
import { ISwapFunder } from '../../src/swaps/types';
import { IWalletDataStorage } from '../../src/storage';
import { SUBMARINE_SWAP_STORAGE_KEY } from '../../src/swaps/store';
import { MockChain } from './mock-chain';

export class FakeFunder implements ISwapFunder {
	readonly calls: Array<{
		address: string;
		amountSat: bigint;
		label: string;
		/** Whether the record already carried a fundingAttempt when asked. */
		attemptPersistedAtCall: boolean;
	}> = [];
	readonly sent = new Map<string, { txidHex: string; vout: number }>();
	rejectFund = false;
	/** Never answer (the process dies waiting). */
	hang = false;
	/** Pay one sat short. */
	shortValue = false;
	/** Pretend the wallet forgot (findFunding answers null). */
	forgetful = false;

	constructor(
		private readonly chain: MockChain,
		private readonly storage?: IWalletDataStorage
	) {}

	async fund(
		address: string,
		amountSat: bigint,
		opts: { label: string }
	): Promise<{ txidHex: string; vout: number }> {
		let persisted = false;
		if (this.storage) {
			const raw = this.storage.loadWalletData(SUBMARINE_SWAP_STORAGE_KEY);
			if (raw) {
				const doc = JSON.parse(raw) as {
					swaps: Record<
						string,
						{ htlcAddress: string; fundingAttempt?: unknown }
					>;
				};
				persisted = Object.values(doc.swaps).some(
					(r) => r.htlcAddress === address && r.fundingAttempt !== undefined
				);
			}
		}
		this.calls.push({
			address,
			amountSat,
			label: opts.label,
			attemptPersistedAtCall: persisted
		});
		if (this.rejectFund) throw new Error('wallet refused');
		if (this.hang) await new Promise(() => undefined);
		const tx = new bitcoin.Transaction();
		tx.version = 2;
		tx.addInput(crypto.randomBytes(32), 0, 0xfffffffd);
		tx.addOutput(
			bitcoin.address.toOutputScript(address, bitcoin.networks.regtest),
			Number(this.shortValue ? amountSat - 1n : amountSat)
		);
		tx.addOutput(
			bitcoin.payments.p2wpkh({
				pubkey: bcrypto.getPublicKey(crypto.randomBytes(32))
			}).output!,
			9_000
		);
		this.chain.add(tx, 0);
		const sent = { txidHex: tx.getId(), vout: 0 };
		this.sent.set(opts.label, sent);
		return sent;
	}

	async findFunding(
		_address: string,
		label: string
	): Promise<{ txidHex: string; vout: number } | null> {
		if (this.forgetful) return null;
		return this.sent.get(label) ?? null;
	}
}
