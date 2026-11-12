/* eslint-env node, es2022 */
'use strict';
// Companion for Iroh.tsx with a Porch link as the primary
// (coreyphillips/beignet#1980). A node with no Lightning listener waits at a
// Porch relay on this computer's loopback, and the app is handed its link.
// Uses only disposable regtest wallets and a loopback control server.
//
// The relay speaks plain WebSocket on 127.0.0.1, which the link's rules allow
// for a loopback host only. TLS to a relay is not exercised here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const source = process.env.BEIGNET_SOURCE_DIR;
if (!source)
  throw Error('Set BEIGNET_SOURCE_DIR to a built Beignet 0.39.0 checkout');
const { BeignetNode } = require(path.join(source, 'dist/cli/beignet-node.js'));
const { PorchRelay } = require(path.join(source, 'dist/cli/porch-relay.js'));
// Fixed, so an Android emulator can be given it with `adb reverse`.
const RELAY_PORT = Number(process.env.PORCH_RELAY_PORT || 31080);
const AUTHORITY = `127.0.0.1:${RELAY_PORT}`;
const btc = (...args) =>
  execFileSync(
    'docker',
    [
      'exec',
      process.env.BEIGNET_REGTEST_BITCOIN || 'bitcoin',
      'bitcoin-cli',
      '-rpcport=43782',
      '-rpcuser=polaruser',
      '-rpcpassword=polarpass',
      '-rpcwallet=default',
      ...args,
    ],
    { encoding: 'utf8', timeout: 20000 },
  ).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(label, read, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await read();
    if (value) {
      console.log('PASS ' + label);
      return value;
    }
    await delay(500);
  }
  throw Error(label + ' timed out');
}
(async () => {
  assert.equal(JSON.parse(btc('getblockchaininfo')).chain, 'regtest');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'porch-native-primary-'));
  const startRelay = async () => {
    const relay = new PorchRelay({ authorities: [AUTHORITY] });
    relay.on('error', () => {});
    await relay.listen(RELAY_PORT, '127.0.0.1');
    return relay;
  };
  let relay = await startRelay();
  // No listenPort: nothing can dial this node. It dials out to the relay.
  const primary = await BeignetNode.create({
    network: 'regtest',
    dataDir: temp,
    allowMultipleInstances: true,
    electrumHost: '127.0.0.1',
    electrumPort: 60001,
    electrumTls: false,
    autoBootstrap: false,
    autoGossipSync: false,
    forwardingEnabled: true,
    jitReceive: { enabled: true, flatFeeSat: 0, feePpm: 0 },
    dfRelay: true,
    porchRelays: [`ws://${AUTHORITY}`],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  assert.equal(primary.getInfo().listenPort, undefined);
  await wait(
    'primary Electrum connected',
    () => primary.getHealth().electrumConnected,
  );
  btc('sendtoaddress', await primary.getNewAddress(), '0.00500000');
  btc('-generate', '1');
  await wait('primary funded', async () => {
    await primary.refreshWallet();
    return primary.getBalance().onchain >= 500000;
  });
  const primaryUri = await wait('Porch link published', () => {
    const links = primary.getPorchLinks();
    return links.listening && relay.stats().standbys > 0
      ? links.links[0]?.uris[0]
      : null;
  });
  assert.match(
    primaryUri,
    new RegExp(
      `^${
        primary.getInfo().nodeId
      }@ws://127\\.0\\.0\\.1:${RELAY_PORT}/v1/p/[a-z2-7]{32}$`,
    ),
  );
  const settings = {
    network: 'regtest',
    primaryUri,
    electrum: { host: '127.0.0.1', port: 60001, tls: false },
    transport: 'native',
    relayUrl: '',
    relayToken: '',
  };
  const queue = [],
    results = new Map();
  let pendingPoll,
    serial = 0,
    running = false;
  const json = (res, value) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  };
  const command = value =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        results.delete(id);
        reject(Error('Native command timed out: ' + JSON.stringify(value)));
      }, 120000);
      results.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      const item = { ...value, id };
      if (pendingPoll) {
        json(pendingPoll, item);
        pendingPoll = null;
      } else queue.push(item);
    });
  const rpc = (route, method = 'GET', body) =>
    command({ path: route, method, body });
  const evidence = [];
  async function qualify(info) {
    console.log('Native wallet connected');
    // Each end sees the other through the relay: the node names the relay the
    // phone came in by, and the phone's peer is a WebSocket one.
    const seen = await wait('primary sees the phone through its link', () =>
      primary.listPeers().find(p => p.pubkey === info.nodeId && p.porch),
    );
    assert.ok(seen.porch.relay.includes(AUTHORITY), JSON.stringify(seen.porch));
    const phonePeer = async () =>
      (await rpc('/peers')).find(p => p.pubkey === primary.getInfo().nodeId);
    assert.equal((await phonePeer()).transport, 'ws');
    const paired = relay.stats().paired;
    assert.ok(paired > 0, 'the relay paired the phone with the node');
    primary.addTrustedPeer(info.nodeId);
    primary.openChannel(info.nodeId, 200000, 0, 2, false, true);
    await wait('native Porch channel usable', async () =>
      (await rpc('/channels')).some(c => c.htlcUsable),
    );
    btc('-generate', '1');
    let expected = 0;
    for (const phase of [
      'initial',
      'after app restart',
      'after relay restart',
    ]) {
      const receive = await rpc('/invoice/create', 'POST', {
        amountSats: 10000,
        description: 'Native Porch receive',
      });
      const paid = await primary.payInvoiceSafe(receive.bolt11, 60000, 100);
      assert.equal(paid.status, 'COMPLETED');
      console.log('PASS primary to phone payment ' + phase);
      expected += 10000;
      const floor = expected - 1000;
      await wait('received balance committed', async () =>
        (
          await rpc('/channels')
        ).some(c => c.htlcUsable && c.localBalanceSats >= floor),
      );
      const invoice = primary.createInvoice(1000, 'Native Porch send', 300);
      const send = await rpc('/invoice/pay-safe', 'POST', {
        bolt11: invoice.bolt11,
        timeoutMs: 60000,
        maxFeeSats: 100,
      });
      assert.equal(send.status, 'COMPLETED', JSON.stringify(send));
      console.log('PASS phone to primary payment ' + phase);
      expected -= 1000;
      evidence.push({
        phase,
        peer: await phonePeer(),
        relayPaired: relay.stats().paired,
        payments: [paid.status, send.status],
      });
      if (phase === 'initial') {
        await command({ operation: 'restart' });
        await wait('channel reestablished after the app restart', async () =>
          (await rpc('/channels')).some(c => c.htlcUsable),
        );
        assert.equal((await phonePeer()).transport, 'ws');
      }
      if (phase === 'after app restart') {
        await relay.close();
        await wait('phone sees the node gone', async () => {
          const peer = await phonePeer();
          return !peer || peer.state !== 'ready';
        });
        relay = await startRelay();
        await wait(
          'node waits at the new relay',
          () => relay.stats().standbys > 0,
          180000,
        );
        await wait(
          'phone is back through the relay by itself',
          async () => {
            const peer = await phonePeer();
            return (
              peer?.state === 'ready' &&
              (await rpc('/channels')).some(c => c.htlcUsable)
            );
          },
          180000,
        );
        assert.ok(relay.stats().paired > 0);
      }
    }
    console.log('PORCH_QUALIFICATION ' + JSON.stringify(evidence));
  }
  const server = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1000000) throw Error('Request too large');
      }
      if (req.url === '/config') return json(res, settings);
      if (req.url === '/next') {
        if (queue.length) return json(res, queue.shift());
        if (pendingPoll) json(pendingPoll, {});
        pendingPoll = res;
        res.on('close', () => {
          if (pendingPoll === res) pendingPoll = null;
        });
        return;
      }
      if (req.url === '/ready') {
        json(res, {});
        if (!running) {
          running = true;
          void qualify(JSON.parse(raw)).catch(error =>
            console.error('FAIL', error.stack),
          );
        }
        return;
      }
      if (req.url === '/error') {
        console.error('NATIVE ERROR', raw);
        return json(res, {});
      }
      if (req.url === '/result') {
        const value = JSON.parse(raw);
        const pending = results.get(value.id);
        results.delete(value.id);
        if (pending)
          value.error
            ? pending.reject(Error(value.error))
            : pending.resolve(value.result);
        return json(res, {});
      }
      res.statusCode = 404;
      res.end();
    } catch (error) {
      res.statusCode = 400;
      res.end(String(error));
    }
  });
  server.listen(31079, '127.0.0.1', () =>
    console.log(
      `Ready for isolated native Porch app on 31079 (relay on ${RELAY_PORT})`,
    ),
  );
  process.on('SIGINT', async () => {
    server.close();
    await primary.gracefulShutdown(5000);
    await relay.close().catch(() => {});
    fs.rmSync(temp, { recursive: true, force: true });
    process.exit(0);
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
