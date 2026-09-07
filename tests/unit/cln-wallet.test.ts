/**
 * ClnWallet against a fake clnrest that holds the coins' keys and signs the
 * way Core Lightning does (shapes pinned against v26.06): listfunds,
 * listtransactions with rawtx, newaddr, reserveinputs/unreserveinputs that
 * refuse to sign an unreserved input, and signpsbt honouring `signonly`.
 * Then a real direct-funding exchange with beignet's receiver over TCP, for
 * both coin kinds, with the probe-transaction ownership proof throughout.
 */

import { expect } from 'chai';
import { directFunding } from 'beignet/lightning';
import crypto from 'crypto';
import http from 'http';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { DfTransportType } from '../../node_modules/beignet/src/lightning/direct-funding/types';
import { DfDirectPeerLaneFactory } from '../../node_modules/beignet/src/lightning/direct-funding/transport/direct-peer';
import type { IDfTestCoin } from '../../node_modules/beignet/tests/lightning/helpers/df-receiver';
import { BeignetClient, ClnWallet, NoisePeerLink } from '../../src';
import { freePort, waitFor } from '../helpers';
import {
	AMOUNT,
	FEE_CEILING,
	expectedOffer,
	startReceiver
} from '../df-harness';

bitcoin.initEccLib(ecc);
const NET = bitcoin.networks.regtest;

interface IFakeCoin {
	kind: 'p2wpkh' | 'p2tr';
	privkey: Buffer;
	pubkey: Buffer;
	script: Buffer;
	address: string;
	prevTx: bitcoin.Transaction;
	txid: string;
	vout: number;
	valueSat: number;
}

function fakeCoin(kind: 'p2wpkh' | 'p2tr', valueSat: number): IFakeCoin {
	const privkey = crypto.randomBytes(32);
	const pubkey = Buffer.from(ecc.pointFromScalar(privkey, true)!);
	const payment =
		kind === 'p2wpkh'
			? bitcoin.payments.p2wpkh({ pubkey, network: NET })
			: bitcoin.payments.p2tr({
					internalPubkey: pubkey.subarray(1, 33),
					network: NET
			  });
	const prevTx = new bitcoin.Transaction();
	prevTx.version = 2;
	prevTx.addInput(crypto.randomBytes(32), 0);
	prevTx.addOutput(payment.output!, valueSat);
	return {
		kind,
		privkey,
		pubkey,
		script: payment.output!,
		address: payment.address!,
		prevTx,
		txid: prevTx.getId(),
		vout: 0,
		valueSat
	};
}

async function fakeCln(
	coins: IFakeCoin[],
	faults: {
		signing?: boolean;
		malformed?: boolean;
		release?: boolean;
		infoGate?: Promise<void>;
	} = {}
): Promise<{
	port: number;
	calls: Array<{ method: string; body: Record<string, unknown> }>;
	reserved: Map<string, number>;
	close(): Promise<void>;
}> {
	const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
	const reserved = new Map<string, number>();
	const changeAddress = bitcoin.payments.p2wpkh({
		hash: crypto.randomBytes(20),
		network: NET
	}).address!;
	const outpointsOf = (b64: string): string[] => {
		const psbt = bitcoin.Psbt.fromBase64(b64, { network: NET });
		return psbt.txInputs.map(
			(i) => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`
		);
	};
	const server = http.createServer((req, res) => {
		if (req.headers.rune !== 'rune') {
			res.writeHead(401).end('{"error":"invalid rune"}');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
			const method = req.url!.replace('/v1/', '');
			calls.push({ method, body });
			const json = (o: unknown, status = 200): void => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(o));
			};
			switch (method) {
				case 'getinfo':
					if (faults.infoGate) {
						void faults.infoGate.then(() => json({ blockheight: 800_000 }));
						return;
					}
					return json({ blockheight: 800_000 });
				case 'listfunds':
					return json({
						outputs: coins.map((c) => ({
							txid: c.txid,
							output: c.vout,
							amount_msat: c.valueSat * 1000,
							scriptpubkey: c.script.toString('hex'),
							address: c.address,
							status: 'confirmed',
							blockheight: 799_990,
							reserved: reserved.has(`${c.txid}:${c.vout}`)
						}))
					});
				case 'listtransactions':
					return json({
						transactions: coins.map((c) => ({
							hash: c.txid,
							rawtx: c.prevTx.toHex(),
							blockheight: 799_990,
							inputs: []
						}))
					});
				case 'newaddr':
					if (body.addresstype !== 'bech32')
						return json({ message: 'bad addresstype' }, 400);
					return json({ bech32: changeAddress });
				case 'reserveinputs': {
					const known = outpointsOf(String(body.psbt)).filter((o) =>
						coins.some((c) => `${c.txid}:${c.vout}` === o)
					);
					if (body.exclusive !== false && known.some((o) => reserved.has(o))) {
						return json({ message: 'Input already reserved' }, 500);
					}
					const reservations = known.map((o) => {
						const until =
							Math.max(800_000, reserved.get(o) ?? 0) +
							Number(body.reserve ?? 72);
						reserved.set(o, until);
						const [txid, vout] = o.split(':');
						return {
							txid,
							vout: Number(vout),
							reserved: true,
							reserved_to_block: until
						};
					});
					return json({ reservations });
				}
				case 'unreserveinputs': {
					if (faults.release) return json({ message: 'release refused' }, 500);
					const reservations = outpointsOf(String(body.psbt))
						.filter((o) => coins.some((c) => `${c.txid}:${c.vout}` === o))
						.map((o) => {
							const until = (reserved.get(o) ?? 0) - Number(body.reserve ?? 72);
							if (until <= 800_000) reserved.delete(o);
							else reserved.set(o, until);
							const [txid, vout] = o.split(':');
							return {
								txid,
								vout: Number(vout),
								reserved: reserved.has(o),
								reserved_to_block: reserved.get(o)
							};
						});
					return json({ reservations });
				}
				case 'signpsbt': {
					if (faults.signing) return json({ message: 'signing refused' }, 500);
					if (faults.malformed) return json({ signed_psbt: 'invalid' });
					const psbt = bitcoin.Psbt.fromBase64(String(body.psbt), {
						network: NET
					});
					const only =
						(body.signonly as number[] | undefined) ??
						psbt.data.inputs.map((_, i) => i);
					const tx = bitcoin.Transaction.fromBuffer(
						psbt.data.globalMap.unsignedTx.toBuffer()
					);
					for (const i of only) {
						const input = psbt.data.inputs[i];
						const outpoint = `${Buffer.from(psbt.txInputs[i].hash)
							.reverse()
							.toString('hex')}:${psbt.txInputs[i].index}`;
						const coin = coins.find((c) => `${c.txid}:${c.vout}` === outpoint);
						if (!coin)
							return json(
								{
									message: `Aborting PSBT signing. UTXO ${outpoint} is unknown`
								},
								500
							);
						if (!reserved.has(outpoint))
							return json({ message: `Input ${i} is not reserved` }, 500);
						if (coin.kind === 'p2tr') {
							const tweaked = ecc.privateAdd(
								coin.pubkey[0] === 3
									? ecc.privateNegate(coin.privkey)
									: coin.privkey,
								bitcoin.crypto.taggedHash(
									'TapTweak',
									coin.pubkey.subarray(1, 33)
								)
							)!;
							const sighash = tx.hashForWitnessV1(
								i,
								psbt.data.inputs.map((x) => x.witnessUtxo!.script),
								psbt.data.inputs.map((x) => x.witnessUtxo!.value),
								bitcoin.Transaction.SIGHASH_DEFAULT
							);
							input.tapKeySig = Buffer.from(ecc.signSchnorr(sighash, tweaked));
						} else {
							const sighash = tx.hashForWitnessV0(
								i,
								bitcoin.payments.p2pkh({ pubkey: coin.pubkey }).output!,
								input.witnessUtxo!.value,
								bitcoin.Transaction.SIGHASH_ALL
							);
							input.partialSig = [
								{
									pubkey: coin.pubkey,
									signature: bitcoin.script.signature.encode(
										Buffer.from(ecc.sign(sighash, coin.privkey)),
										bitcoin.Transaction.SIGHASH_ALL
									)
								}
							];
						}
					}
					return json({ signed_psbt: psbt.toBase64() });
				}
				default:
					return json({ message: 'unknown method' }, 404);
			}
		});
	});
	const port = await freePort();
	await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
	return {
		port,
		calls,
		reserved,
		close: (): Promise<void> => new Promise((r) => server.close(() => r()))
	};
}

describe('ClnWallet over a fake clnrest', function () {
	this.timeout(30_000);

	it('snapshots coins and reserves through CLN, and a wrong rune is refused', async () => {
		const coins = [fakeCoin('p2wpkh', 300_000), fakeCoin('p2tr', 250_000)];
		const cln = await fakeCln(coins);
		try {
			const bad = new ClnWallet({
				host: '127.0.0.1',
				port: cln.port,
				rune: 'nope',
				https: false,
				network: 'regtest'
			});
			let caught: unknown;
			try {
				await bad.refresh();
			} catch (err) {
				caught = err;
			}
			expect(String((caught as Error).message)).to.match(/HTTP 401/);

			const wallet = new ClnWallet({
				host: '127.0.0.1',
				port: cln.port,
				rune: 'rune',
				https: false,
				network: 'regtest'
			});
			await wallet.refresh();
			expect(wallet.blockHeight()).to.equal(800_000);
			expect(
				wallet
					.listSpendable()
					.map((c) => c.txidHex)
					.sort()
			).to.deep.equal(coins.map((c) => c.txid).sort());
			expect(
				(await wallet.getTransaction(coins[0].txid)).equals(
					coins[0].prevTx.toBuffer()
				)
			).to.equal(true);
			expect((await wallet.changeScript()).length).to.equal(22);
			expect(await wallet.freezeUtxo(coins[1].txid, 0)).to.equal(true);
			expect(cln.reserved.has(`${coins[1].txid}:0`)).to.equal(true);
			expect(wallet.listSpendable().map((c) => c.txidHex)).to.deep.equal([
				coins[0].txid
			]);
			expect(wallet.findCoin(coins[1].txid, 0)).to.not.equal(null);
			expect(await wallet.unfreezeUtxo(coins[1].txid, 0)).to.equal(true);
			expect(cln.reserved.size).to.equal(0);
			expect(await wallet.freezeUtxo('00'.repeat(32), 0)).to.equal(false);
			const signer = wallet.signerFor(wallet.listSpendable()[0])!;
			expect(() => signer.signOwnership(Buffer.alloc(32))).to.throw(
				/transactions, not digests/
			);
			expect(signer.signOwnershipProbe).to.be.a('function');
			expect(signer.signOwnershipMessage).to.equal(undefined);
		} finally {
			await cln.close();
		}
	});

	for (const fault of ['signing', 'malformed', 'release'] as const) {
		it(`refuses the proof and attempts cleanup when ${fault} fails`, async () => {
			const coin = fakeCoin('p2wpkh', 300_000);
			const cln = await fakeCln([coin], { [fault]: true });
			const wallet = new ClnWallet({
				host: '127.0.0.1',
				port: cln.port,
				rune: 'rune',
				https: false,
				network: 'regtest'
			});
			try {
				await wallet.refresh();
				const signer = wallet.signerFor(wallet.listSpendable()[0])!;
				const { tx, prevouts } = directFunding.ownershipProbeTransaction(
					Buffer.alloc(16, 7),
					Buffer.from(coin.txid, 'hex'),
					0,
					0xfffffffd,
					coin.script,
					BigInt(coin.valueSat)
				);
				let rejected = false;
				try {
					await signer.signOwnershipProbe!(tx, prevouts);
				} catch {
					rejected = true;
				}
				expect(rejected).to.equal(true);
				expect(cln.reserved.size).to.equal(fault === 'release' ? 1 : 0);
				expect(
					cln.calls.filter((c) => c.method === 'unreserveinputs')
				).to.have.length(1);
				await wallet.refresh();
				expect(wallet.listSpendable()).to.have.length(
					fault === 'release' ? 0 : 1
				);
			} finally {
				await cln.close();
			}
		});
	}

	it('a refused funding signature leaves exactly one reservation to release', async () => {
		const coin = fakeCoin('p2wpkh', 300_000);
		const cln = await fakeCln([coin], { signing: true });
		const wallet = new ClnWallet({
			host: '127.0.0.1',
			port: cln.port,
			rune: 'rune',
			https: false,
			network: 'regtest'
		});
		try {
			await wallet.refresh();
			const signer = wallet.signerFor(wallet.listSpendable()[0])!;
			expect(await wallet.freezeUtxo(coin.txid, 0)).to.equal(true);
			const tx = new bitcoin.Transaction();
			tx.addInput(Buffer.from(coin.txid, 'hex').reverse(), 0);
			tx.addOutput(coin.script, coin.valueSat - 1000);
			let rejected = false;
			try {
				await signer.signInput(tx, 0, {
					scripts: [coin.script],
					values: [BigInt(coin.valueSat)]
				});
			} catch {
				rejected = true;
			}
			expect(rejected).to.equal(true);
			expect(cln.reserved.get(`${coin.txid}:0`)).to.equal(800_144);
			expect(await wallet.unfreezeUtxo(coin.txid, 0)).to.equal(true);
			expect(cln.reserved.size).to.equal(0);
		} finally {
			await cln.close();
		}
	});

	it('does not extend a competing reservation and respects a partial release', async () => {
		const coin = fakeCoin('p2wpkh', 300_000);
		const cln = await fakeCln([coin]);
		const wallet = new ClnWallet({
			host: '127.0.0.1',
			port: cln.port,
			rune: 'rune',
			https: false,
			network: 'regtest'
		});
		try {
			await wallet.refresh();
			cln.reserved.set(`${coin.txid}:0`, 800_288);
			expect(await wallet.freezeUtxo(coin.txid, 0)).to.equal(false);
			expect(cln.reserved.get(`${coin.txid}:0`)).to.equal(800_288);
			expect(await wallet.unfreezeUtxo(coin.txid, 0)).to.equal(false);
			expect(cln.reserved.get(`${coin.txid}:0`)).to.equal(800_144);
			expect(wallet.listSpendable()).to.have.length(0);
		} finally {
			await cln.close();
		}
	});

	for (const operation of ['freeze', 'release'] as const) {
		it(`keeps the CLN reservation snapshot current when refresh overlaps ${operation}`, async () => {
			const coin = fakeCoin('p2wpkh', 300_000);
			const faults: { infoGate?: Promise<void> } = {};
			const cln = await fakeCln([coin], faults);
			const wallet = new ClnWallet({
				host: '127.0.0.1',
				port: cln.port,
				rune: 'rune',
				https: false,
				network: 'regtest'
			});
			let resume!: () => void;
			try {
				await wallet.refresh();
				if (operation === 'release')
					expect(await wallet.freezeUtxo(coin.txid, 0)).to.equal(true);
				faults.infoGate = new Promise<void>((resolve) => {
					resume = resolve;
				});
				const previous = cln.calls.filter(
					(c) => c.method === 'listfunds'
				).length;
				const refreshing = wallet.refresh();
				await waitFor(
					() =>
						cln.calls.filter((c) => c.method === 'listfunds').length > previous,
					'stale refresh snapshot'
				);
				const changing =
					operation === 'freeze'
						? wallet.freezeUtxo(coin.txid, 0)
						: wallet.unfreezeUtxo(coin.txid, 0);
				resume();
				await refreshing;
				expect(await changing).to.equal(true);
				expect(cln.reserved.has(`${coin.txid}:0`)).to.equal(
					operation === 'freeze'
				);
				expect(wallet.listSpendable()).to.have.length(
					operation === 'freeze' ? 0 : 1
				);
			} finally {
				resume?.();
				await cln.close();
			}
		});
	}

	it('releases a persisted reservation on a fresh wallet before any explicit refresh', async () => {
		const coin = fakeCoin('p2wpkh', 300_000);
		const cln = await fakeCln([coin]);
		cln.reserved.set(`${coin.txid}:0`, 800_144);
		const wallet = new ClnWallet({
			host: '127.0.0.1',
			port: cln.port,
			rune: 'rune',
			https: false,
			network: 'regtest'
		});
		try {
			expect(await wallet.unfreezeUtxo(coin.txid, 0)).to.equal(true);
			expect(cln.reserved.size).to.equal(0);
			expect(wallet.listSpendable()).to.have.length(1);
		} finally {
			await cln.close();
		}
	});

	for (const kind of ['p2wpkh', 'p2tr'] as const) {
		it(`pays a real receiver over TCP with a ${kind} coin, CLN-style signing throughout`, async () => {
			const coins = [fakeCoin(kind, 300_000)];
			const cln = await fakeCln(coins);
			const side = await startReceiver(
				`fake-cln-${kind}`,
				(port) => [
					{ type: DfTransportType.DIRECT_PEER, host: '127.0.0.1', port }
				],
				(peers, registry) =>
					registry.register({
						type: DfTransportType.DIRECT_PEER,
						enabled: true,
						load: () => new DfDirectPeerLaneFactory(peers)
					})
			);
			const c = coins[0];
			const testCoin: IDfTestCoin = {
				prevTx: c.prevTx,
				txidHex: c.txid,
				vout: c.vout,
				valueSat: BigInt(c.valueSat),
				script: c.script,
				privkey: c.privkey,
				pubkey: c.pubkey,
				kind
			};
			side.node.publish(testCoin);
			const wallet = new ClnWallet({
				host: '127.0.0.1',
				port: cln.port,
				rune: 'rune',
				https: false,
				network: 'regtest'
			});
			const client = new BeignetClient({
				allowEphemeralStorage: true,
				link: new NoisePeerLink({ network: 'regtest' }),
				network: 'regtest',
				wallet,
				sender: {
					offerResendDelaysMs: [],
					offerTimeoutMs: 15_000,
					receiptTimeoutMs: 5_000
				}
			});
			try {
				const paying = client.directFunding.pay(side.bip21, {
					amountSat: AMOUNT,
					maxTotalFeeSat: FEE_CEILING
				});
				await waitFor(
					() => side.node.opens.length === 1,
					'the receiver to start an open'
				);
				// The probe reserved and released the coin: nothing is held before
				// the sign request is verified.
				expect(cln.reserved.size).to.equal(0);
				const change = side.node.opens[0].params.contribution.changeScript;
				const offer = expectedOffer(testCoin, change, side.record.receiptHash);
				offer.ownership.pubkey =
					kind === 'p2tr' ? c.script.subarray(2, 34) : c.pubkey;
				const { tx } = side.node.completeNegotiation(testCoin, offer, {
					fundingScript: side.fundingScript
				});
				const result = await paying;
				expect(result.attested).to.equal(true);
				expect(result.status).to.equal('SIGNED_PENDING');
				expect(result.receiptPreimageHex).to.equal(side.record.preimageHex);
				const witness = side.node.witnesses[0].witness;
				if (kind === 'p2tr') {
					const sighash = tx.hashForWitnessV1(
						0,
						[c.script],
						[c.valueSat],
						bitcoin.Transaction.SIGHASH_DEFAULT
					);
					expect(
						ecc.verifySchnorr(sighash, c.script.subarray(2, 34), witness[0])
					).to.equal(true);
				} else {
					const decoded = bitcoin.script.signature.decode(witness[0]);
					const sighash = tx.hashForWitnessV0(
						0,
						bitcoin.payments.p2pkh({ pubkey: c.pubkey }).output!,
						c.valueSat,
						1
					);
					expect(ecc.verify(sighash, c.pubkey, decoded.signature)).to.equal(
						true
					);
					expect(witness[1]).to.deep.equal(c.pubkey);
				}
				// The coin stays reserved from the witness on.
				expect(cln.reserved.has(`${c.txid}:0`)).to.equal(true);
				expect(cln.reserved.get(`${c.txid}:0`)).to.equal(800_144);
				expect(await wallet.unfreezeUtxo(c.txid, 0)).to.equal(true);
				expect(cln.reserved.size).to.equal(0);
				// signpsbt was asked for our input only, twice: the probe and the funding.
				const signs = cln.calls.filter((x) => x.method === 'signpsbt');
				expect(signs).to.have.length(2);
				expect(
					signs.every((x) => JSON.stringify(x.body.signonly) === '[0]')
				).to.equal(true);
			} finally {
				await client.close();
				side.stop();
				await cln.close();
			}
		});
	}
});
