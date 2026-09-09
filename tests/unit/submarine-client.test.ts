/**
 * Submarine swaps, the client's front door: the quote in that direction,
 * create() minting the invoice and persisting CREATED with the refund key
 * before anything is funded, a caller-supplied invoice, the CLTV fit, the
 * ack verification table, and fund() persisting the attempt before the
 * wallet is asked.
 */

import { expect } from 'chai';
import { message, swaps } from 'beignet/lightning';
import { MemoryStorage, SwapClient } from '../../src';
import { SUBMARINE_SWAP_STORAGE_KEY } from '../../src/swaps/store';
import { ISubmarineSwapRecord, SwapError } from '../../src/swaps/types';
import { FakeProvider, IFakeProviderKnobs } from '../swaps/fake-provider';
import { linkPair } from '../swaps/fake-link';
import { MockChain } from '../swaps/mock-chain';
import { FakePayer } from '../swaps/fake-payer';
import { FakeFunder } from '../swaps/fake-funder';

interface IScene {
	client: SwapClient;
	provider: FakeProvider;
	chain: MockChain;
	payer: FakePayer;
	funder: FakeFunder;
	storage: MemoryStorage;
	logs: string[];
	reopen(): SwapClient;
}

function scene(
	knobs: IFakeProviderKnobs = {},
	policy: Record<string, unknown> = {},
	options: { funder?: boolean } = {}
): IScene {
	const { client: clientLink, provider: providerLink } = linkPair();
	const provider = new FakeProvider(providerLink);
	provider.knobs = knobs;
	const chain = new MockChain();
	const storage = new MemoryStorage();
	const payer = new FakePayer(storage);
	const funder = new FakeFunder(chain, storage);
	const logs: string[] = [];
	const make = (): SwapClient =>
		new SwapClient({
			link: clientLink,
			network: 'regtest',
			payer,
			funder: options.funder === false ? undefined : funder,
			chain,
			storage,
			policy: {
				statusPollMs: 0,
				chainPollMs: 5,
				replyTimeoutMs: 500,
				minRefundDeltaBlocks: 30,
				claimSafetyBlocks: 6,
				routeBudgetBlocks: 6,
				invoiceFinalCltvBlocks: 40,
				...policy
			},
			log: (action) => logs.push(action)
		});
	return {
		client: make(),
		provider,
		chain,
		payer,
		funder,
		storage,
		logs,
		reopen: make
	};
}

function stored(s: IScene, swapIdHex: string): ISubmarineSwapRecord {
	const doc = JSON.parse(
		s.storage.loadWalletData(SUBMARINE_SWAP_STORAGE_KEY)!
	) as { swaps: Record<string, ISubmarineSwapRecord> };
	return doc.swaps[swapIdHex];
}

const AMOUNT = 100_000;
/** flat 100 + 1000 ppm of 100k (100) + miner 400, plus the 100 sat slack. */
const FEE = 600n + 100n;

async function failure(p: Promise<unknown>): Promise<SwapError> {
	try {
		await p;
	} catch (err) {
		if (err instanceof SwapError) return err;
		throw err;
	}
	throw new Error('expected a SwapError');
}

describe('SubmarineSwapClient.quote and create', function () {
	it('quotes the submarine direction with its arithmetic and judges the window', async function () {
		const s = scene();
		const q = await s.client.quote(s.provider.id, {
			direction: 'submarine',
			amountSat: AMOUNT
		});
		expect(q.direction).to.equal('submarine');
		expect(q.accepted).to.equal(true);
		expect(q.totalFeeSat).to.equal(600n);
		expect(q.invoiceAmountMsat).to.equal((100_000n - 600n) * 1000n);
		expect(q.withinPolicy).to.equal(true);
		// A window too short for our final CLTV plus the margins is not within policy.
		const short = scene({ refundDelta: 50 });
		const sq = await short.client.quote(short.provider.id, {
			direction: 'submarine',
			amountSat: AMOUNT
		});
		expect(sq.accepted).to.equal(true);
		expect(sq.withinPolicy).to.equal(false);
		// The reverse quote is unchanged and the direction is echoed.
		const rq = await s.client.quote(s.provider.id, {
			direction: 'reverse',
			amountSat: AMOUNT
		});
		expect(rq.direction).to.equal('reverse');
		expect(rq.invoiceAmountMsat).to.equal((100_000n + 600n) * 1000n);
	});

	it('mints the invoice, sends the create, persists CREATED with the refund key and funds nothing', async function () {
		const s = scene();
		const swap = await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT
		});
		expect(swap.state).to.equal('CREATED');
		const rec = swap.record();
		expect(s.payer.invoiceCalls).to.have.length(1);
		expect(s.payer.invoiceCalls[0].amountMsat).to.equal(
			(100_000n - FEE) * 1000n
		);
		expect(s.payer.invoiceCalls[0].minFinalCltvExpiry).to.equal(40);
		expect(rec.invoiceSource).to.equal('minted');
		expect(rec.invoiceFinalCltv).to.equal(40);
		expect(rec.totalFeeSat).to.equal(FEE.toString());
		expect(rec.invoiceAmountMsat).to.equal(
			((100_000n - FEE) * 1000n).toString()
		);
		expect(rec.refundPrivkeyHex).to.have.length(64);
		expect(rec.claimPubkeyHex).to.not.equal(rec.refundPubkeyHex);
		expect(rec.refundHeight).to.equal(1144);
		expect(rec.paymentCeilingHeight).to.equal(1144 - 12);
		expect(rec.providerFundingConfirmations).to.equal(1);
		const fake = s.provider.swaps.get(swap.swapIdHex)!;
		expect(rec.htlcAddress).to.equal(fake.address);
		expect(rec.refundDestinationScriptHex).to.equal(
			s.payer.destination.toString('hex')
		);
		expect(s.funder.calls).to.have.length(0);
		expect(rec.funding).to.equal(undefined);
		expect(rec.fundingAttempt).to.equal(undefined);
		expect(stored(s, swap.swapIdHex).state).to.equal('CREATED');
		expect(s.logs).to.include('swap_created');
		expect(s.provider.received).to.include(
			message.BeignetCustomSubtype.SWAP_SUBMARINE_CREATE
		);
		// The reverse document is untouched.
		expect(s.storage.loadWalletData('swaps:reverse')).to.equal(null);
	});

	it('accepts a caller-supplied invoice the node owns, and refuses one that does not fit', async function () {
		const s = scene();
		const good = s.payer.supplyInvoice((100_000n - FEE) * 1000n);
		const swap = await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT,
			invoice: good
		});
		expect(swap.record().invoiceSource).to.equal('supplied');
		expect(swap.record().bolt11).to.equal(good);
		expect(s.payer.invoiceCalls).to.have.length(0);

		const cases: Array<[string, () => string, string]> = [
			[
				'wrong amount',
				() => s.payer.supplyInvoice((100_000n - FEE) * 1000n - 1000n),
				'invoice'
			],
			[
				'not open',
				() => {
					const b = s.payer.supplyInvoice((100_000n - FEE) * 1000n);
					s.payer.settleInvoice(s.payer.hashOfInvoice(b));
					return b;
				},
				'invoice'
			],
			[
				'unknown to the node',
				() => {
					const b = s.payer.supplyInvoice((100_000n - FEE) * 1000n);
					s.payer.forgetInvoice(s.payer.hashOfInvoice(b));
					return b;
				},
				'invoice'
			],
			[
				'expires too soon',
				() => s.payer.supplyInvoice((100_000n - FEE) * 1000n, 40, 60),
				'invoice'
			],
			[
				'final cltv that cannot fit',
				() => s.payer.supplyInvoice((100_000n - FEE) * 1000n, 140),
				'cltv_unsafe'
			]
		];
		for (const [name, mint, code] of cases) {
			const err = await failure(
				s.client.submarine.create(s.provider.id, {
					amountSat: AMOUNT,
					invoice: mint()
				})
			);
			expect(err.code, name).to.equal(code);
		}
		expect(s.client.submarine.list()).to.have.length(1);
	});

	it('refuses a minted invoice whose final CLTV cannot fit before it is minted, and one the node mints wrong afterwards', async function () {
		// Our rule: 1000 + 1 + 40 + 6 must stay under 1050 - 6; it does not.
		const s = scene({ refundDelta: 50 }, { minRefundDeltaBlocks: 20 });
		const err = await failure(
			s.client.submarine.create(s.provider.id, { amountSat: AMOUNT })
		);
		expect(err.code).to.equal('cltv_unsafe');
		expect(s.payer.invoiceCalls).to.have.length(0);
		expect(s.provider.received).to.not.include(
			message.BeignetCustomSubtype.SWAP_SUBMARINE_CREATE
		);
		// A node that ignores the requested final CLTV: caught after minting,
		// the orphaned invoice named in the log.
		const t = scene();
		t.payer.createdCltvOverride = 140;
		const late = await failure(
			t.client.submarine.create(t.provider.id, { amountSat: AMOUNT })
		);
		expect(late.code).to.equal('cltv_unsafe');
		expect(t.logs).to.include('swap_invoice_orphaned');
		expect(t.client.submarine.list()).to.have.length(0);
	});

	it('rejects every wrong ack and stores nothing', async function () {
		const cases: Array<[string, IFakeProviderKnobs, string]> = [
			[
				'declined',
				{ refuse: swaps.SwapRefusalReason.EXPOSURE_EXCEEDED },
				'provider_declined'
			],
			['refund too far', { refundDelta: 5000 }, 'refund_too_late'],
			['wrong script', { wrongScript: true }, 'ack_mismatch'],
			[
				'claim key equals our refund key',
				{ wrongClaimKey: true },
				'ack_mismatch'
			],
			['fee overstated', { overstateFee: true }, 'ack_mismatch'],
			[
				'too deep a funding demanded',
				{ demandDeepFunding: true },
				'ack_mismatch'
			]
		];
		for (const [name, knobs, code] of cases) {
			const s = scene(knobs);
			const err = await failure(
				s.client.submarine.create(s.provider.id, { amountSat: AMOUNT })
			);
			expect(err.code, name).to.equal(code);
			expect(s.client.submarine.list(), name).to.have.length(0);
			expect(s.funder.calls, name).to.have.length(0);
			expect(s.logs, name).to.satisfy(
				(l: string[]) =>
					l.includes('swap_ack_rejected') ||
					l.includes('swap_invoice_orphaned') ||
					code === 'provider_declined'
			);
		}
		// Refused too soon: the provider's window is under our minimum.
		// The window fits our CLTV rule (1047 under 1074) but is under our minimum.
		const soon = scene({ refundDelta: 80 }, { minRefundDeltaBlocks: 100 });
		const err = await failure(
			soon.client.submarine.create(soon.provider.id, { amountSat: AMOUNT })
		);
		expect(err.code).to.equal('refund_too_soon');
		// A silent provider: a timeout, nothing stored, the invoice orphaned.
		const silent = scene({ silent: true });
		await silent.client.submarine
			.create(silent.provider.id, { amountSat: AMOUNT, timeoutMs: 50 })
			.then(
				() => expect.fail('expected a timeout'),
				(e: Error) => expect(e.message).to.match(/did not answer/)
			);
		// The quote went unanswered, so nothing was minted to orphan.
		expect(silent.payer.invoiceCalls).to.have.length(0);
		expect(silent.client.submarine.list()).to.have.length(0);
	});

	it('refuses a fee above the ceiling, a duplicate hash, missing seams and ephemeral storage', async function () {
		const s = scene();
		const fee = await failure(
			s.client.submarine.create(s.provider.id, {
				amountSat: AMOUNT,
				maxTotalFeeSat: 650
			})
		);
		expect(fee.code).to.equal('fee');
		const bolt11 = s.payer.supplyInvoice((100_000n - FEE) * 1000n);
		await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT,
			invoice: bolt11
		});
		const dup = await failure(
			s.client.submarine.create(s.provider.id, {
				amountSat: AMOUNT,
				invoice: bolt11
			})
		);
		expect(dup.code).to.equal('state');

		const { client: clientLink } = linkPair();
		const bare = new SwapClient({ link: clientLink, network: 'regtest' });
		const missing = await failure(
			bare.submarine.create(s.provider.id, { amountSat: AMOUNT })
		);
		expect(missing.code).to.equal('not_configured');
		const payerOnly = new SwapClient({
			link: clientLink,
			network: 'regtest',
			payer: {
				payInvoice: async () => ({ status: 'unknown' as const }),
				trackPayment: async () => ({ status: 'unknown' as const })
			},
			chain: new MockChain()
		});
		const noLookup = await failure(
			payerOnly.submarine.create(s.provider.id, { amountSat: AMOUNT })
		);
		expect(noLookup.code).to.equal('not_configured');
		expect(noLookup.message).to.match(/lookupInvoice/);

		const ephemeral = new SwapClient({
			link: clientLink,
			network: 'regtest',
			payer: s.payer,
			chain: s.chain,
			refuseEphemeralStorage: true
		});
		await ephemeral.submarine.create(s.provider.id, { amountSat: AMOUNT }).then(
			() => expect.fail('expected a refusal'),
			(e: Error) => expect(e.name).to.equal('EphemeralStorageError')
		);
	});
});

describe('SubmarineSwap.fund', function () {
	it('persists the attempt BEFORE the wallet is asked, records the outpoint, and refuses a second call', async function () {
		const s = scene();
		const swap = await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT
		});
		const txid = await swap.fund();
		expect(s.funder.calls).to.have.length(1);
		expect(s.funder.calls[0].attemptPersistedAtCall).to.equal(true);
		expect(s.funder.calls[0].amountSat).to.equal(100_000n);
		expect(s.funder.calls[0].address).to.equal(swap.record().htlcAddress);
		const rec = swap.record();
		expect(rec.state).to.equal('FUNDING');
		expect(rec.fundingAttempt!.txidHex).to.equal(txid);
		expect(rec.funding!.txidHex).to.equal(txid);
		expect(rec.funding!.source).to.equal('funder');
		expect(rec.funding!.valueSat).to.equal('100000');
		const again = await failure(swap.fund());
		expect(again.code).to.equal('already_funded');
		expect(s.funder.calls).to.have.length(1);
		expect(s.logs).to.include('swap_funding_requested');
		expect(s.logs).to.include('swap_funding_seen');
	});

	it('a rejecting wallet keeps the attempt with its error; nothing is retried by run()', async function () {
		const s = scene();
		s.funder.rejectFund = true;
		const swap = await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT
		});
		const err = await failure(swap.fund());
		expect(err.code).to.equal('funding_invalid');
		const rec = swap.record();
		expect(rec.state).to.equal('CREATED');
		expect(rec.fundingAttempt!.error).to.match(/wallet refused/);
		expect(rec.fundingAttempt!.txidHex).to.equal(undefined);
		s.funder.rejectFund = false;
		const running = swap.run();
		await swap.tick();
		await swap.stop();
		await running;
		expect(s.funder.calls).to.have.length(1);
		const forced = await failure(swap.fund());
		expect(forced.code).to.equal('already_funded');
		await swap.fund({ force: true });
		expect(s.funder.calls).to.have.length(2);
		expect(swap.state).to.equal('FUNDING');
	});

	it('refuses to fund without a funder, a short wallet payment never counts, and attachFunding adopts a manual one', async function () {
		const s = scene({}, {}, { funder: false });
		const swap = await s.client.submarine.create(s.provider.id, {
			amountSat: AMOUNT
		});
		const noFunder = await failure(swap.fund());
		expect(noFunder.code).to.equal('not_configured');
		// The host funds by hand (a short one first).
		const t = scene();
		t.funder.shortValue = true;
		const short = await t.client.submarine.create(t.provider.id, {
			amountSat: AMOUNT
		});
		await short.fund();
		expect(short.record().funding).to.equal(undefined);
		expect(short.state).to.equal('CREATED');
		expect(t.logs).to.include('swap_funding_rejected');
		t.funder.shortValue = false;
		const manual = await t.funder.fund(short.record().htlcAddress, 100_000n, {
			label: 'by-hand'
		});
		await short.attachFunding(manual.txidHex);
		expect(short.state).to.equal('FUNDING');
		expect(short.record().funding!.source).to.equal('attached');
		const wrong = await failure(short.attachFunding(manual.txidHex));
		expect(wrong.code).to.equal('already_funded');
	});
});
