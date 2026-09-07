/**
 * LndWallet against a fake LND REST API that holds the coins' keys and
 * signs the way lnd 0.20 does (shapes pinned against the real node):
 * ListUnspent, ListAddresses with base64 public keys, ListLeases, a GET
 * NewAddress, SignMessageWithAddr as a 65-byte compact signature, and
 * SignPsbt that signs a P2WPKH input only when SIGHASH_ALL is asked for and
 * a taproot input only when both derivation records are present. The whole
 * thing is then driven through a real direct-funding exchange with
 * beignet's receiver over TCP.
 */

import { expect } from 'chai';
import crypto from 'crypto';
import http from 'http';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { directFunding } from 'beignet/lightning';
import { DfTransportType } from '../../node_modules/beignet/src/lightning/direct-funding/types';
import { DfDirectPeerLaneFactory } from '../../node_modules/beignet/src/lightning/direct-funding/transport/direct-peer';
import type { IDfTestCoin } from '../../node_modules/beignet/tests/lightning/helpers/df-receiver';
import {
	BeignetClient,
	LND_WALLET_LEASE_ID,
	LndWallet,
	NoisePeerLink
} from '../../src';
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
	path: string;
	prevTx: bitcoin.Transaction;
	txid: string;
	vout: number;
	valueSat: number;
}

function fakeCoin(
	kind: 'p2wpkh' | 'p2tr',
	valueSat: number,
	index: number
): IFakeCoin {
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
		path: `m/${kind === 'p2wpkh' ? 84 : 86}'/0'/0'/0/${index}`,
		prevTx,
		txid: prevTx.getId(),
		vout: 0,
		valueSat
	};
}

function varstr(b: Buffer): Buffer {
	return Buffer.concat([
		b.length < 0xfd
			? Buffer.from([b.length])
			: Buffer.from([0xfd, b.length & 0xff, b.length >> 8]),
		b
	]);
}

/** lnd's SignMessageWithAddr: compact ECDSA over the Core envelope, header first. */
function lndSignMessage(msg: Buffer, privkey: Buffer): Buffer {
	const envelope = Buffer.concat([
		varstr(Buffer.from('Bitcoin Signed Message:\n')),
		varstr(msg)
	]);
	const hash = crypto
		.createHash('sha256')
		.update(crypto.createHash('sha256').update(envelope).digest())
		.digest();
	return Buffer.concat([
		Buffer.from([0x1f]),
		Buffer.from(ecc.sign(hash, privkey))
	]);
}

async function fakeLnd(coins: IFakeCoin[]): Promise<{
	port: number;
	calls: Array<{ method: string; path: string; body: Record<string, unknown> }>;
	leases: Map<string, string>;
	tip: number;
	close(): Promise<void>;
}> {
	const calls: Array<{
		method: string;
		path: string;
		body: Record<string, unknown>;
	}> = [];
	const leases = new Map<string, string>();
	const state = { tip: 800_000 };
	const unusedAddress = bitcoin.payments.p2wpkh({
		hash: crypto.randomBytes(20),
		network: NET
	}).address!;
	const server = http.createServer((req, res) => {
		if (req.headers['grpc-metadata-macaroon'] !== 'mac') {
			res.writeHead(401).end('{"message":"permission denied"}');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			const body = raw ? JSON.parse(raw) : {};
			const url = new URL(req.url!, 'http://x');
			calls.push({ method: req.method!, path: url.pathname, body });
			const json = (o: unknown, status = 200): void => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(o));
			};
			const key = `${req.method} ${url.pathname}`;
			switch (key) {
				case 'GET /v1/getinfo':
					return json({ block_height: state.tip });
				case 'POST /v2/wallet/utxos':
					return json({
						utxos: coins
							.filter((c) => !leases.has(`${c.txid}:${c.vout}`))
							.map((c) => ({
								address_type:
									c.kind === 'p2wpkh'
										? 'WITNESS_PUBKEY_HASH'
										: 'TAPROOT_PUBKEY',
								address: c.address,
								amount_sat: String(c.valueSat),
								pk_script: c.script.toString('hex'),
								outpoint: { txid_str: c.txid, output_index: c.vout },
								confirmations: '6'
							}))
					});
				case 'GET /v2/wallet/addresses':
					return json({
						account_with_addresses: [
							{
								name: 'default',
								addresses: coins.map((c) => ({
									address: c.address,
									public_key: c.pubkey.toString('base64'),
									derivation_path: c.path
								}))
							}
						]
					});
				case 'POST /v2/wallet/utxos/leases':
					return json({
						locked_utxos: [...leases.keys()].map((k) => ({
							outpoint: {
								txid_str: k.split(':')[0],
								output_index: Number(k.split(':')[1])
							}
						}))
					});
				case 'POST /v2/wallet/utxos/lease': {
					const b = body as {
						id: string;
						outpoint: { txid_str: string; output_index: number };
					};
					if (Buffer.from(b.id, 'base64').length !== 32)
						return json({ message: 'id must be 32 random bytes' }, 500);
					leases.set(`${b.outpoint.txid_str}:${b.outpoint.output_index}`, b.id);
					return json({ expiration: '1' });
				}
				case 'POST /v2/wallet/utxos/release': {
					const b = body as {
						id: string;
						outpoint: { txid_str: string; output_index: number };
					};
					const k = `${b.outpoint.txid_str}:${b.outpoint.output_index}`;
					if (leases.get(k) !== b.id)
						return json({ message: 'not leased by this id' }, 500);
					leases.delete(k);
					return json({ status: 'released' });
				}
				case 'GET /v1/newaddress':
					if (url.searchParams.get('type') !== 'UNUSED_WITNESS_PUBKEY_HASH')
						return json({ message: 'bad type' }, 400);
					// lnd hands out the same unused address until it is used.
					return json({ address: unusedAddress });
				case 'GET /v1/transactions':
					return json({
						transactions: coins.map((c) => ({
							tx_hash: c.txid,
							num_confirmations: 6,
							block_height: state.tip - 5,
							raw_tx_hex: c.prevTx.toHex(),
							previous_outpoints: []
						}))
					});
				case 'POST /v2/wallet/address/signmessage': {
					const b = body as { msg: string; addr: string };
					const coin = coins.find((c) => c.address === b.addr);
					if (!coin) return json({ message: 'unknown address' }, 500);
					return json({
						signature: lndSignMessage(
							Buffer.from(b.msg, 'base64'),
							coin.privkey
						).toString('base64')
					});
				}
				case 'POST /v2/wallet/psbt/sign': {
					const psbt = bitcoin.Psbt.fromBase64(
						(body as { funded_psbt: string }).funded_psbt,
						{ network: NET }
					);
					const signed: number[] = [];
					psbt.data.inputs.forEach((input, i) => {
						// lnd reads the plain BIP 32 record for every input.
						const d = input.bip32Derivation?.[0];
						if (!d || !input.witnessUtxo) return;
						const coin = coins.find(
							(c) => c.pubkey.equals(Buffer.from(d.pubkey)) && c.path === d.path
						);
						if (!coin) return;
						const spk = input.witnessUtxo.script;
						if (spk.length === 34 && spk[0] === 0x51 && spk[1] === 0x20) {
							// ...and refuses a taproot input without the taproot record.
							if (!input.tapBip32Derivation?.length || !input.tapInternalKey) {
								throw new Error(
									'cannot sign for taproot input without taproot BIP0032 derivation info'
								);
							}
							const tweaked = ecc.privateAdd(
								coin.pubkey[0] === 3
									? ecc.privateNegate(coin.privkey)
									: coin.privkey,
								bitcoin.crypto.taggedHash(
									'TapTweak',
									coin.pubkey.subarray(1, 33)
								)
							)!;
							const tx = bitcoin.Transaction.fromBuffer(
								psbt.data.globalMap.unsignedTx.toBuffer()
							);
							const sighash = tx.hashForWitnessV1(
								i,
								psbt.data.inputs.map((x) => x.witnessUtxo!.script),
								psbt.data.inputs.map((x) => x.witnessUtxo!.value),
								bitcoin.Transaction.SIGHASH_DEFAULT
							);
							input.tapKeySig = Buffer.from(ecc.signSchnorr(sighash, tweaked));
						} else {
							// lnd signs with hash type 0 unless told otherwise.
							const hashType = input.sighashType ?? 0;
							const tx = bitcoin.Transaction.fromBuffer(
								psbt.data.globalMap.unsignedTx.toBuffer()
							);
							const scriptCode = bitcoin.payments.p2pkh({ pubkey: coin.pubkey })
								.output!;
							const sighash = tx.hashForWitnessV0(
								i,
								scriptCode,
								input.witnessUtxo.value,
								hashType
							);
							input.partialSig = [
								{
									pubkey: coin.pubkey,
									signature: Buffer.concat([
										bitcoin.script.signature
											.encode(Buffer.from(ecc.sign(sighash, coin.privkey)), 1)
											.subarray(0, -1),
										Buffer.from([hashType])
									])
								}
							];
						}
						signed.push(i);
					});
					return json({ signed_psbt: psbt.toBase64(), signed_inputs: signed });
				}
				default:
					return json({ message: 'not found' }, 404);
			}
		});
	});
	const port = await freePort();
	await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
	return {
		port,
		calls,
		leases,
		get tip() {
			return state.tip;
		},
		close: (): Promise<void> => new Promise((r) => server.close(() => r()))
	};
}

describe('LndWallet over a fake LND REST API', function () {
	this.timeout(30_000);

	it('snapshots coins, keys and leases, and freezes with its own lease id', async () => {
		const coins = [
			fakeCoin('p2wpkh', 300_000, 1),
			fakeCoin('p2tr', 250_000, 2)
		];
		const lnd = await fakeLnd(coins);
		try {
			const wallet = new LndWallet({
				host: '127.0.0.1',
				port: lnd.port,
				macaroonHex: 'mac',
				https: false,
				network: 'regtest'
			});
			expect(wallet.listSpendable()).to.deep.equal([]);
			await wallet.refresh();
			expect(wallet.blockHeight()).to.equal(800_000);
			const spendable = wallet.listSpendable();
			expect(spendable.map((c) => c.txidHex).sort()).to.deep.equal(
				coins.map((c) => c.txid).sort()
			);
			expect(spendable[0].height).to.equal(800_000 - 6 + 1);
			expect(wallet.txStatus(coins[0].txid)).to.deep.equal({
				known: true,
				confirmed: true
			});
			expect(wallet.txStatus('00'.repeat(32))).to.equal(null);
			expect(
				(await wallet.getTransaction(coins[1].txid)).equals(
					coins[1].prevTx.toBuffer()
				)
			).to.equal(true);
			expect((await wallet.changeScript()).length).to.equal(22);

			expect(await wallet.freezeUtxo(coins[0].txid, 0)).to.equal(true);
			expect(lnd.leases.get(`${coins[0].txid}:0`)).to.equal(
				LND_WALLET_LEASE_ID.toString('base64')
			);
			expect(wallet.listSpendable().map((c) => c.txidHex)).to.deep.equal([
				coins[1].txid
			]);
			// Still findable while frozen, as a resumed attempt needs.
			expect(wallet.findCoin(coins[0].txid, 0)).to.not.equal(null);
			expect(await wallet.unfreezeUtxo(coins[0].txid, 0)).to.equal(true);
			expect(await wallet.unfreezeUtxo(coins[0].txid, 0)).to.equal(false);
			expect(await wallet.freezeUtxo('00'.repeat(32), 0)).to.equal(false);

			const signer = wallet.signerFor(spendable[0])!;
			expect(() => signer.signOwnership(Buffer.alloc(32))).to.throw(
				/messages, not raw digests/
			);
			const proof = await signer.signOwnershipMessage!('hello');
			expect(proof.signature).to.have.length(65);
			const coin = coins.find((c) => c.txid === spendable[0].txidHex)!;
			expect(proof.pubkey).to.deep.equal(coin.pubkey);
			expect(
				ecc.verify(
					directFunding.bitcoinMessageHash('hello'),
					coin.pubkey,
					proof.signature.subarray(1)
				)
			).to.equal(true);
		} finally {
			await lnd.close();
		}
	});

	for (const kind of ['p2wpkh', 'p2tr'] as const) {
		it(`pays a real receiver over TCP with a ${kind} coin, LND-style signing throughout`, async () => {
			const coins = [fakeCoin(kind, 300_000, 7)];
			const lnd = await fakeLnd(coins);
			const side = await startReceiver(
				`fake-lnd-${kind}`,
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
			const wallet = new LndWallet({
				host: '127.0.0.1',
				port: lnd.port,
				macaroonHex: 'mac',
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
				// pay() refreshes the snapshot itself; no manual refresh here.
				const paying = client.directFunding.pay(side.bip21, {
					amountSat: AMOUNT,
					maxTotalFeeSat: FEE_CEILING
				});
				await waitFor(
					() => side.node.opens.length === 1,
					'the receiver to start an open'
				);
				// The same unused address the engine was handed, as lnd behaves.
				const change = await wallet.changeScript();
				expect(
					lnd.calls.filter((x) => x.path === '/v1/newaddress').length
				).to.be.greaterThan(1);
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
				expect(side.node.witnesses).to.have.length(1);
				const witness = side.node.witnesses[0].witness;
				if (kind === 'p2tr') {
					expect(witness).to.have.length(1);
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
					expect(witness).to.have.length(2);
					const decoded = bitcoin.script.signature.decode(witness[0]);
					expect(decoded.hashType).to.equal(bitcoin.Transaction.SIGHASH_ALL);
					const sighash = tx.hashForWitnessV0(
						0,
						bitcoin.payments.p2pkh({ pubkey: c.pubkey }).output!,
						c.valueSat,
						1
					);
					expect(ecc.verify(sighash, c.pubkey, decoded.signature)).to.equal(
						true
					);
				}
				// The coin is leased under our id from the moment the witness left.
				expect(lnd.leases.get(`${c.txid}:0`)).to.equal(
					LND_WALLET_LEASE_ID.toString('base64')
				);
				// And the ownership proof went as a message, with a zeroed digest field.
				const signMsgCalls = lnd.calls.filter(
					(x) => x.path === '/v2/wallet/address/signmessage'
				);
				expect(signMsgCalls).to.have.length(1);
				expect(signMsgCalls[0].body.addr).to.equal(c.address);
			} finally {
				await client.close();
				side.stop();
				await lnd.close();
			}
		});
	}
});
