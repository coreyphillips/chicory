/**
 * ISwapLightningPayer over Core Lightning's clnrest.
 *
 * `pay` blocks until the payment resolves, and a hold invoice resolves when
 * the swap does, so the request is sent with a day-long timeout; if the
 * socket still drops, `trackPayment` (listpays) answers. Rune needs pay,
 * listpays and newaddr.
 */

import { ChicoryLog, ChicoryNetwork, noopLog } from '../types';
import { HttpError, IHttpEndpoint, requestJson } from '../link/http';
import { toOutputScript } from './verify';
import { ISwapLightningPayer, ISwapPaymentStatus } from './types';

export interface IClnPayerOptions {
	host: string;
	/** clnrest port (default 3010). */
	port?: number;
	rune: string;
	network: ChicoryNetwork;
	https?: boolean;
	ca?: IHttpEndpoint['ca'];
	rejectUnauthorized?: boolean;
	log?: ChicoryLog;
}

interface IClnPay {
	payment_hash: string;
	status: string;
	preimage?: string;
	payment_preimage?: string;
}

function mapStatus(p: IClnPay): ISwapPaymentStatus {
	const preimageHex = p.payment_preimage ?? p.preimage;
	if (p.status === 'complete') {
		return {
			status: 'succeeded',
			preimage: preimageHex ? Buffer.from(preimageHex, 'hex') : undefined
		};
	}
	if (p.status === 'failed') return { status: 'failed' };
	return { status: 'pending' };
}

const HOLD_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** The message of a CLN RPC error (`{code, message}` body), else null. */
function clnRpcError(err: unknown): string | null {
	if (!(err instanceof HttpError)) return null;
	try {
		const body = JSON.parse(err.body) as { code?: unknown; message?: unknown };
		if (typeof body.code === 'number' && typeof body.message === 'string') {
			return body.message;
		}
	} catch {
		/* not a JSON body */
	}
	return null;
}

export class ClnPayer implements ISwapLightningPayer {
	private readonly ep: IHttpEndpoint;
	private readonly log: ChicoryLog;

	constructor(private readonly options: IClnPayerOptions) {
		this.ep = {
			host: options.host,
			port: options.port ?? 3010,
			https: options.https,
			ca: options.ca,
			rejectUnauthorized: options.rejectUnauthorized,
			headers: { Rune: options.rune }
		};
		this.log = options.log ?? noopLog;
	}

	private rpc<T>(
		method: string,
		params: Record<string, unknown>,
		timeoutMs?: number
	): Promise<T> {
		const ep = timeoutMs === undefined ? this.ep : { ...this.ep, timeoutMs };
		return requestJson<T>(ep, 'POST', `/v1/${method}`, params);
	}

	async payInvoice(
		bolt11: string,
		opts: { maxFeeSat: bigint; timeoutSeconds: number }
	): Promise<ISwapPaymentStatus> {
		try {
			const res = await this.rpc<IClnPay>(
				'pay',
				{
					bolt11,
					maxfee: `${(opts.maxFeeSat * 1000n).toString()}msat`,
					retry_for: opts.timeoutSeconds
				},
				HOLD_REQUEST_TIMEOUT_MS
			);
			return mapStatus(res);
		} catch (err) {
			// Only CLN's own verdict fails the payment: an RPC error body
			// with a code is one. A dropped connection or a timeout is not:
			// the HTLC may be in flight, and listpays decides on the next
			// tick.
			const verdict = clnRpcError(err);
			if (verdict) {
				this.log('cln_pay_error', { error: verdict });
				return { status: 'failed', failureReason: verdict };
			}
			this.log('cln_pay_unresolved', {
				error: err instanceof Error ? err.message : String(err)
			});
			return { status: 'unknown' };
		}
	}

	async trackPayment(paymentHash: Buffer): Promise<ISwapPaymentStatus> {
		const hashHex = paymentHash.toString('hex');
		const res = await this.rpc<{ pays: IClnPay[] }>('listpays', {
			payment_hash: hashHex
		});
		const found = res.pays.find((p) => p.payment_hash === hashHex);
		return found ? mapStatus(found) : { status: 'unknown' };
	}

	async newDestinationScript(): Promise<Buffer> {
		const res = await this.rpc<{ bech32: string }>('newaddr', {
			addresstype: 'bech32'
		});
		return toOutputScript(res.bech32, this.options.network);
	}
}
