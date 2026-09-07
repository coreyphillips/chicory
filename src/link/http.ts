/**
 * The little HTTP the node-backed links need: one JSON request, and one
 * long-lived streaming response read line by line. Node's own http/https,
 * because a self-signed node certificate (LND's tls.cert, clnrest's) has to
 * be pinnable or ignorable per link rather than per process.
 */

import * as http from 'http';
import * as https from 'https';

export interface IHttpEndpoint {
	host: string;
	port: number;
	/** Default true: every LND and clnrest deployment serves TLS. */
	https?: boolean;
	/** PEM certificate(s) to trust. Omitted: the system store. */
	ca?: string | Buffer | Array<string | Buffer>;
	/**
	 * Accept a certificate the trust store does not vouch for. Fine for a
	 * node on localhost; on a network, pin `ca` instead.
	 */
	rejectUnauthorized?: boolean;
	headers?: Record<string, string>;
	/** Request timeout for one-shot calls (default 30 s). */
	timeoutMs?: number;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		message: string
	) {
		super(message);
		this.name = 'HttpError';
	}
}

function transportFor(ep: IHttpEndpoint): typeof http | typeof https {
	return ep.https === false ? http : https;
}

function optionsFor(
	ep: IHttpEndpoint,
	method: string,
	path: string,
	extraHeaders: Record<string, string | number>
): https.RequestOptions {
	const opts: https.RequestOptions = {
		hostname: ep.host,
		port: ep.port,
		path,
		method,
		headers: { ...(ep.headers ?? {}), ...extraHeaders }
	};
	if (ep.https !== false) {
		if (ep.ca !== undefined) opts.ca = ep.ca;
		if (ep.rejectUnauthorized !== undefined) {
			opts.rejectUnauthorized = ep.rejectUnauthorized;
		}
	}
	return opts;
}

/** One JSON request. A non-2xx status rejects with the body attached. */
export function requestJson<T>(
	ep: IHttpEndpoint,
	method: string,
	path: string,
	body?: unknown
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const headers: Record<string, string | number> = {
			Accept: 'application/json'
		};
		if (payload !== undefined) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = Buffer.byteLength(payload);
		}
		const req = transportFor(ep).request(
			optionsFor(ep, method, path, headers),
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					const status = res.statusCode ?? 0;
					if (status < 200 || status >= 300) {
						reject(
							new HttpError(
								status,
								text,
								`${method} ${path} failed: HTTP ${status} ${text.slice(0, 300)}`
							)
						);
						return;
					}
					if (text.trim() === '') {
						resolve(undefined as unknown as T);
						return;
					}
					try {
						resolve(JSON.parse(text) as T);
					} catch {
						reject(
							new HttpError(
								status,
								text,
								`${method} ${path}: response is not JSON`
							)
						);
					}
				});
			}
		);
		req.setTimeout(ep.timeoutMs ?? 30_000, () => {
			req.destroy(new Error(`${method} ${path} timed out`));
		});
		req.on('error', reject);
		if (payload !== undefined) req.write(payload);
		req.end();
	});
}

export interface IStreamHandle {
	close(): void;
	/** Resolves when the stream ends, rejects when it errors. */
	done: Promise<void>;
}

/**
 * A streaming response, delivered one line at a time as it arrives. Used
 * for LND's newline-delimited JSON subscriptions.
 */
export function streamLines(
	ep: IHttpEndpoint,
	method: string,
	path: string,
	onLine: (line: string) => void,
	body?: unknown
): IStreamHandle {
	let req: http.ClientRequest | null = null;
	let closed = false;
	const done = new Promise<void>((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const headers: Record<string, string | number> = {
			Accept: 'application/json'
		};
		if (payload !== undefined) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = Buffer.byteLength(payload);
		}
		req = transportFor(ep).request(
			optionsFor(ep, method, path, headers),
			(res) => {
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					const chunks: Buffer[] = [];
					res.on('data', (c: Buffer) => chunks.push(c));
					res.on('end', () =>
						reject(
							new HttpError(
								status,
								Buffer.concat(chunks).toString('utf8'),
								`${method} ${path} failed: HTTP ${status}`
							)
						)
					);
					return;
				}
				let pending = '';
				res.on('data', (chunk: Buffer) => {
					pending += chunk.toString('utf8');
					let nl = pending.indexOf('\n');
					while (nl >= 0) {
						const line = pending.slice(0, nl).trim();
						pending = pending.slice(nl + 1);
						if (line) onLine(line);
						nl = pending.indexOf('\n');
					}
				});
				res.on('end', () => {
					if (pending.trim()) onLine(pending.trim());
					resolve();
				});
				res.on('error', reject);
			}
		);
		req.on('error', (err) => {
			if (closed) resolve();
			else reject(err);
		});
		if (payload !== undefined) req.write(payload);
		req.end();
	});
	return {
		close: (): void => {
			closed = true;
			req?.destroy();
		},
		done
	};
}
