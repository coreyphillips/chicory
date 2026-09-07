/**
 * ClnPeerLink against a fake clnrest: rune-authenticated JSON-RPC over
 * HTTP, and the `custommsg` notification over a rune-authenticated
 * Socket.IO stream, with a JIT ack answered from the "CLN side".
 */

import { expect } from 'chai';
import http from 'http';
import { WebSocketServer } from 'ws';
import { liquidity, message } from 'beignet/lightning';
import { ClnPeerLink, JitClient } from '../../src';
import { freePort, waitFor } from '../helpers';

const OUR_ID = '02' + 'cc'.repeat(32);
const LSP_ID = '03' + 'dd'.repeat(32);

async function fakeCln(rune: string): Promise<{
	port: number;
	calls: Array<{ path: string; body: Record<string, unknown> }>;
	notify(event: unknown): void;
	close(): Promise<void>;
}> {
	const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
	const peers = new Set<string>();
	const server = http.createServer((req, res) => {
		if (req.headers.rune !== rune) {
			res.writeHead(401).end('{"error":"invalid rune"}');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
			calls.push({ path: req.url!, body });
			res.setHeader('Content-Type', 'application/json');
			switch (req.url) {
				case '/v1/getinfo':
					return res.end(JSON.stringify({ id: OUR_ID }));
				case '/v1/listpeers':
					return res.end(
						JSON.stringify({
							peers: [...peers].map((id) => ({ id, connected: true }))
						})
					);
				case '/v1/connect':
					peers.add(String(body.id));
					return res.end(JSON.stringify({ id: body.id, direction: 'out' }));
				case '/v1/sendcustommsg':
					return res.end(
						JSON.stringify({ status: 'Message sent to subdaemon for delivery' })
					);
				default:
					res.writeHead(404);
					return res.end('{}');
			}
		});
	});
	// clnrest's stream is Socket.IO: an engine.io open packet, the client's
	// namespace connect (`40`) acknowledged, pings, and `42["message", ...]`
	// events carrying each notification.
	const wss = new WebSocketServer({ server, path: '/socket.io/' });
	wss.on('connection', (socket, req) => {
		if (req.headers.rune !== rune) {
			socket.close();
			return;
		}
		socket.send(
			'0{"sid":"fake","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":100000}'
		);
		socket.on('message', (data) => {
			if (String(data) === '40') socket.send('40{"sid":"fake"}');
			if (String(data) === '2') socket.send('3');
		});
	});
	const port = await freePort();
	await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
	return {
		port,
		calls,
		notify: (event): void => {
			for (const c of wss.clients)
				c.send(`42${JSON.stringify(['message', event])}`);
		},
		close: (): Promise<void> =>
			new Promise((r) => {
				for (const c of wss.clients) c.terminate();
				wss.close(() => server.close(() => r()));
			})
	};
}

describe('ClnPeerLink over a fake clnrest', function () {
	this.timeout(20_000);

	it('dials, sends hex custom messages with the type prefix, and hears custommsg notifications', async () => {
		const cln = await fakeCln('rune-abc');
		const link = new ClnPeerLink({
			host: '127.0.0.1',
			port: cln.port,
			rune: 'rune-abc',
			https: false,
			peerRefreshMs: 100_000
		});
		try {
			await link.open();
			expect(link.nodeIdHex()).to.equal(OUR_ID);
			await link.connectPeer(LSP_ID, 'lsp.example', 9735);
			expect(
				cln.calls.find((c) => c.path === '/v1/connect')!.body
			).to.deep.equal({
				id: LSP_ID,
				host: 'lsp.example',
				port: 9735
			});
			expect(link.isPeerConnected(LSP_ID)).to.equal(true);

			const answer = async (): Promise<void> => {
				await waitFor(
					() => cln.calls.some((c) => c.path === '/v1/sendcustommsg'),
					'a send'
				);
				const sent = cln.calls.find((c) => c.path === '/v1/sendcustommsg')!
					.body as {
					node_id: string;
					msg: string;
				};
				expect(sent.node_id).to.equal(LSP_ID);
				const raw = Buffer.from(sent.msg, 'hex');
				expect(raw.readUInt16BE(0)).to.equal(
					message.BEIGNET_CUSTOM_MESSAGE_TYPE
				);
				const env = message.decodeCustomMessage(raw.subarray(2));
				expect(env.subtype).to.equal(
					message.BeignetCustomSubtype.JIT_RECEIVE_AUTHORIZATION
				);
				const auth = liquidity.decodeJitAuthorization(env.payload);
				expect(auth.acceptsSkimmedFee).to.equal(false);
				const scid = Buffer.from('ffffff0000010002', 'hex');
				const reply = Buffer.concat([
					Buffer.from([0xac, 0x25]),
					message.encodeCustomMessage(
						message.BeignetCustomSubtype.JIT_RECEIVE_ACK,
						liquidity.encodeJitAck({
							requestId: auth.requestId,
							interceptScid: scid,
							accepted: true,
							flatFeeSat: 10n,
							feePpm: 500,
							feeMode: 'hop'
						})
					)
				]);
				cln.notify({
					custommsg: { peer_id: LSP_ID, payload: reply.toString('hex') }
				});
			};
			const jit = new JitClient({ link });
			const [grant] = await Promise.all([
				jit.authorize(LSP_ID, { maxAmountSat: 40_000, timeoutMs: 5_000 }),
				answer()
			]);
			expect(grant.interceptScidHex).to.equal('ffffff0000010002');
			expect(grant.clnShortChannelId()).to.equal('16777215x1x2');
			expect(grant.feeMode).to.equal('hop');
			expect(grant.routeHint.feeBaseMsat).to.equal(10_000);
			expect(grant.routeHint.feeProportionalMillionths).to.equal(500);
		} finally {
			await link.close();
			await cln.close();
		}
	});

	it('a wrong rune is refused before anything is sent', async () => {
		const cln = await fakeCln('right');
		const link = new ClnPeerLink({
			host: '127.0.0.1',
			port: cln.port,
			rune: 'wrong',
			https: false
		});
		let caught: unknown;
		try {
			await link.open();
		} catch (err) {
			caught = err;
		}
		expect(String((caught as Error).message)).to.match(/HTTP 401/);
		await link.close();
		await cln.close();
	});
});
