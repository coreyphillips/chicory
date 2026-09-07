/**
 * LndPeerLink against a fake LND REST API: the exact endpoints, encodings
 * and streaming shape lnd's REST proxy uses for custom messages, with a JIT
 * quote answered from the "LND side" so the whole path is exercised.
 */

import { expect } from 'chai';
import http from 'http';
import { liquidity, message } from 'beignet/lightning';
import { JitClient, LndPeerLink } from '../../src';
import { freePort, waitFor } from '../helpers';

const OUR_ID = '02' + 'aa'.repeat(32);
const LSP_ID = '03' + 'bb'.repeat(32);

interface IFakeLnd {
	port: number;
	calls: Array<{ method: string; path: string; body: unknown }>;
	peers: Set<string>;
	push(peerHex: string, type: number, data: Buffer): void;
	close(): Promise<void>;
}

async function fakeLnd(macaroon: string): Promise<IFakeLnd> {
	const calls: IFakeLnd['calls'] = [];
	const peers = new Set<string>();
	const subscribers = new Set<http.ServerResponse>();
	const server = http.createServer((req, res) => {
		if (req.headers['grpc-metadata-macaroon'] !== macaroon) {
			res.writeHead(401).end('{"message":"permission denied"}');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			const body = raw ? JSON.parse(raw) : undefined;
			calls.push({ method: req.method!, path: req.url!, body });
			const json = (o: unknown, status = 200): void => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(o));
			};
			if (req.method === 'GET' && req.url === '/v1/getinfo') {
				return json({ identity_pubkey: OUR_ID, alias: 'fake-lnd' });
			}
			if (req.method === 'GET' && req.url === '/v1/peers') {
				return json({ peers: [...peers].map((pub_key) => ({ pub_key })) });
			}
			if (req.method === 'POST' && req.url === '/v1/peers') {
				const pk = (body as { addr: { pubkey: string } }).addr.pubkey;
				if (peers.has(pk)) {
					return json(
						{ code: 2, message: `already connected to peer: ${pk}` },
						500
					);
				}
				peers.add(pk);
				return json({});
			}
			if (req.method === 'POST' && req.url === '/v1/custommessage') {
				return json({ status: 'message sent successfully' });
			}
			if (req.method === 'GET' && req.url === '/v1/custommessage/subscribe') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				subscribers.add(res);
				res.on('close', () => subscribers.delete(res));
				return;
			}
			json({ message: 'not found' }, 404);
		});
	});
	const port = await freePort();
	await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
	return {
		port,
		calls,
		peers,
		push: (peerHex, type, data): void => {
			const line = JSON.stringify({
				result: {
					peer: Buffer.from(peerHex, 'hex').toString('base64'),
					type,
					data: data.toString('base64')
				}
			});
			for (const s of subscribers) s.write(line + '\n');
		},
		close: (): Promise<void> => {
			for (const s of subscribers) s.destroy();
			return new Promise((r) => server.close(() => r()));
		}
	};
}

describe('LndPeerLink over a fake LND REST API', function () {
	this.timeout(20_000);

	it('learns its identity, dials, sends base64 custom messages and hears replies', async () => {
		const lnd = await fakeLnd('deadbeef');
		const link = new LndPeerLink({
			host: '127.0.0.1',
			port: lnd.port,
			macaroonHex: 'deadbeef',
			https: false,
			peerRefreshMs: 100_000
		});
		try {
			await link.open();
			expect(link.nodeIdHex()).to.equal(OUR_ID);
			expect(link.isPeerConnected(LSP_ID)).to.equal(false);

			await link.connectPeer(LSP_ID, 'lsp.example', 9735);
			expect(link.isPeerConnected(LSP_ID)).to.equal(true);
			const dial = lnd.calls.find(
				(c) => c.method === 'POST' && c.path === '/v1/peers'
			);
			expect(dial!.body).to.deep.equal({
				addr: { pubkey: LSP_ID, host: 'lsp.example:9735' },
				perm: false,
				timeout: '15'
			});
			// A second dial of a held peer is not an error.
			await link.connectPeer(LSP_ID, 'lsp.example', 9735);

			// Answer JIT quotes from the "LSP" as they arrive at the fake LND.
			await waitFor(
				() => lnd.calls.some((c) => c.path === '/v1/custommessage/subscribe'),
				'the subscription'
			);
			const answer = async (): Promise<void> => {
				await waitFor(
					() => lnd.calls.some((c) => c.path === '/v1/custommessage'),
					'a send'
				);
				const sent = lnd.calls.find((c) => c.path === '/v1/custommessage')!
					.body as {
					peer: string;
					type: number;
					data: string;
				};
				expect(Buffer.from(sent.peer, 'base64').toString('hex')).to.equal(
					LSP_ID
				);
				expect(sent.type).to.equal(message.BEIGNET_CUSTOM_MESSAGE_TYPE);
				const env = message.decodeCustomMessage(
					Buffer.from(sent.data, 'base64')
				);
				expect(env.subtype).to.equal(
					message.BeignetCustomSubtype.JIT_RECEIVE_QUOTE
				);
				const req = liquidity.decodeJitQuoteRequest(env.payload);
				expect(req.maxAmountMsat).to.equal(25_000_000n);
				lnd.push(
					LSP_ID,
					message.BEIGNET_CUSTOM_MESSAGE_TYPE,
					message.encodeCustomMessage(
						message.BeignetCustomSubtype.JIT_RECEIVE_QUOTE_ACK,
						liquidity.encodeJitQuote({
							requestId: req.requestId,
							accepted: true,
							flatFeeSat: 0n,
							feePpm: 0,
							maxClientFundingSats: 1_000_000n,
							fundingSats: 30_000n
						})
					)
				);
			};
			const jit = new JitClient({ link });
			const [quote] = await Promise.all([
				jit.quote(LSP_ID, { maxAmountSat: 25_000, timeoutMs: 5_000 }),
				answer()
			]);
			expect(quote.accepted).to.equal(true);
			expect(quote.fundingSats).to.equal(30_000n);
		} finally {
			await link.close();
			await lnd.close();
		}
	});

	it('ignores other custom message types and unauthenticated deployments fail loudly', async () => {
		const lnd = await fakeLnd('cafe');
		const wrong = new LndPeerLink({
			host: '127.0.0.1',
			port: lnd.port,
			macaroonHex: 'wrong',
			https: false
		});
		let caught: unknown;
		try {
			await wrong.open();
		} catch (err) {
			caught = err;
		}
		expect(String((caught as Error).message)).to.match(/HTTP 401/);
		await wrong.close();

		const link = new LndPeerLink({
			host: '127.0.0.1',
			port: lnd.port,
			macaroonHex: 'cafe',
			https: false,
			peerRefreshMs: 100_000
		});
		try {
			await link.open();
			const seen: number[] = [];
			link.onCustomMessage((m) => seen.push(m.subtype));
			await waitFor(
				() => lnd.calls.some((c) => c.path === '/v1/custommessage/subscribe'),
				'the subscription'
			);
			lnd.push(LSP_ID, 32768, Buffer.from('not ours'));
			lnd.push(
				LSP_ID,
				message.BEIGNET_CUSTOM_MESSAGE_TYPE,
				Buffer.from([0, 1])
			);
			lnd.push(
				LSP_ID,
				message.BEIGNET_CUSTOM_MESSAGE_TYPE,
				message.encodeCustomMessage(7, Buffer.from('hello'))
			);
			await waitFor(() => seen.length === 1, 'exactly one delivery');
			expect(seen).to.deep.equal([7]);
			// A message from a peer proves the connection even before a refresh.
			expect(link.isPeerConnected(LSP_ID)).to.equal(true);
		} finally {
			await link.close();
			await lnd.close();
		}
	});
});
