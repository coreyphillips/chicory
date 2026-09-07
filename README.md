# chicory

**A TypeScript client library for beignet's liquidity services.** Supported wallets and Lightning applications can request JIT inbound liquidity, pay a beignet direct-funding request, or swap Lightning funds for on-chain bitcoin. Beignet supplies the liquidity and runs the provider; chicory negotiates the request and coordinates your node, wallet and chain backend. The beignet node must enable the requested service and accept the request under its policy.

chicory uses beignet's codecs and payer engine over custom peer message type 44069. LND and CLN have supplied node links and wallet adapters. An application built directly on rust-lightning can integrate the reference custom-message handler and an application-provided HTTP bridge. Other implementations need suitable messaging and signing adapters.

Reverse swaps (Lightning to on-chain) are implemented here, with supplied LND and CLN adapters and examples. The beignet provider and its prerequisites ([#739](https://github.com/coreyphillips/beignet/pull/739), [#740](https://github.com/coreyphillips/beignet/pull/740)) shipped in beignet 0.15.0. Submarine swaps (on-chain to Lightning) still need a beignet provider engine and a chicory client; that work is specified in [beignet #743](https://github.com/coreyphillips/beignet/issues/743).

```
supported wallet / node -> chicory -> enabled beignet liquidity service
```

## What it does

| Protocol                                    | You are                                        | The beignet node is                             | What happens                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **JIT inbound liquidity** (`client.jit`)    | a wallet with no inbound                       | an LSP with `jitReceive` on                     | You register a receive intent, get an intercept short channel id for your invoice's route hint. When the payment arrives the LSP holds it, opens a zero-conf channel to you (or splices your existing one), then forwards.                                                                                         |
| **Direct funding** (`client.directFunding`) | anyone holding an on-chain coin                | a wallet that minted a BIP 21 request (`bgnq=`) | Your coin becomes an input of the receiver's channel funding transaction. One on-chain payment delivers both the money and the channel. You sign only after verifying the receiver's node-key attestation over the funding output, your change, and your fee ceiling.                                              |
| **Reverse swap** (`client.swaps.reverse`)   | a node with Lightning balance to move on chain | a provider with `BEIGNET_SWAPS` on              | Your node pays a hold invoice. The provider funds a P2WSH contract claimable with your key and preimage. Chicory verifies funding, waits for the required confirmations and claims to your chosen on-chain address before its safety deadline. The claim reveals the preimage that settles your Lightning payment. |

All three use beignet's custom peer protocols. Chicory reuses beignet's codecs and messages; the provider must support the requested protocol. This is not a Boltz API client.

## Liquidity services and swap scope

A submarine swap exchanges on-chain funds for Lightning funds under a hash lock; a reverse swap goes from Lightning to on-chain. The services available through chicory:

- **On-chain to Lightning, for the receiver:** direct funding. Your on-chain coin becomes the _receiver's_ channel funding, so the receiver gets Lightning balance from an on-chain payment. That is a payment to someone else's wallet, not a self-swap, unless you also run the receiving beignet wallet.
- **Lightning to on-chain:** reverse swaps (`client.swaps.reverse`), against a beignet node running the provider role. Your node pays a hold invoice, the provider funds a contract you claim, and your payment settles from the claim. LND and CLN examples send the claim to an address in the paying node's on-chain wallet; integrations can supply another destination.
- **On-chain to a Lightning invoice (submarine):** not yet. Direct funding cannot pay an arbitrary LND or CLN invoice or automatically top up that node's Lightning balance.

A submarine swap needs a different lifecycle on both sides: you fund an on-chain contract, the provider verifies it and pays your Lightning invoice, then the payment's preimage lets the provider claim the contract. If payment fails, you recover your on-chain funds through a timed refund. Beignet already has shared contract, ledger and payment primitives, but the submarine provider engine and Chicory's funding, refund and recovery client are still missing. The current API accepts only `direction: 'reverse'`; changing a direction flag cannot enable the other flow. Combining a submarine swap with a new JIT channel also requires its own integration.

For example, an LND node with Lightning balance can use a reverse swap to receive bitcoin at an on-chain address. An LND node holding only an on-chain coin can pay a beignet direct-funding request, which credits the receiving beignet wallet's channel. Moving that coin into the original LND node's own Lightning balance through a submarine swap remains future work.

### Reverse swaps: what chicory verifies and what you provide

Provide two seams: an `ISwapLightningPayer` (`LndPayer`, `ClnPayer`, or your own: pay an invoice, report a payment by hash, hand out an address; `LndPayer` uses LND's synchronous send, which stays open for the life of the hold, and pages backwards through `/v1/payments` so a busy node's history does not hide the payment) and an `ISwapChain` (`BitcoinCoreChain` over Core's RPC, `ElectrumChain` over any beignet `IChainBackend`, or your own: height, raw transactions, one outpoint's unspent-ness and depth, broadcast).

Before paying, chicory rebuilds the contract from its own hash and claim key plus the provider's refund key and height. It verifies the script, address, invoice hash, amount, network, expiry, fee arithmetic and refund window. The record includes the claim key and preimage and is persisted before requesting payment. Treat that storage as a wallet file.

Provider status is a funding hint. Chicory checks the actual chain output's script, value, unspent status and confirmations. The first claim requires `minFundingConfirmations`, with a hard floor of one, and a tip below `refundHeight - claimSafetyBlocks`. Fee preparation precedes these checks. A restored FUNDED record is checked again and demoted if its funding is unconfirmed. Each claim attempt is persisted before broadcast and can be replaced with a higher-fee claim while unconfirmed.

The claim path remains valid after the refund height; that height enables the provider's competing refund path. Chicory therefore refuses a first preimage disclosure past its safety deadline. If it has already disclosed, it continues following and fee-bumping the claim. In the ordinary unclaimed path, the provider confirms its refund before cancelling the held payment. Chain reorganizations, fees and outages still matter; these mechanisms do not establish an unconditional guarantee against loss.

`resume()` reconciles unresolved swaps from storage and reports records needing payment or errors. An ambiguous payment transport failure remains unknown until the node's payment status establishes an outcome. Bitcoin Core recovery uses stored transaction heights to search older blocks when txindex is unavailable.

### Storage, progress and shutdown

Anything that moves funds needs durable storage. A `BeignetClient` built without `storage` keeps records in memory, and `directFunding.pay` and `swaps.reverse.create` then refuse to start with `EphemeralStorageError`, before any wire traffic, unless `allowEphemeralStorage: true` says the loss on a crash is accepted. Storage you pass is yours to judge, `MemoryStorage` included. A damaged swap document is never read as empty: `restore()` keeps the bytes under a dated `swaps:reverse.damaged.<time>` key, throws a `SwapError` with code `storage` naming it, and overwrites nothing. The swap record still holds the claim key and preimage in the clear; a key-deriving seam so nothing secret is written is tracked as a follow-up.

`client.swaps.reverse.onChange(cb)` reports every persisted state change (`{ swapIdHex, from, to, record }`) across the swaps the client drives, and returns the unsubscribe. `await client.close()` parks every live swap (the pass in flight finishes writing first), stops the direct-funding engine and closes the link. Nothing is cancelled by closing: a payment already handed to the node, a witness already released and a claim already broadcast continue in the node and on the chain, and `resume()` after a restart continues from the persisted state.

`createLndClient({ host, port, macaroonHex, network, storage, chain? })` and `createClnClient({ host, port, rune, network, storage, chain? })` build a client whose link, wallet and Lightning payer are one node; `import ... from 'chicory/lnd'` or `'chicory/cln'` gives the adapters without the rest, and `'chicory/ldk'` the bridge link.

## Choose the link for your node identity

The beignet node serves whoever is on the other end of the Noise connection. Where that identity lives decides which link you use:

| Link             | Identity                                                                  | Use it for                                                                                                           |
| ---------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NoisePeerLink`  | a key chicory holds: ephemeral, or one you pass                           | Paying direct-funding requests from any wallet. JIT only if this process _is_ the node that will accept the channel. |
| `LndPeerLink`    | your LND node, via its REST custom-message API                            | JIT for an LND node. The LSP opens the channel to LND. Also direct funding, authenticated as your LND.               |
| `ClnPeerLink`    | your Core Lightning node, via clnrest + its Socket.IO notification stream | The same for CLN (24.11+ for the Rust clnrest; `open()` waits for the stream to attach so no reply is missed).       |
| `BridgePeerLink` | your rust-lightning application, through its HTTP bridge                  | JIT with the application's node identity; requires the application integration described in `example/ldk-bridge/`.   |

Anything that can send and receive one custom message type can implement a link: implement `IPeerLink` (five methods) and an LDK app or an eclair plugin joins too.

### Per node, today

|                                                     | JIT inbound (wallet)                                                                                                                                                     | Direct funding: pay a request                                                                                                                                                    | Direct funding: be the receiver                        | Reverse swap (Lightning to on-chain)                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **beignet**                                         | yes, skim or hop mode                                                                                                                                                    | yes                                                                                                                                                                              | yes (the daemon, beignet-umbrel)                       | supplied provider (`BEIGNET_SWAPS`); a client integration needs a Lightning payer adapter, with no dedicated beignet payer supplied here                   |
| **LND**                                             | hop-mode authorization and invoice encoding tested with real LND (`LndPeerLink`, `tests/wire/lnd-jit-live.test.ts`); payment settlement is not exercised by that fixture | proof and witness signing tested with real LND for P2WPKH and P2TR (`LndWallet`, `tests/wire/lnd-pay-live.test.ts`); the receiver channel is stubbed, so no funding is broadcast | no: LND has no dual funding                            | yes: `LndPeerLink` + `LndPayer` + `BitcoinCoreChain`, settled end to end against real LND and a real provider (`tests/wire/lnd-reverse-swap-live.test.ts`) |
| **rust-lightning application**                      | reference integration: custom handler, application-provided HTTP bridge, invoice construction and channel acceptance; no live LDK settlement fixture                     | reference coin/key export example; a wallet signing bridge that retains keys in Rust is application work                                                                         | not implemented; channel API work required (see below) | the link works (`BridgePeerLink`); implement `ISwapLightningPayer` over the app's pay and payment-status calls                                             |
| **ldk-node**                                        | no supplied adapter                                                                                                                                                      | no supplied adapter; a separate supported on-chain wallet can pay independently of the node                                                                                      | no supplied receiver integration                       | no supplied adapter                                                                                                                                        |
| **CLN**                                             | hop-mode link implemented (`ClnPeerLink`, CLN 24.11+); no live CLN JIT settlement fixture                                                                                | real P2WPKH and P2TR funding broadcasts, six confirmations, channel balances and sender confirmation tested in `tests/wire/cln-funding-live.test.ts`                             | no                                                     | yes: `ClnPeerLink` + `ClnPayer` + `BitcoinCoreChain`, settled end to end against real CLN (`tests/wire/cln-reverse-swap-live.test.ts`)                     |
| **wallet with an eligible coin and signing access** | n/a                                                                                                                                                                      | confirmed P2WPKH or P2TR key-path coins through a supplied adapter or `IDfSenderWallet`                                                                                          | n/a                                                    | n/a: the swap needs a Lightning node that pays                                                                                                             |

**How an LND node pays without exporting a key.** A direct-funding offer carries an ownership proof by the coin's key. beignet's original form is a signature over a raw digest, which LND's signer will not produce for a wallet key. beignet PR #735 adds a second form over the same statement, a signature in the standard Bitcoin signed-message format, which LND's `SignMessageWithAddr` produces for P2WPKH and P2TR addresses (for taproot, by the internal key; the receiver applies the BIP 86 tweak). `LndWallet` uses that for the proof and LND's `SignPsbt` for the witness, leasing the coin through `LeaseOutput` so LND's own coin selection cannot spend it meanwhile. Two LND quirks are handled for you: `SignPsbt` reads the plain BIP 32 derivation record even on a taproot input and wants the taproot record beside it, and a P2WPKH input has to ask for SIGHASH_ALL explicitly. The live fixture checks these signatures with lnd 0.20 and a real coin of each kind. It runs beignet's receiver engine over TCP with channel negotiation stubbed, and broadcasts nothing.

**How a Core Lightning node pays.** CLN's only coin-key signing call is `signpsbt`, which signs transactions, not messages. Beignet PR #736 adds a proof form for exactly that: the payer signs an unbroadcastable "probe" transaction that spends the coin, whose second input spends a synthetic outpoint with no known transaction preimage, and the receiver verifies the signature as it will later verify the funding witness. `ClnWallet` has CLN sign the probe and the funding through `signpsbt`, reserving the coin with CLN's own `reserveinputs` so its coin selection stays off it. The proof's temporary reservation is released even when signing fails; funding signing uses the reservation already acquired by the sender. CLN reveals a P2WPKH key only inside the signature it makes, so that form hands the key back to the engine with the signature. This is a custom proof inspired by BIP 322, not a BIP 322-compatible message proof. The CLN v26.06 live fixture uses a real coin of each kind, verifies both signatures through beignet's receiver engine, and checks that CLN reports the coin spendable after cleanup. That signature-only fixture stubs negotiation. The separate opt-in `cln-funding-live.test.ts` also exercises real channel negotiation, broadcast, confirmations and receiver credit for both coin kinds.

**Can an LDK wallet be the receiver, the way beignet-umbrel is?** No receiver integration is supplied. Beignet's `DirectFundingReceiver` engine uses an injected `IDfReceiverDeps` surface: mint and store requests, look coins up on chain, open a channel with a third party's input, return the negotiated transaction for signing, supply the payer's witness and attest the funding output with the node key. The inspected rust-lightning 0.2.5 public channel-open API does not supply that contributed-input workflow; its `FundingTransactionReadyForSigning` event alone does not establish support for it. Implementing an LDK receiver requires investigating and extending the channel integration, plus durable recovery and funding validation.

## Install

```bash
npm install chicory      # once published; from a clone: npm install ../chicory
```

chicory depends on `beignet` 0.15.0 or later from npm; that package carries everything the library itself uses. Node 18+.

The test suites are a different matter: the wire and live tests drive beignet's real engines from its source tree, which the npm package does not ship. To run them, clone [beignet](https://github.com/coreyphillips/beignet) next to this checkout (at `../synonym/beignet`, or adjust the `link:beignet` script), run `npm run build` there, then `npm run link:beignet` here so `node_modules/beignet` points at the checkout.

## Quick start

See [the example setup guide](example/README.md) for runnable commands, credentials, wallet inputs and the LDK integration work. The examples are:

| Example                                            | Node                 | Scenario                                                                                                                            |
| -------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `lnd-jit-invoice.ts`                               | LND                  | Register JIT inbound and create an LND invoice; another payer must pay it, and LND must accept the LSP's zero-conf channel          |
| `ldk-jit-invoice.ts`                               | rust-lightning       | JIT inbound through the app's bridge; prints what `RouteHintHop` and the invoice builder need                                       |
| `lnd-pay-request.ts`                               | LND                  | Pay a beignet wallet's direct-funding request from LND's own wallet; the proof and the witness are signed by LND                    |
| `cln-pay-request.ts`                               | Core Lightning       | Pay a beignet wallet's direct-funding request from CLN's own wallet; the proof and the witness are signed by CLN through `signpsbt` |
| [lnd-reverse-swap.ts](example/lnd-reverse-swap.ts) | LND                  | Swap Lightning balance to an on-chain address in LND's wallet; resume from the persisted swap file after restart                    |
| [cln-reverse-swap.ts](example/cln-reverse-swap.ts) | Core Lightning       | Swap Lightning balance to an on-chain address in CLN's wallet; uses clnrest and Bitcoin Core                                        |
| `ldk-pay-request.ts`                               | rust-lightning + BDK | Reference payment from exported coins and private keys; the originating wallet must reserve the coin                                |
| `bare-coin-pay-request.ts`                         | any wallet           | Pay a direct-funding request from a coin and its key                                                                                |
| `ldk-bridge/`                                      | rust-lightning       | Reference Rust `CustomMessageHandler` with unit tests; the HTTP server and runnable LDK node are supplied by the application        |

### JIT inbound liquidity for an LND node

```typescript
import { BeignetClient, LndPeerLink } from 'chicory';

const client = new BeignetClient({
	network: 'regtest',
	link: new LndPeerLink({
		host: '127.0.0.1',
		port: 8080,
		macaroonHex,
		rejectUnauthorized: false
	})
});

const lsp = await client.connect('02abc...@lsp.example:9735');

// Price it first. Registers nothing.
const quote = await client.jit.quote(lsp.pubkeyHex, { maxAmountSat: 100_000 });
console.log(
	quote.accepted,
	quote.flatFeeSat,
	quote.feePpm,
	quote.feeSats,
	quote.reason
);

// Register the intent. Throws JitDeclinedError if the LSP declines or its fee is above your ceilings.
// LND cannot settle a short HTLC, so the fee goes into the hint (hop mode); see "Who pays the opening fee".
const grant = await client.jit.authorize(lsp.pubkeyHex, {
	maxAmountSat: 100_000,
	expectedTotalSat: 100_000
});

// Then, on LND:
await lnd.addInvoice({
	value: 100_000,
	route_hints: [{ hop_hints: [grant.lndHopHint()] }],
	cltv_expiry: grant.minFinalCltvExpiry // 72
});
```

For JIT delivery, LND must enable `protocol.option-scid-alias` and `protocol.zero-conf` and run a channel acceptor that accepts zero-conf from the trusted LSP. The example creates the invoice; it does not install this acceptor or pay the invoice. See the [LND channel-acceptor documentation](https://github.com/lightninglabs/docs.lightning.engineering/blob/master/lightning-network-tools/lnd/channel-acceptor.md).

The grant also carries the raw hint (`grant.routeHint`, fee terms per `grant.feeMode`, cltv delta 80), the short channel id as bytes, hex and CLN's `BLOCKxTXxOUT`, and `grant.openingFeeSats(total)` for the quoted opening fee: the sender pays it in hop mode, or the receiver authorizes its deduction in skim mode.

### Paying a direct-funding request from a bare coin

```typescript
import {
	BeignetClient,
	FileStorage,
	KeyedUtxoWallet,
	NoisePeerLink
} from 'chicory';

const wallet = new KeyedUtxoWallet({
	network: 'mainnet',
	coins: [{ txid, vout, valueSat, address, height, privateKey }], // P2WPKH or P2TR key path
	changeAddress: 'bc1q...',
	getTransaction: (txid) => fetchRawTx(txid), // Electrum, Esplora, Core, anything
	blockHeight: () => tip
});

const client = new BeignetClient({
	network: 'mainnet',
	link: new NoisePeerLink({ network: 'mainnet' }), // ephemeral identity
	wallet,
	storage: new FileStorage('~/.chicory/payments.json')
});

const bip21 = 'bitcoin:bc1q...?amount=0.001&bgnq=...'; // what the beignet wallet showed
const info = client.directFunding.inspect(bip21); // verified offline: signer, chain, expiry, lanes
const result = await client.directFunding.pay(bip21, {
	amountSat: 100_000,
	maxTotalFeeSat: 1_000
});
console.log(
	result.status,
	result.fundingTxid,
	result.attested,
	result.receiptPreimageHex
);
```

`pay` rejects only before the funding witness leaves the device. A rejected attempt may have produced a local signature that was discarded. Once the witness is released, the receiver can broadcast, and the call resolves with `caveat` set if the receipt did not arrive. Confirmation is tracked separately through `payments()` and `reconcile()`. Paying the same request twice replays the recorded outcome. The engine excludes an offered coin from its own selection and freezes it in the wallet immediately before funding signing.

A wallet that already has coins and keys (a beignet `Wallet`, LDK, bdk) skips `KeyedUtxoWallet` and implements `IDfSenderWallet` directly; beignet's own adapter in `src/cli/direct-funding.ts` is the reference.

Direct funding runs over two of beignet's three lanes: a direct peer connection to the receiver, and a blind relay through the receiver's LSP (so a phone wallet behind its LSP is reachable). The onion-message lane needs a BOLT 12 onion stack chicory does not carry; a request offering only that lane is reported `reachable: false` and refused without spending.

CLN reserves only the selected coin, once per funding signature. Ownership probes use a temporary reservation that is released even when signing fails. Refreshes and reservation changes are serialized, and release checks CLN's reported state. `reserveBlocks` defaults to 144 blocks; CLN reservations expire and this adapter does not automatically renew them. Keep the payment ledger and reconcile pending funding before reusing a coin. After an interrupted or ambiguous RPC, inspect the node's actual reservation state before manually changing a lease.

## Who pays the opening fee

A beignet LSP collects its JIT opening fee one of two ways, and the ack tells chicory which (`grant.feeMode`, beignet PR #734):

- **hop** (what LND and CLN get, the default here): the fee terms go into the invoice's route hint as an ordinary routing fee, the _sender_ pays them on top, and the LSP forwards the full amount. The final HTLC equals the onion amount, so any node settles it. `grant.routeHint` and `grant.lndHopHint()` already carry the terms; put them in the invoice as they are. The LSP checks the fee actually arrived before it funds anything, so a payer that ignores the hint's fee gets a plain temporary failure and no channel.
- **skim** (`acceptsSkimmedFee: true`): the fee is deducted from the forwarded HTLC, which arrives _short_ of the onion amount. Only a node that implements the allowance settles that (a beignet wallet does; LND and CLN fail it with `final_incorrect_htlc_amount`). Say true only from a node that can honour it; the hint's fee is zero.

An LSP running beignet older than PR #734 declines a hop-mode intent when it charges a fee; chicory surfaces that as `JitDeclinedError` with the LSP's reason. A zero-fee LSP serves either kind.

## Not covered

- **Liquidity ads (bLIP-51)** are a standard protocol; a dual-funding node already negotiates them with beignet without chicory.
- **FFOR offline receive** (settlement peers, witnesses, issuers) is a channel-level protocol between a wallet and its settlement peer, out of scope here.
- **Being the LSP.** chicory is the client side. A beignet node is the server.
- **Eclair** has no custom-message API without a plugin; write a five-method `IPeerLink` over that plugin.

## API

```
createLndClient({ host, port, macaroonHex, network, storage, chain?, ... })   from 'chicory/lnd'
createClnClient({ host, port, rune, network, storage, chain?, ... })          from 'chicory/cln'
BeignetClient({ link, network, wallet?, storage?, allowEphemeralStorage?, jit?, sender?, swaps?, log? })
  .connect(uri) -> { pubkeyHex, host, port }     .open()  .close()  .nodeIdHex()  .isConnected(pubkey)
  .jit.quote(lsp, { maxAmountSat?, targetRemainingInboundSat?, timeoutMs? })
  .jit.authorize(lsp, { maxAmountSat, expectedTotalSat?, paymentHash?, expirySeconds?, acceptsSkimmedFee?, maxFlatFeeSat?, maxFeePpm? })
  .directFunding.inspect(requestOrBip21)  .quote(...)  .pay(requestOrBip21, { amountSat?, maxTotalFeeSat? })
  .directFunding.payments()  .reconcile()  .start()  .stop()
  .swaps.quote(provider, { direction: 'reverse', amountSat? })
  .swaps.reverse.create(provider, { amountSat, maxTotalFeeSat?, claimKey?, preimage?, destinationScript? }) -> ReverseSwap
  .swaps.reverse.run(provider, params)  .list()  .get(swapId)  .resume({ pay?, run? })  .onChange(cb)  .stop()
  ReverseSwap: .record()  .status()  .pay()  .tick()  .run()  .claim()  .bumpClaim()  .stop() (awaitable)

Swap seams: LndPayer({ host, port, macaroonHex, network })     ClnPayer({ host, port, rune, network })
            BitcoinCoreChain({ host, port, user, pass, wallet? })  ElectrumChain(beignet IChainBackend)
            swaps: { payer, chain, policy?, destination? }; policy defaults in SWAP_DEFAULT_POLICY

Links:      NoisePeerLink({ network, privateKey?, createSocket? })
            LndPeerLink({ host, port, macaroonHex, ca? | rejectUnauthorized? })
            ClnPeerLink({ host, port, rune, notifications? })
            BridgePeerLink({ host, port, token? })      rust-lightning apps, see example/ldk-bridge/
Wallet:     KeyedUtxoWallet({ network, coins, changeAddress | changeScript, getTransaction, blockHeight? })
            LndWallet({ host, port, macaroonHex, network, ca? | rejectUnauthorized?, minConfs? })
            ClnWallet({ host, port, rune, network, getTransaction?, reserveBlocks? })
Storage:    MemoryStorage(), FileStorage(path)          also 'chicory/storage'; fund-moving calls need one you chose
```

`log` is a `(action, data) => void` sink; `consoleLog()` prints to stderr. Amounts are satoshis, `number` or `bigint` in, `bigint` out.

## Tests

```bash
npm run test:unit # local fake-node and wallet tests
npm test          # all suites; live fixtures skip when their node is unavailable
```

Every suite, the unit tests included, imports beignet's source and test helpers through `node_modules/beignet`, so link a built beignet checkout at 0.15.0 or later first (see Install). The npm package alone runs the library, not the tests.

`npm run test:live` runs three suites against beignet's regtest Docker stack, skipping unavailable nodes or coin kinds. The LND JIT suite verifies the peer connection, receive authorization and BOLT 11 hint encoding; it does not fund a channel or settle a payment. The LND and CLN direct-funding suites use each node's P2WPKH and P2TR coins to sign ownership proofs and funding witnesses. They exercise beignet's receiver engine over TCP, but stub its channel negotiation and do not broadcast or confirm a funding transaction. The CLN suite also asserts that cleanup releases the selected coin in CLN's fresh wallet snapshot.

`REQUIRE_SWAP_LIVE=1 npm run test:swap:live` runs the two reverse swap suites against the same stack: a beignet provider node from source (funded by Core's wallet) and a real LND or CLN that opens a channel to it, pays the hold invoice through `LndPayer` or `ClnPayer`, and has chicory claim the contract to its own address through `BitcoinCoreChain`; each asserts chicory ends CLAIMED, the node's payment SUCCEEDED with chicory's preimage, and the claim output confirmed to the node's address. `tests/wire/reverse-swap-engine.test.ts` runs without docker: chicory against beignet's real provider engine over a real Noise connection, with the provider's chain, hold invoice and wallet faked.

`REQUIRE_CLN_FUNDING_LIVE=1 npm run test:funding:live` runs the additional real funding suite. It uses two actual beignet LightningNodes, CLN wallet signing, Bitcoin Core broadcast and six confirmations, then checks both channels are NORMAL, the receiver has the requested balance, and the sender records CONFIRMED. It creates regtest channels and retains their databases and payer recovery records in the printed temporary directories.

Run live suites sequentially when they share Docker nodes. In particular, Chicory's CLN swap suite and beignet's CLN interop suite must not run against the same node at the same time; use separate stacks for parallel runs.

The remaining wire suites cover:

- `tests/wire/jit-over-tcp.test.ts` starts a **real beignet `LightningNode`** with JIT receive on, listening on a loopback port. chicory dials it with an identity it has never seen; the quote and the intent go over a real Noise connection, and the LSP's own intent ledger records chicory's key as the wallet it will open to. Also covers hop mode against a fee-charging LSP, skim mode, the zero-fee case, fee ceilings, and timeout against a node without JIT.
- `tests/wire/direct-funding-over-tcp.test.ts` runs beignet's **real `DirectFundingReceiver` engine and lanes** on a real listening `PeerManager` with the receiver's real node key. chicory pays over the direct-peer lane and, in a second case, through a third node acting as blind relay. The channel is the one thing stubbed (beignet's own end-to-end harness), because the interactive-tx machinery has suites of its own.
- `tests/unit/` covers the LND, CLN and bridge links against fake node APIs (exact endpoints, base64/hex encodings, streaming, WebSocket and SSE shapes), `LndWallet` against a fake LND that signs the way lnd does and pays the real receiver over TCP for both coin kinds, the keyed wallet's ECDSA and Schnorr signatures, URIs and storage.

## How it relates to beignet

chicory imports `beignet/lightning` and uses, unchanged: `transport.Peer` (Noise), `message` (the 44069 envelope), `liquidity` (JIT codecs and fee arithmetic), `directFunding` (envelope, frames, messages, the transport registry with its direct-peer and relay lanes, and `DirectFundingSender`, the payer engine), and `swaps` (the wire codecs, `verifyReverseSwapTerms`, `buildSwapHtlc`, `buildSwapClaimTx`, `extractSwapPreimage`). The provider side of a swap is beignet's `ReverseSwapProvider`; chicory never holds or settles an invoice. beignet 0.15.0 is the first release with every API chicory uses. The seam it plugs into is `IDfPeerMessaging`, the five-method interface beignet's engines already take, which is why an `LndPeerLink` can drive beignet's direct-funding payer engine without beignet knowing.

Two constants are mirrored rather than imported because beignet keeps them private to its node class: the JIT hint's cltv delta (80) and the invoice's min final cltv (72). If beignet changes them, `src/jit/client.ts` should follow.

## License

MIT
