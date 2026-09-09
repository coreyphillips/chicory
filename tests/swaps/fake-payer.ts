/**
 * A scripted ISwapLightningPayer. `payInvoice` resolves when the test says
 * (settle / fail), and records the storage snapshot at the moment it was
 * called so a test can prove the record was persisted BEFORE the payment.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
	crypto as bcrypto,
	invoice as beignetInvoice
} from 'beignet/lightning';
import crypto from 'crypto';
import {
	ISwapCreateInvoiceParams,
	ISwapCreatedInvoice,
	ISwapInvoiceStatus,
	ISwapLightningPayer,
	ISwapPaymentStatus
} from '../../src/swaps/types';
import { IWalletDataStorage } from '../../src/storage';
import { REVERSE_SWAP_STORAGE_KEY } from '../../src/swaps/store';

/** An invoice this fake node holds (submarine swaps). */
export interface IFakeInvoice {
	preimage: Buffer;
	bolt11: string;
	amountMsat: bigint;
	minFinalCltv: number;
	expiresAt: number;
	state: ISwapInvoiceStatus['state'];
	htlcsInFlight: number;
}

export class FakePayer implements ISwapLightningPayer {
	/** The node's identity, which signs the invoices it mints. */
	readonly nodeKey = crypto.randomBytes(32);
	readonly invoices = new Map<string, IFakeInvoice>();
	readonly invoiceCalls: ISwapCreateInvoiceParams[] = [];
	readonly lookups: string[] = [];
	rejectCreateInvoice = false;
	lookupThrows = false;
	/** Mint with this final CLTV whatever was asked (a node that ignores the field). */
	createdCltvOverride: number | null = null;
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

	// ─────────────── invoices (submarine swaps) ───────────────

	private mint(
		amountMsat: bigint,
		minFinalCltv: number,
		expirySeconds: number,
		description = 'submarine swap'
	): IFakeInvoice {
		const preimage = crypto.randomBytes(32);
		const paymentHash = crypto.createHash('sha256').update(preimage).digest();
		const timestamp = Math.floor(Date.now() / 1000);
		const bolt11 = beignetInvoice.encode({
			network: beignetInvoice.Network.REGTEST,
			amountMsat,
			timestamp,
			paymentHash,
			paymentSecret: crypto.randomBytes(32),
			description,
			expiry: expirySeconds,
			minFinalCltvExpiry: minFinalCltv,
			privateKey: this.nodeKey
		});
		const inv: IFakeInvoice = {
			preimage,
			bolt11,
			amountMsat,
			minFinalCltv,
			expiresAt: timestamp + expirySeconds,
			state: 'open',
			htlcsInFlight: 0
		};
		this.invoices.set(paymentHash.toString('hex'), inv);
		return inv;
	}

	async createInvoice(
		params: ISwapCreateInvoiceParams
	): Promise<ISwapCreatedInvoice> {
		this.invoiceCalls.push(params);
		if (this.rejectCreateInvoice) throw new Error('node refused to invoice');
		const inv = this.mint(
			params.amountMsat,
			this.createdCltvOverride ?? params.minFinalCltvExpiry,
			params.expirySeconds,
			params.description
		);
		return {
			bolt11: inv.bolt11,
			paymentHash: crypto.createHash('sha256').update(inv.preimage).digest()
		};
	}

	async lookupInvoice(paymentHash: Buffer): Promise<ISwapInvoiceStatus> {
		const hashHex = paymentHash.toString('hex');
		this.lookups.push(hashHex);
		if (this.lookupThrows) throw new Error('node unreachable');
		const inv = this.invoices.get(hashHex);
		if (!inv) return { state: 'unknown' };
		return {
			state: inv.state,
			preimage: inv.state === 'settled' ? inv.preimage : undefined,
			htlcsInFlight: inv.htlcsInFlight
		};
	}

	/** A bolt11 this node owns, for the "caller-supplied invoice" cases. */
	supplyInvoice(
		amountMsat: bigint,
		minFinalCltv = 40,
		expirySeconds = 7200
	): string {
		return this.mint(amountMsat, minFinalCltv, expirySeconds).bolt11;
	}

	hashOfInvoice(bolt11: string): string {
		for (const [hash, inv] of this.invoices)
			if (inv.bolt11 === bolt11) return hash;
		throw new Error('unknown invoice');
	}

	acceptInvoice(hashHex: string, parts = 1): void {
		const inv = this.invoices.get(hashHex)!;
		inv.state = 'accepted';
		inv.htlcsInFlight = parts;
	}

	releaseInvoice(hashHex: string): void {
		const inv = this.invoices.get(hashHex)!;
		inv.state = 'open';
		inv.htlcsInFlight = 0;
	}

	settleInvoice(hashHex: string): Buffer {
		const inv = this.invoices.get(hashHex)!;
		inv.state = 'settled';
		inv.htlcsInFlight = 0;
		return inv.preimage;
	}

	expireInvoice(hashHex: string): void {
		const inv = this.invoices.get(hashHex)!;
		inv.state = 'expired';
		inv.htlcsInFlight = 0;
	}

	forgetInvoice(hashHex: string): void {
		this.invoices.delete(hashHex);
	}
}
