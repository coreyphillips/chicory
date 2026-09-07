/**
 * Pure checks a client runs before it pays and before it claims. No I/O:
 * the caller supplies what it sent, what came back, its own height and its
 * policy, and gets a verdict or a typed SwapError.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { crypto as bcrypto, swaps } from 'beignet/lightning';
import { ChicoryNetwork, toBeignetNetwork } from '../types';
import { ISwapChainOutput, ISwapClientPolicy, SwapError } from './types';

export interface IVerifiedReverseTerms {
	htlc: swaps.ISwapHtlc;
	address: string;
	outputScript: Buffer;
	invoiceAmountMsat: bigint;
	invoiceExpiresAt: number;
	totalFeeSat: bigint;
}

export interface IVerifyReverseAckParams {
	create: swaps.ISwapCreate;
	ack: swaps.ISwapCreateAck;
	currentHeight: number;
	network: ChicoryNetwork;
	policy: ISwapClientPolicy;
	/** The most this client will pay above the on-chain amount. */
	maxTotalFeeSat: bigint;
}

/**
 * The ack must describe the swap the client asked for and nothing else:
 * beignet's own verifier rebuilds the contract and checks the invoice and
 * amounts; this adds the swap id, the refund key and the client's policy.
 */
export function verifyReverseAck(
	params: IVerifyReverseAckParams
): IVerifiedReverseTerms {
	const { ack, create } = params;
	if (!ack.accepted || !ack.terms) {
		throw new SwapError(
			`provider declined: ${swaps.SwapRefusalReason[ack.reason] ?? ack.reason}${
				ack.reasonText ? ` (${ack.reasonText})` : ''
			}`,
			'provider_declined'
		);
	}
	const terms = ack.terms;
	if (terms.swapId.length !== 16 || terms.swapId.equals(Buffer.alloc(16))) {
		throw new SwapError('ack carries no swap id', 'ack_mismatch');
	}
	if (!bcrypto.isValidPublicKey(terms.refundPubkey)) {
		throw new SwapError('refund key is not a valid public key', 'ack_mismatch');
	}
	const delta = terms.refundHeight - params.currentHeight;
	if (delta < params.policy.minRefundDeltaBlocks) {
		throw new SwapError(
			`refund height ${terms.refundHeight} is only ${delta} blocks away (policy minimum ${params.policy.minRefundDeltaBlocks})`,
			'refund_too_soon'
		);
	}
	if (delta > params.policy.maxRefundDeltaBlocks) {
		throw new SwapError(
			`refund height ${terms.refundHeight} is ${delta} blocks away (policy maximum ${params.policy.maxRefundDeltaBlocks})`,
			'refund_too_late'
		);
	}
	const verdict = swaps.verifyReverseSwapTerms({
		create,
		ack,
		currentHeight: params.currentHeight,
		network: toBeignetNetwork(params.network),
		minRefundDelta: params.policy.minRefundDeltaBlocks,
		maxRefundDelta: params.policy.maxRefundDeltaBlocks,
		maxTotalFeeSat: params.maxTotalFeeSat
	});
	if (!verdict.ok) {
		throw new SwapError(verdict.reason, 'ack_mismatch');
	}
	return {
		htlc: verdict.htlc,
		address: verdict.address,
		outputScript: verdict.outputScript,
		invoiceAmountMsat: verdict.invoice.amountMsat,
		invoiceExpiresAt: verdict.invoice.expiresAt,
		totalFeeSat: terms.totalFeeSat
	};
}

export type FundingVerdict =
	| { ok: true; valueSat: bigint; confirmations: number; height: number }
	| {
			ok: false;
			reason: 'txid_mismatch' | 'wrong_script' | 'insufficient_value' | 'spent';
	  };

/**
 * A funding output counts only when the bytes hash to the txid the chain
 * named, the output pays the contract script exactly, its value covers the
 * amount, and it is still unspent.
 */
export function verifyFundingOutput(params: {
	txidHex: string;
	tx: bitcoin.Transaction;
	vout: number;
	outputScript: Buffer;
	onchainAmountSat: bigint;
	output: ISwapChainOutput | null;
}): FundingVerdict {
	if (params.tx.getId() !== params.txidHex)
		return { ok: false, reason: 'txid_mismatch' };
	const out = params.tx.outs[params.vout];
	if (!out || !out.script.equals(params.outputScript)) {
		return { ok: false, reason: 'wrong_script' };
	}
	if (BigInt(out.value) < params.onchainAmountSat) {
		return { ok: false, reason: 'insufficient_value' };
	}
	if (!params.output) return { ok: false, reason: 'spent' };
	if (!params.output.script.equals(params.outputScript)) {
		return { ok: false, reason: 'wrong_script' };
	}
	return {
		ok: true,
		valueSat: BigInt(out.value),
		confirmations: params.output.confirmations,
		height: params.output.height
	};
}

/** A native P2WPKH, P2WSH or P2TR script, the only claim destinations. */
export function assertNativeSegwit(script: Buffer): Buffer {
	const ok =
		(script.length === 22 && script[0] === 0x00 && script[1] === 0x14) ||
		(script.length === 34 &&
			(script[0] === 0x00 || script[0] === 0x51) &&
			script[1] === 0x20);
	if (!ok) {
		throw new SwapError(
			'claim destination must be a native P2WPKH, P2WSH or P2TR script',
			'destination'
		);
	}
	return script;
}

export function toOutputScript(
	address: string,
	network: ChicoryNetwork
): Buffer {
	const net =
		network === 'mainnet'
			? bitcoin.networks.bitcoin
			: network === 'regtest'
			? bitcoin.networks.regtest
			: bitcoin.networks.testnet;
	return assertNativeSegwit(bitcoin.address.toOutputScript(address, net));
}

/** Is this witness the provider's refund branch of our contract? */
export function isRefundWitness(
	witness: Buffer[],
	witnessScript: Buffer
): boolean {
	return (
		witness.length === 3 &&
		witness[1].length === 0 &&
		witness[2].equals(witnessScript)
	);
}
