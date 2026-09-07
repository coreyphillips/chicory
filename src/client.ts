/**
 * The front door: one object, one beignet node URI, the liquidity protocols
 * a beignet node serves its peers (JIT, direct funding, reverse swaps).
 */

import type { directFunding } from 'beignet/lightning';
import { ChicoryLog, ChicoryNetwork, noopLog } from './types';
import { IPeerLink } from './link/types';
import { INodeUri, parseNodeUri } from './uri';
import { IJitClientOptions, JitClient } from './jit/client';
import { DirectFundingClient } from './direct-funding/client';
import { IWalletDataStorage } from './storage';
import { webSocketSocketFactory, NoisePeerLink } from './link/noise-link';
import { ISwapClientOptions, SwapClient } from './swaps/client';

export interface IBeignetClientOptions {
	link: IPeerLink;
	network: ChicoryNetwork;
	/** Coins to pay direct-funding requests with. Omit for JIT only. */
	wallet?: directFunding.IDfSenderWallet;
	/** Durable home for direct-funding payment records. */
	storage?: IWalletDataStorage;
	jit?: Pick<IJitClientOptions, 'maxFlatFeeSat' | 'maxFeePpm'>;
	sender?: directFunding.IDfSenderConfig;
	/**
	 * Reverse swaps (Lightning to on-chain): a node that pays invoices and a
	 * chain source. Omit both for quotes only.
	 */
	swaps?: Pick<
		ISwapClientOptions,
		'payer' | 'chain' | 'policy' | 'destination'
	>;
	log?: ChicoryLog;
}

export class BeignetClient {
	/** JIT inbound liquidity from a beignet LSP. */
	readonly jit: JitClient;
	private df: DirectFundingClient | null = null;
	private swapClient: SwapClient | null = null;
	private readonly log: ChicoryLog;

	constructor(private readonly options: IBeignetClientOptions) {
		this.log = options.log ?? noopLog;
		this.jit = new JitClient({
			link: options.link,
			...options.jit,
			log: this.log
		});
	}

	/** Third-party direct funding of a beignet wallet's channel. Needs `wallet`. */
	get directFunding(): DirectFundingClient {
		if (!this.df) {
			if (!this.options.wallet) {
				throw new Error(
					'BeignetClient needs a `wallet` to pay direct-funding requests ' +
						'(KeyedUtxoWallet, or any IDfSenderWallet)'
				);
			}
			this.df = new DirectFundingClient({
				link: this.options.link,
				network: this.options.network,
				wallet: this.options.wallet,
				storage: this.options.storage,
				sender: this.options.sender,
				log: this.log
			});
		}
		return this.df;
	}

	/** Swaps against a beignet provider. Quotes need only the link. */
	get swaps(): SwapClient {
		if (!this.swapClient) {
			this.swapClient = new SwapClient({
				link: this.options.link,
				network: this.options.network,
				storage: this.options.storage,
				...this.options.swaps,
				log: this.log
			});
		}
		return this.swapClient;
	}

	get link(): IPeerLink {
		return this.options.link;
	}

	/** Bring the link up (a no-op for the standalone Noise link). */
	async open(): Promise<void> {
		await this.options.link.open?.();
	}

	/** Our identity as the beignet node sees it. */
	nodeIdHex(): string {
		return this.options.link.nodeIdHex();
	}

	/**
	 * Connect to a beignet node by URI (`pubkey@host:port`, or `pubkey@ws://...`
	 * for the standalone link). Returns the parsed address; the pubkey is
	 * what the JIT and direct-funding calls take.
	 */
	async connect(uri: string): Promise<INodeUri> {
		await this.open();
		const parsed = parseNodeUri(uri);
		const link = this.options.link;
		if (parsed.webSocketUrl && link instanceof NoisePeerLink) {
			await link.connectPeer(
				parsed.pubkeyHex,
				parsed.host,
				parsed.port,
				webSocketSocketFactory(parsed.webSocketUrl)
			);
		} else {
			await link.connectPeer(parsed.pubkeyHex, parsed.host, parsed.port);
		}
		this.log('connected', {
			pubkey: parsed.pubkeyHex,
			host: parsed.host,
			port: parsed.port
		});
		return parsed;
	}

	isConnected(pubkeyHex: string): boolean {
		return this.options.link.isPeerConnected(pubkeyHex);
	}

	async close(): Promise<void> {
		this.df?.stop();
		this.swapClient?.stop();
		await this.options.link.close();
	}
}
