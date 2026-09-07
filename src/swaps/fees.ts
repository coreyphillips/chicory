/**
 * Claim fees. The claim is a fixed-shape transaction (one P2WSH input with a
 * four-item witness, one native-segwit output), so its size is known once
 * built; the fee is the rate times that size, with two virtual bytes of
 * padding for the signature's DER length varying between builds.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ISwapClientPolicy, SwapError } from './types';

export interface IBuiltClaim {
	tx: bitcoin.Transaction;
	feeSat: bigint;
	feeRateSatPerVb: number;
}

const SIGNATURE_PAD_VBYTES = 2;

export function claimFeeForRate(
	build: (feeSat: bigint) => bitcoin.Transaction,
	feeRateSatPerVb: number,
	policy: ISwapClientPolicy
): IBuiltClaim {
	if (!(feeRateSatPerVb > 0)) {
		throw new SwapError('fee rate must be positive', 'fee');
	}
	let probe: bitcoin.Transaction;
	try {
		probe = build(1_000n);
	} catch (err) {
		throw new SwapError(
			`claim does not build: ${
				err instanceof Error ? err.message : String(err)
			}`,
			'fee'
		);
	}
	const vsize = probe.virtualSize() + SIGNATURE_PAD_VBYTES;
	let feeSat = BigInt(Math.ceil(vsize * feeRateSatPerVb));
	if (feeSat > policy.maxClaimFeeSat) feeSat = policy.maxClaimFeeSat;
	let tx: bitcoin.Transaction;
	try {
		tx = build(feeSat);
	} catch (err) {
		throw new SwapError(
			`claim does not build at ${feeSat} sat: ${
				err instanceof Error ? err.message : String(err)
			}`,
			'fee'
		);
	}
	return { tx, feeSat, feeRateSatPerVb: Number(feeSat) / tx.virtualSize() };
}

/** The next rate after an unconfirmed claim: the bump factor, and at least +1 sat/vB. */
export function bumpedFeeRate(
	previous: number,
	policy: ISwapClientPolicy
): number {
	return Math.max(previous * policy.bumpFactor, previous + 1);
}

/** BIP 125: a replacement pays at least the old fee plus its own size at 1 sat/vB. */
export function replacementFloor(
	previousFeeSat: bigint,
	vsize: number
): bigint {
	return previousFeeSat + BigInt(vsize);
}
