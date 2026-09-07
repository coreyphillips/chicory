/**
 * Shared setup for the live reverse swap suites (docker stack): a beignet
 * provider node from SOURCE with the swap role on, its funding paid by
 * Bitcoin Core's wallet, watching the chain through a Core-backed source,
 * and an LND or CLN that opens a real channel to it. Everything the tests
 * mine goes through Core's RPC on 43782 (polaruser/polarpass, wallet
 * `default`), the same stack beignet's own interop tests use.
 */

import { execSync } from 'child_process';
import * as net from 'net';
import { requestJson } from '../src/link/http';
import {
	BitcoindFundingProvider,
	TEST_MNEMONIC,
	bitcoinRpc,
	ensureBitcoindFunds,
	mineBlocks,
	sleep
} from '../node_modules/beignet/tests/lightning/interop/shared-helpers';
import { CoreSwapChainSource } from '../node_modules/beignet/tests/lightning/interop/swap-helpers';
import { LndRestClient } from '../node_modules/beignet/tests/lightning/interop/lnd-client';
import { LightningNode } from '../node_modules/beignet/src/lightning/node/lightning-node';
import { REGTEST_CHAIN_HASH } from '../node_modules/beignet/src/lightning/channel/types';
import {
	FeatureFlags,
	Feature
} from '../node_modules/beignet/src/lightning/features/flags';
import { Network } from '../node_modules/beignet/src/lightning/invoice/types';
import {
	deriveLightningKeysFromMnemonic,
	LnCoinType
} from '../node_modules/beignet/src/lightning/keys/wallet-keys';

export { bitcoinRpc, mineBlocks, sleep };

// ─────────────── LND, without beignet's lnd-helpers (its dynamic imports do
// not type-check under this package's module resolution) ───────────────

export const LND_REST_HOST = process.env.LND_REST_HOST ?? '127.0.0.1';
export const LND_REST_PORT = Number(process.env.LND_REST_PORT ?? 8091);
export const LND_P2P_HOST = process.env.LND_P2P_HOST ?? '127.0.0.1';
export const LND_P2P_PORT = Number(process.env.LND_P2P_PORT ?? 9735);

export function loadLndMacaroon(): string | null {
	return dockerExec(
		'docker exec lnd xxd -p -c 1000 /root/.lnd/data/chain/bitcoin/regtest/admin.macaroon'
	);
}

export async function lndClient(): Promise<LndRestClient | null> {
	const macaroon = loadLndMacaroon();
	if (!macaroon) return null;
	const client = new LndRestClient(LND_REST_HOST, LND_REST_PORT, macaroon);
	try {
		await client.getInfo();
	} catch {
		return null;
	}
	return client;
}

export async function waitForLndSync(
	lnd: LndRestClient,
	timeoutMs = 60_000
): Promise<void> {
	await until(
		'lnd synced',
		async () => {
			const info = await lnd.getInfo();
			return info.synced_to_chain === true;
		},
		timeoutMs
	);
}

export async function fundLndWallet(
	lnd: LndRestClient,
	amountBtc = 1
): Promise<void> {
	await ensureBitcoindFunds(amountBtc + 0.5);
	const address = (await lnd.newAddress()).address;
	await bitcoinRpc('sendtoaddress', [address, amountBtc]);
	await mineBlocks(1);
	await waitForLndSync(lnd);
}

/**
 * Force-close every inactive LND channel and disconnect every peer, so a
 * stale channel to a provider key from an earlier run cannot poison the
 * new peer session (LND marks every channel with a peer inactive when the
 * session drops, and pays nothing over an inactive channel).
 */
export async function cleanupLnd(lnd: LndRestClient): Promise<void> {
	const { channels } = await lnd.listChannels();
	let closed = 0;
	for (const c of channels) {
		if (c.active) continue;
		const [txid, index] = c.channel_point.split(':');
		try {
			await lnd.forceCloseChannel(txid, Number(index));
			closed++;
		} catch {
			/* already closing */
		}
	}
	const { peers } = await lnd.listPeers();
	for (const p of peers) {
		try {
			await lnd.disconnectPeer(p.pub_key);
		} catch {
			/* gone */
		}
	}
	if (closed > 0) {
		await mineBlocks(1);
		await sleep(1_000);
	}
}

/**
 * A channel LND lists as active is not yet one it can pay through: the
 * edge joins LND's own graph a little later, and until then every payment
 * fails with FAILURE_REASON_INSUFFICIENT_BALANCE (pathfinding sees no
 * local channel at all). queryroutes answers only once the edge is there.
 */
export async function waitForLndRoute(
	macaroonHex: string,
	destinationPubkey: string,
	amountSat: number,
	timeoutMs = 60_000
): Promise<void> {
	const ep = {
		host: LND_REST_HOST,
		port: LND_REST_PORT,
		rejectUnauthorized: false,
		headers: { 'Grpc-Metadata-macaroon': macaroonHex }
	};
	await until(
		'lnd can route to the provider',
		async () => {
			try {
				const res = await requestJson<{ routes?: unknown[] }>(
					ep,
					'GET',
					`/v1/graph/routes/${destinationPubkey}/${amountSat}`
				);
				return (res.routes?.length ?? 0) > 0;
			} catch {
				return false;
			}
		},
		timeoutMs
	);
}

export async function waitForLndChannels(
	lnd: LndRestClient,
	count: number,
	timeoutMs = 60_000
): Promise<void> {
	await until(
		`${count} lnd channel(s)`,
		async () => {
			const { channels } = await lnd.listChannels();
			return channels.filter((c) => c.active).length >= count;
		},
		timeoutMs
	);
}

export const REQUIRED = process.env.REQUIRE_SWAP_LIVE === '1';
export const HOST_FROM_DOCKER =
	process.env.LND_DIAL_HOST ?? 'host.docker.internal';

export function dockerExec(cmd: string): string | null {
	try {
		return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return null;
	}
}

export async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as net.AddressInfo).port;
			server.close(() => resolve(port));
		});
	});
}

function features(): FeatureFlags {
	const f = FeatureFlags.empty();
	f.setOptional(Feature.DATA_LOSS_PROTECT);
	f.setOptional(Feature.STATIC_REMOTE_KEY);
	f.setOptional(Feature.PAYMENT_SECRET);
	f.setOptional(Feature.TLV_ONION);
	f.setOptional(Feature.CHANNEL_TYPE);
	f.setOptional(Feature.GOSSIP_QUERIES);
	f.setOptional(Feature.ANCHOR_ZERO_FEE_HTLC);
	f.setOptional(Feature.SCID_ALIAS);
	return f;
}

export const PROVIDER_TIMEOUTS = {
	refundDeltaBlocks: 40,
	minRefundDeltaBlocks: 30,
	maxRefundDeltaBlocks: 80,
	fundingSafetyBlocks: 3,
	resolutionSafetyBlocks: 3
};

export interface ILiveProvider {
	node: LightningNode;
	chain: CoreSwapChainSource;
	port: number;
	/** Structured log lines the provider emitted about swaps and holds. */
	logs: Array<{ action: string; data: Record<string, unknown> }>;
	tick(): Promise<number>;
	stop(): void;
}

/** A provider node listening for the docker node, chain fed by the tests. */
export async function startProvider(
	passphrase: string
): Promise<ILiveProvider> {
	await ensureBitcoindFunds(3);
	const chain = new CoreSwapChainSource();
	await chain.refresh();
	const keys = deriveLightningKeysFromMnemonic(
		TEST_MNEMONIC,
		passphrase,
		LnCoinType.REGTEST
	);
	const node = new LightningNode({
		nodePrivateKey: keys.nodePrivateKey,
		channelBasepoints: keys.channelBasepoints,
		perCommitmentSeed: keys.perCommitmentSeed,
		fundingPrivkey: keys.fundingPrivkey,
		htlcBasepointSecret: keys.htlcBasepointSecret,
		revocationBasepointSecret: keys.revocationBasepointSecret,
		paymentBasepointSecret: keys.paymentBasepointSecret,
		delayedPaymentBasepointSecret: keys.delayedPaymentBasepointSecret,
		network: Network.REGTEST,
		enableNetworking: true,
		localFeatures: features(),
		chainHashes: [REGTEST_CHAIN_HASH],
		preferAnchors: true,
		fundingProvider: new BitcoindFundingProvider(),
		feeEstimator: { estimateFee: async () => 2 },
		swaps: {
			enabled: true,
			chainSource: chain,
			fee: { flatFeeSat: 100n, feePpm: 1_000 },
			confirmations: { fundingConfirmations: 1, resolutionConfirmations: 2 },
			timeouts: PROVIDER_TIMEOUTS
		}
	});
	node.on('node:error', () => undefined);
	node.on('error', () => undefined);
	const logs: ILiveProvider['logs'] = [];
	node.on(
		'log',
		(line: { action?: string; data?: Record<string, unknown> }) => {
			if (line?.action && /swap|held|hold|htlc/.test(line.action)) {
				logs.push({ action: line.action, data: line.data ?? {} });
			}
		}
	);
	const port = await freePort();
	await node.listen(port, '0.0.0.0');
	const tick = async (): Promise<number> => {
		const tip = await chain.refresh();
		node.handleNewBlock(tip);
		await node.getSwapProvider()!.onBlock(tip);
		return tip;
	};
	await tick();
	await node.startSwapProvider();
	return {
		node,
		chain,
		port,
		logs,
		tick,
		stop: (): void => {
			try {
				node.destroy();
			} catch {
				/* ignore */
			}
		}
	};
}

/** Mine, let the docker node see it, then feed the provider its height. */
export async function mineAndTick(
	provider: ILiveProvider,
	blocks: number
): Promise<number> {
	await mineBlocks(blocks);
	await sleep(1_200);
	return provider.tick();
}

export async function until(
	label: string,
	check: () => Promise<boolean>,
	timeoutMs = 90_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await sleep(500);
	}
	throw new Error(`timed out waiting for ${label}`);
}

/** A failure message with everything the provider knows about a swap. */
export function describeSwap(
	provider: ILiveProvider,
	swapIdHex: string
): string {
	const row = providerSwap(provider, swapIdHex);
	return JSON.stringify(
		{
			row,
			logs: provider.logs.slice(-15),
			holds: provider.node.listHoldInvoices()
		},
		(_k, v) => (typeof v === 'bigint' ? v.toString() : v),
		1
	);
}

/** The provider's ledger row for a swap, by id. */
export function providerSwap(
	provider: ILiveProvider,
	swapIdHex: string
): Record<string, unknown> | undefined {
	return provider.node.listSwaps().find((r) => r.id === swapIdHex) as
		| Record<string, unknown>
		| undefined;
}
