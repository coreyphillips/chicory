/**
 * A scripted ISwapLightningPayer. `payInvoice` resolves when the test says
 * (settle / fail), and records the storage snapshot at the moment it was
 * called so a test can prove the record was persisted BEFORE the payment.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { crypto as bcrypto } from 'beignet/lightning';
import crypto from 'crypto';
import { ISwapLightningPayer, ISwapPaymentStatus } from '../../src/swaps/types';
import { IWalletDataStorage } from '../../src/storage';
import { REVERSE_SWAP_STORAGE_KEY } from '../../src/swaps/store';

export class FakePayer implements ISwapLightningPayer {
	readonly calls: Array<{
		bolt11: string;
		maxFeeSat: bigint;
		storedStateAtCall: string | null;
	}> = [];
	readonly tracked: string[] = [];
	status = new Map<string, ISwapPaymentStatus>();
	private pending: Array<{
		hash: string;
		resolve: (s: ISwapPaymentStatus) => void;
		reject: (e: Error) => void;
	}> = [];
	readonly destination: Buffer;
	rejectPay = false;

	constructor(private readonly storage?: IWalletDataStorage) {
		this.destination = bitcoin.payments.p2wpkh({
			pubkey: bcrypto.getPublicKey(crypto.randomBytes(32))
		}).output!;
	}

	private hashOf(bolt11: string): string {
		// The tests pass the payment hash through the invoice via the fake
		// provider, which records it; here we look it up by bolt11.
		return FakePayer.hashes.get(bolt11) ?? 'unknown';
	}

	static hashes = new Map<string, string>();

	payInvoice(
		bolt11: string,
		opts: { maxFeeSat: bigint }
	): Promise<ISwapPaymentStatus> {
		let stored: string | null = null;
		if (this.storage) {
			const raw = this.storage.loadWalletData(REVERSE_SWAP_STORAGE_KEY);
			if (raw) {
				const doc = JSON.parse(raw) as {
					swaps: Record<string, { state: string; bolt11: string }>;
				};
				stored =
					Object.values(doc.swaps).find((r) => r.bolt11 === bolt11)?.state ??
					null;
			}
		}
		this.calls.push({
			bolt11,
			maxFeeSat: opts.maxFeeSat,
			storedStateAtCall: stored
		});
		const hash = this.hashOf(bolt11);
		if (this.rejectPay)
			return Promise.reject(new Error('node refused the call'));
		this.status.set(hash, { status: 'pending' });
		return new Promise((resolve, reject) => {
			this.pending.push({ hash, resolve, reject });
		});
	}

	async trackPayment(paymentHash: Buffer): Promise<ISwapPaymentStatus> {
		const hash = paymentHash.toString('hex');
		this.tracked.push(hash);
		return this.status.get(hash) ?? { status: 'unknown' };
	}

	async newDestinationScript(): Promise<Buffer> {
		return this.destination;
	}

	settle(hashHex: string, preimage: Buffer): void {
		const status: ISwapPaymentStatus = { status: 'succeeded', preimage };
		this.status.set(hashHex, status);
		for (const p of this.pending.filter((x) => x.hash === hashHex))
			p.resolve(status);
		this.pending = this.pending.filter((x) => x.hash !== hashHex);
	}

	fail(hashHex: string, reason = 'incorrect_or_unknown_payment_details'): void {
		const status: ISwapPaymentStatus = {
			status: 'failed',
			failureReason: reason
		};
		this.status.set(hashHex, status);
		for (const p of this.pending.filter((x) => x.hash === hashHex))
			p.resolve(status);
		this.pending = this.pending.filter((x) => x.hash !== hashHex);
	}
}
