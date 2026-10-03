/* eslint-env node, es2022 */
'use strict';
// Companion for Iroh.tsx. Uses only disposable regtest wallets and a loopback control server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const source = process.env.BEIGNET_SOURCE_DIR;
if (!source)
  throw Error('Set BEIGNET_SOURCE_DIR to a built Beignet 0.26.0 checkout');
const { BeignetNode } = require(path.join(source, 'dist/cli/beignet-node.js'));
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
async function wait(label, read) {
  const until = Date.now() + 120000;
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iroh-native-primary-'));
  const primary = await BeignetNode.create({
    network: 'regtest',
    dataDir: temp,
    allowMultipleInstances: true,
    electrumHost: '127.0.0.1',
    electrumPort: 60001,
    electrumTls: false,
    iroh: true,
    autoBootstrap: false,
    autoGossipSync: false,
    forwardingEnabled: true,
    jitReceive: { enabled: true, flatFeeSat: 0, feePpm: 0 },
    dfRelay: true,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
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
  const primaryUri = await wait('Iroh address published', () => {
    const uri = primary.getInfo().irohUri;
    return uri?.includes('?relay=') ? uri : null;
  });
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
    assert.ok(
      primary
        .listPeers()
        .some(p => p.pubkey === info.nodeId && p.transport === 'iroh'),
    );
    primary.addTrustedPeer(info.nodeId);
    primary.openChannel(info.nodeId, 200000, 0, 2, false, true);
    await wait('native Iroh channel usable', async () =>
      (await rpc('/channels')).some(c => c.htlcUsable),
    );
    btc('-generate', '1');
    for (const phase of ['initial', 'after restart']) {
      const receive = await rpc('/invoice/create', 'POST', {
        amountSats: 10000,
        description: 'Native Iroh receive',
      });
      const paid = await primary.payInvoiceSafe(receive.bolt11, 60000, 100);
      assert.equal(paid.status, 'COMPLETED');
      console.log('PASS primary to phone payment ' + phase);
      await wait('received balance committed', async () =>
        (
          await rpc('/channels')
        ).some(c => c.htlcUsable && c.localBalanceSats >= 9000),
      );
      const invoice = primary.createInvoice(1000, 'Native Iroh send', 300);
      const send = await rpc('/invoice/pay-safe', 'POST', {
        bolt11: invoice.bolt11,
        timeoutMs: 60000,
        maxFeeSats: 100,
      });
      assert.equal(send.status, 'COMPLETED', JSON.stringify(send));
      console.log('PASS phone to primary payment ' + phase);
      evidence.push({
        phase,
        peers: await rpc('/peers'),
        payments: [paid.status, send.status],
      });
      if (phase === 'initial') {
        const next = await command({ operation: 'restart' });
        assert.match(info.nativeEndpointId, /^[0-9a-f]{64}$/);
        assert.equal(next.nativeEndpointId, info.nativeEndpointId);
        console.log('PASS native endpoint identity after restart');
        await wait('native channel reestablished', async () =>
          (await rpc('/channels')).some(c => c.htlcUsable),
        );
      }
    }
    console.log('IROH_QUALIFICATION ' + JSON.stringify(evidence));
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
    console.log('Ready for isolated native Iroh app on 31079'),
  );
  process.on('SIGINT', async () => {
    server.close();
    await primary.gracefulShutdown(5000);
    fs.rmSync(temp, { recursive: true, force: true });
    process.exit(0);
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
