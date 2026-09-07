/**
 * Reverse swaps, client side: the shapes and the two seams.
 *
 * A reverse swap moves Lightning balance to the chain: this client pays a
 * beignet provider's hold invoice for a hash it holds the preimage of, the
 * provider funds a P2WSH contract the client can claim with that preimage,
 * and the claim's witness (mempool or block) is what lets the provider
 * settle the hold. Nothing in chicory settles or holds an invoice; the
 * provider does that.
 *
 * Two seams a host supplies, because an LND or CLN wallet can pay an
 * invoice and hand out an address but cannot watch the chain or broadcast:
 *
 *  - ISwapLightningPayer: fire a payment (it blocks for as long as the hold
 *    does), report a payment's status by hash, give a claim destination.
 *  - ISwapChain: height, raw transactions, one outpoint's unspent-ness and
 *    depth, broadcast. Bitcoin Core's RPC or any beignet IChainBackend.
 *
 * The same chain seam serves submarine swaps later; the Lightning seam then
 * grows invoice creation.
 */

import { ChicoryNetwork } from '../types';

export interface ISwapPaymentStatus {
	status: 'unknown' | 'pending' | 'succeeded' | 'failed';
	preimage?: Buffer;
	failureReason?: string;
}

export interface ISwapLightningPayer {
	/**
	 * Fire the payment. Resolves on a TERMINAL report from the node, which
	 * for a hold invoice means when the swap resolves; never awaited on the
	 * hot path.
	 */
	payInvoice(
		bolt11: string,
		opts: { maxFeeSat: bigint; timeoutSeconds: number }
	): Promise<ISwapPaymentStatus>;
	/** Point-in-time status by payment hash. */
	trackPayment(paymentHash: Buffer): Promise<ISwapPaymentStatus>;
	/** A fresh native-segwit output script of the paying node's wallet. */
	newDestinationScript?(): Promise<Buffer>;
}

export interface ISwapChainOutput {
	valueSat: bigint;
	script: Buffer;
	confirmations: number;
	/** 0 while in the mempool. */
	height: number;
}

export interface ISwapFundingCandidate {
	txidHex: string;
	vout: number;
	valueSat: bigint;
	height: number;
}

export interface ISwapChain {
	currentHeight(): Promise<number>;
	/** Raw bytes, or null when unknown to this source. A height hint helps a pruned Core. */
	getTransaction(txidHex: string, heightHint?: number): Promise<Buffer | null>;
	/** The outpoint while UNSPENT (gettxout semantics); null once spent or unknown. */
	getOutput(txidHex: string, vout: number): Promise<ISwapChainOutput | null>;
	/** Optional: outputs paying a script (Electrum listunspent). */
	findOutputs?(outputScript: Buffer): Promise<ISwapFundingCandidate[]>;
	/** Optional: the txid that spent an outpoint, when the source can answer. */
	findSpender?(
		txidHex: string,
		vout: number,
		outputScript: Buffer
	): Promise<string | null>;
	/**
	 * Confirmations of a transaction; 0 in the mempool; null when unknown.
	 * `heightHint` is where the caller last knew the transaction to be (its
	 * broadcast or confirmation height), for a source that has to scan
	 * blocks to find a mined transaction.
	 */
	confirmations(txidHex: string, heightHint?: number): Promise<number | null>;
	broadcast(rawHex: string): Promise<string>;
	estimateFeeRateSatPerVb?(targetBlocks: number): Promise<number | null>;
}

export interface ISwapClientPolicy {
	/** Refuse terms whose refund height is closer than this to our tip. */
	minRefundDeltaBlocks: number;
	maxRefundDeltaBlocks: number;
	/**
	 * The FIRST claim (the disclosure of the preimage) is refused once the
	 * tip is within this of the refund height: past it the provider could
	 * learn the preimage, settle the Lightning side, and still win the
	 * output with a refund that confirms first. A claim already out keeps
	 * being followed and bumped, since the preimage is public anyway.
	 */
	claimSafetyBlocks: number;
	/**
	 * Confirmations the funding needs before a claim is broadcast. The claim
	 * reveals the preimage in the mempool, and a provider that learns it
	 * settles the hold; an unconfirmed funding it could then replace would
	 * leave the client paid on Lightning and empty on chain. Never below 1.
	 */
	minFundingConfirmations: number;
	defaultFeeRateSatPerVb: number;
	maxClaimFeeSat: bigint;
	/** Blocks an unconfirmed claim waits before a rebuild at a higher rate. */
	bumpAfterBlocks: number;
	bumpFactor: number;
	/** Lightning fee ceiling as parts per million of the invoice, and a floor in sats. */
	maxLightningFeePpm: number;
	minLightningFeeSat: bigint;
	/** Route-search budget handed to the payer; not the hold's lifetime. */
	paymentTimeoutSeconds: number;
	statusPollMs: number;
	chainPollMs: number;
	replyTimeoutMs: number;
}

export const SWAP_DEFAULT_POLICY: ISwapClientPolicy = {
	minRefundDeltaBlocks: 36,
	maxRefundDeltaBlocks: 4320,
	claimSafetyBlocks: 6,
	minFundingConfirmations: 1,
	defaultFeeRateSatPerVb: 2,
	maxClaimFeeSat: 10_000n,
	bumpAfterBlocks: 3,
	bumpFactor: 1.5,
	maxLightningFeePpm: 10_000,
	minLightningFeeSat: 10n,
	paymentTimeoutSeconds: 600,
	statusPollMs: 10_000,
	chainPollMs: 15_000,
	replyTimeoutMs: 15_000
};

export function resolvePolicy(
	overrides: Partial<ISwapClientPolicy> = {}
): ISwapClientPolicy {
	const policy = { ...SWAP_DEFAULT_POLICY, ...overrides };
	if (
		!Number.isInteger(policy.minFundingConfirmations) ||
		policy.minFundingConfirmations < 1
	) {
		throw new SwapError(
			'minFundingConfirmations must be at least 1: a claim reveals the preimage',
			'policy'
		);
	}
	if (
		policy.minRefundDeltaBlocks < 1 ||
		policy.maxRefundDeltaBlocks < policy.minRefundDeltaBlocks
	) {
		throw new SwapError(
			'refund delta bounds must satisfy 1 <= min <= max',
			'policy'
		);
	}
	return policy;
}

export type ReverseSwapState =
	| 'CREATED'
	| 'PAYING'
	| 'FUNDED'
	| 'CLAIM_BROADCAST'
	| 'CLAIMED'
	| 'PAYMENT_FAILED'
	| 'EXPIRED';

export function isTerminalReverseSwapState(state: ReverseSwapState): boolean {
	return (
		state === 'CLAIMED' || state === 'PAYMENT_FAILED' || state === 'EXPIRED'
	);
}

export interface IReverseSwapClaimAttempt {
	txidHex: string;
	rawHex: string;
	feeSat: string;
	feeRateSatPerVb: number;
	builtAt: number;
	broadcastAt?: number;
	broadcastHeight?: number;
}

/**
 * One swap as this device knows it. Holds the claim key and the preimage:
 * a claim after a crash needs exactly those and nothing else. Bigints are
 * decimal strings and buffers hex, so the record is plain JSON.
 */
export interface IReverseSwapRecord {
	version: 1;
	swapIdHex: string;
	providerNodeIdHex: string;
	network: ChicoryNetwork;
	createdAt: number;
	createdHeight: number;
	paymentHashHex: string;
	preimageHex: string;
	claimPrivkeyHex: string;
	claimPubkeyHex: string;
	refundPubkeyHex: string;
	refundHeight: number;
	htlcAddress: string;
	htlcOutputScriptHex: string;
	onchainAmountSat: string;
	invoiceAmountMsat: string;
	totalFeeSat: string;
	bolt11: string;
	invoiceExpiresAt: number;
	providerFundingConfirmations: number;
	destinationScriptHex: string;
	state: ReverseSwapState;
	payment?: {
		startedAt: number;
		status: ISwapPaymentStatus['status'];
		preimageHex?: string;
		failureReason?: string;
	};
	funding?: {
		txidHex: string;
		vout: number;
		valueSat: string;
		firstSeenHeight: number;
		confirmedHeight?: number;
	};
	claim?: {
		attempts: IReverseSwapClaimAttempt[];
		confirmedTxidHex?: string;
		confirmedHeight?: number;
	};
	resolution?: { kind: 'claim' | 'refund' | 'other'; txidHex: string };
	/** Set when the first claim was refused for being past the deadline. */
	claimDeadlinePassedAt?: number;
	lastError?: string;
	updatedAt: number;
}

export type SwapErrorCode =
	| 'policy'
	| 'provider_declined'
	| 'ack_mismatch'
	| 'refund_too_soon'
	| 'refund_too_late'
	| 'not_configured'
	| 'funding_invalid'
	| 'destination'
	| 'fee'
	| 'timeout'
	| 'deadline'
	| 'funding_unconfirmed'
	| 'storage'
	| 'state';

export class SwapError extends Error {
	constructor(
		message: string,
		readonly code: SwapErrorCode
	) {
		super(message);
		this.name = 'SwapError';
	}
}

/** A swap moved from one state to another; the record is the new one. */
export interface IReverseSwapChange {
	swapIdHex: string;
	from: ReverseSwapState;
	to: ReverseSwapState;
	record: IReverseSwapRecord;
}
