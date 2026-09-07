/**
 * KeyedUtxoWallet: the two things a signer may produce are exactly right,
 * for both coin kinds, and a key that does not control its script is
 * refused at construction rather than discovered after a broadcast.
 */

import { expect } from 'chai';
import crypto from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { KeyedUtxoWallet, coinKindOf, taprootTweakPrivateKey } from '../../src';

bitcoin.initEccLib(ecc);

const CHANGE_ADDRESS = bitcoin.payments.p2wpkh({
	hash: Buffer.alloc(20, 7),
	network: bitcoin.networks.regtest
}).address!;

function coin(
	kind: 'p2wpkh' | 'p2tr',
	valueSat = 150_000
): {
	txid: string;
	vout: number;
	valueSat: number;
	script: Buffer;
	privateKey: Buffer;
	pubkey: Buffer;
	prevTx: bitcoin.Transaction;
} {
	const privateKey = crypto.randomBytes(32);
	const pubkey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
	const script =
		kind === 'p2wpkh'
			? bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.regtest })
					.output!
			: bitcoin.payments.p2tr({
					internalPubkey: pubkey.subarray(1, 33),
					network: bitcoin.networks.regtest
			  }).output!;
	const prevTx = new bitcoin.Transaction();
	prevTx.version = 2;
	prevTx.addInput(crypto.randomBytes(32), 0);
	prevTx.addOutput(script, valueSat);
	return {
		txid: prevTx.getId(),
		vout: 0,
		valueSat,
		script,
		privateKey,
		pubkey,
		prevTx
	};
}

function walletWith(c: ReturnType<typeof coin>): KeyedUtxoWallet {
	return new KeyedUtxoWallet({
		network: 'regtest',
		coins: [c],
		changeAddress: CHANGE_ADDRESS,
		getTransaction: async (): Promise<Buffer> => c.prevTx.toBuffer(),
		blockHeight: () => 123
	});
}

/** A spend of the coin: one input, one output. */
function spendOf(c: ReturnType<typeof coin>): bitcoin.Transaction {
	const tx = new bitcoin.Transaction();
	tx.version = 2;
	tx.addInput(Buffer.from(c.txid, 'hex').reverse(), c.vout, 0xfffffffd);
	tx.addOutput(
		bitcoin.payments.p2wpkh({ hash: crypto.randomBytes(20) }).output!,
		c.valueSat - 500
	);
	return tx;
}

describe('KeyedUtxoWallet', () => {
	it('classifies scripts', () => {
		expect(coinKindOf(coin('p2wpkh').script)).to.equal('p2wpkh');
		expect(coinKindOf(coin('p2tr').script)).to.equal('p2tr');
		expect(
			coinKindOf(Buffer.from('a914' + '00'.repeat(20) + '87', 'hex'))
		).to.equal(null);
	});

	it('signs a P2WPKH coin: ECDSA ownership proof and a valid witness', async () => {
		const c = coin('p2wpkh');
		const wallet = walletWith(c);
		const listed = wallet.listSpendable();
		expect(listed).to.have.length(1);
		expect(listed[0].valueSat).to.equal(150_000n);
		const signer = wallet.signerFor(listed[0])!;
		expect(signer.kind).to.equal('p2wpkh');
		expect(signer.ownershipPubkey).to.deep.equal(c.pubkey);

		const digest = crypto.randomBytes(32);
		const proof = signer.signOwnership(digest);
		expect(proof).to.have.length(64);
		expect(ecc.verify(digest, c.pubkey, proof)).to.equal(true);

		const tx = spendOf(c);
		const witness = await signer.signInput(tx, 0, {
			scripts: [c.script],
			values: [BigInt(c.valueSat)]
		});
		expect(witness).to.have.length(2);
		expect(witness[1]).to.deep.equal(c.pubkey);
		const scriptCode = bitcoin.payments.p2pkh({ pubkey: c.pubkey }).output!;
		const sighash = tx.hashForWitnessV0(
			0,
			scriptCode,
			c.valueSat,
			bitcoin.Transaction.SIGHASH_ALL
		);
		const decoded = bitcoin.script.signature.decode(witness[0]);
		expect(decoded.hashType).to.equal(bitcoin.Transaction.SIGHASH_ALL);
		expect(ecc.verify(sighash, c.pubkey, decoded.signature)).to.equal(true);
	});

	it('signs a P2TR coin: Schnorr proof under the OUTPUT key and a key-path witness', async () => {
		const c = coin('p2tr');
		const wallet = walletWith(c);
		const signer = wallet.signerFor(wallet.listSpendable()[0])!;
		expect(signer.kind).to.equal('p2tr');
		// The ownership key is the x-only output key the script commits to.
		expect(signer.ownershipPubkey).to.deep.equal(c.script.subarray(2, 34));
		const tweaked = taprootTweakPrivateKey(c.privateKey, c.pubkey);
		expect(
			Buffer.from(ecc.pointFromScalar(tweaked, true)!).subarray(1, 33)
		).to.deep.equal(c.script.subarray(2, 34));

		const digest = crypto.randomBytes(32);
		const proof = signer.signOwnership(digest);
		expect(ecc.verifySchnorr(digest, signer.ownershipPubkey, proof)).to.equal(
			true
		);

		const tx = spendOf(c);
		const witness = await signer.signInput(tx, 0, {
			scripts: [c.script],
			values: [BigInt(c.valueSat)]
		});
		expect(witness).to.have.length(1);
		expect(witness[0]).to.have.length(64);
		const sighash = tx.hashForWitnessV1(
			0,
			[c.script],
			[c.valueSat],
			bitcoin.Transaction.SIGHASH_DEFAULT
		);
		expect(
			ecc.verifySchnorr(sighash, signer.ownershipPubkey, witness[0])
		).to.equal(true);
	});

	it('refuses a key that does not control the script', () => {
		const c = coin('p2wpkh');
		expect(
			() =>
				new KeyedUtxoWallet({
					network: 'regtest',
					coins: [{ ...c, privateKey: crypto.randomBytes(32) }],
					changeAddress: CHANGE_ADDRESS,
					getTransaction: async (): Promise<Buffer> => Buffer.alloc(0)
				})
		).to.throw(/does not control/);
		expect(
			() =>
				new KeyedUtxoWallet({
					network: 'regtest',
					coins: [
						{
							...c,
							script: Buffer.from('a914' + '00'.repeat(20) + '87', 'hex')
						}
					],
					changeAddress: CHANGE_ADDRESS,
					getTransaction: async (): Promise<Buffer> => Buffer.alloc(0)
				})
		).to.throw(/only P2WPKH and P2TR/);
	});

	it('freezes and thaws its own coins, reporting the change', async () => {
		const c = coin('p2wpkh');
		const changes: string[][] = [];
		const wallet = new KeyedUtxoWallet({
			network: 'regtest',
			coins: [c],
			changeAddress: CHANGE_ADDRESS,
			getTransaction: async (): Promise<Buffer> => c.prevTx.toBuffer(),
			onFreezeChange: (o): void => {
				changes.push(o);
			}
		});
		expect(await wallet.freezeUtxo(c.txid, 0)).to.equal(true);
		expect(wallet.listSpendable()).to.deep.equal([]);
		// A frozen coin is still findable: a resumed attempt needs it.
		expect(wallet.findCoin(c.txid, 0)).to.not.equal(null);
		expect(wallet.ownsOutpoint(c.txid, 0)).to.equal(true);
		expect(await wallet.freezeUtxo('00'.repeat(32), 0)).to.equal(false);
		expect(await wallet.unfreezeUtxo(c.txid, 0)).to.equal(true);
		expect(await wallet.unfreezeUtxo(c.txid, 0)).to.equal(false);
		expect(wallet.listSpendable()).to.have.length(1);
		expect(changes).to.deep.equal([[`${c.txid}:0`], []]);
		expect(wallet.blockHeight()).to.equal(0);
	});
});
