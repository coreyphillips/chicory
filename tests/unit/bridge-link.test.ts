/**
 * BridgePeerLink against a fake bridge: the five routes an LDK application
 * serves, with a JIT ack pushed back over the SSE stream.
 */

import { expect } from 'chai';
import http from 'http';
import { liquidity, message } from 'beignet/lightning';
import { BridgePeerLink, JitClient } from '../../src';
import { freePort, waitFor } from '../helpers';

const OUR_ID = '02' + 'ee'.repeat(32);
const LSP_ID = '03' + 'ff'.repeat(32);

async function fakeBridge(token: string): Promise<{
	port: number;
	calls: Array<{ method: string; path: string; body: Record<string, unknown> }>;
	push(frame: { peer: string; type: number; payload: string }): void;
	close(): Promise<void>;
}> {
	const calls: Array<{
		method: string;
		path: string;
		body: Record<string, unknown>;
	}> = [];
	const peers = new Set<string>();
	const streams = new Set<http.ServerResponse>();
	const server = http.createServer((req, res) => {
		if (req.headers.authorization !== `Bearer ${token}`) {
			res.writeHead(401).end('{"error":"bad token"}');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
			calls.push({ method: req.method!, path: req.url!, body });
			const json = (o: unknown): void => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(o));
			};
			switch (`${req.method} ${req.url}`) {
				case 'GET /info':
					return json({ nodeId: OUR_ID });
				case 'GET /peers':
					return json({ peers: [...peers] });
				case 'POST /connect':
					peers.add(String(body.pubkey));
					return json({});
				case 'POST /send':
					return json({});
				case 'GET /events':
					res.writeHead(200, { 'Content-Type': 'text/event-stream' });
					res.write(': ready\n\n');
					streams.add(res);
					res.on('close', () => streams.delete(res));
					return;
				default:
					res.writeHead(404);
					return res.end('{}');
			}
		});
	});
	const port = await freePort();
	await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
	return {
		port,
		calls,
		push: (frame): void => {
			for (const s of streams)
				s.write(`event: message\ndata: ${JSON.stringify(frame)}\n\n`);
		},
		close: (): Promise<void> => {
			for (const s of streams) s.destroy();
			return new Promise((r) => server.close(() => r()));
		}
	};
}

describe('BridgePeerLink over a fake LDK bridge', function () {
	this.timeout(20_000);

	it('speaks the five routes and completes a JIT authorization', async () => {
		const bridge = await fakeBridge('secret');
		const link = new BridgePeerLink({
			host: '127.0.0.1',
			port: bridge.port,
			token: 'secret',
			peerRefreshMs: 100_000
		});
		try {
			await link.open();
			expect(link.nodeIdHex()).to.equal(OUR_ID);
			await link.connectPeer(LSP_ID, 'lsp.example', 9735);
			expect(
				bridge.calls.find((c) => c.path === '/connect')!.body
			).to.deep.equal({
				pubkey: LSP_ID,
				host: 'lsp.example',
				port: 9735
			});
			expect(link.isPeerConnected(LSP_ID)).to.equal(true);
			await waitFor(
				() => bridge.calls.some((c) => c.path === '/events'),
				'the event stream'
			);

			const answer = async (): Promise<void> => {
				await waitFor(
					() => bridge.calls.some((c) => c.path === '/send'),
					'a send'
				);
				const sent = bridge.calls.find((c) => c.path === '/send')!.body as {
					peer: string;
					type: number;
					payload: string;
				};
				expect(sent.peer).to.equal(LSP_ID);
				expect(sent.type).to.equal(message.BEIGNET_CUSTOM_MESSAGE_TYPE);
				const env = message.decodeCustomMessage(
					Buffer.from(sent.payload, 'hex')
				);
				expect(env.subtype).to.equal(
					message.BeignetCustomSubtype.JIT_RECEIVE_AUTHORIZATION
				);
				const auth = liquidity.decodeJitAuthorization(env.payload);
				bridge.push({
					peer: LSP_ID,
					type: message.BEIGNET_CUSTOM_MESSAGE_TYPE,
					payload: message
						.encodeCustomMessage(
							message.BeignetCustomSubtype.JIT_RECEIVE_ACK,
							liquidity.encodeJitAck({
								requestId: auth.requestId,
								interceptScid: Buffer.from('ffffff0000aa00bb', 'hex'),
								accepted: true,
								flatFeeSat: 100n,
								feePpm: 1_000,
								feeMode: 'hop'
							})
						)
						.toString('hex')
				});
			};
			const jit = new JitClient({ link });
			const [grant] = await Promise.all([
				jit.authorize(LSP_ID, { maxAmountSat: 70_000, timeoutMs: 5_000 }),
				answer()
			]);
			expect(grant.interceptScidHex).to.equal('ffffff0000aa00bb');
			expect(grant.feeMode).to.equal('hop');
			expect(grant.routeHint.feeBaseMsat).to.equal(100_000);
		} finally {
			await link.close();
			await bridge.close();
		}
	});

	it('refuses to open without the bridge token', async () => {
		const bridge = await fakeBridge('secret');
		const link = new BridgePeerLink({
			host: '127.0.0.1',
			port: bridge.port,
			token: 'nope'
		});
		let caught: unknown;
		try {
			await link.open();
		} catch (err) {
			caught = err;
		}
		expect(String((caught as Error).message)).to.match(/HTTP 401/);
		await link.close();
		await bridge.close();
	});
});
