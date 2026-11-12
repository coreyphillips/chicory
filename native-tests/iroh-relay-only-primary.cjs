/* eslint-env node, es2022 */
'use strict';
// Companion for Iroh.tsx against a primary that keeps its Iroh link on the
// relay (Beignet 0.39.0, irohRelayOnly). The primary is not started here: a
// relay-only node on a home network usually trips its own guard, because the
// router maps a port for it, so it runs in a bridged container. This helper
// drives a wallet of the beignet-umbrel app through the manager's API.
// Regtest only: it checks the chain, the wallet and the daemon before it
// opens a channel or mines, and binds its control server on loopback.
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const manager = (
  process.env.PRIMARY_MANAGER_URL || 'http://127.0.0.1:3950'
).replace(/\/$/, '');
const walletId = process.env.PRIMARY_WALLET_ID;
if (!walletId)
  throw Error(
    'Set PRIMARY_WALLET_ID to a funded regtest wallet of the beignet-umbrel manager with the Iroh link and Relay only on',
  );
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
async function call(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const packet = await response.json().catch(() => ({}));
  if (!response.ok || packet.ok === false)
    throw Error(
      packet.error?.message || `${method} ${url} -> ${response.status}`,
    );
  return packet.result;
}
const node = (route, method, body) =>
  call(`${manager}/wallets/${walletId}/api${route}`, method, body);
const app = (route, method, body) =>
  call(`${manager}/api${route}`, method, body);
async function wait(label, read, timeout = 120000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const value = await read();
      if (value) {
        const seconds = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`PASS ${label} (${seconds} s)`);
        return value;
      }
    } catch (error) {
      last = error;
    }
    await delay(500);
  }
  throw Error(label + ' timed out' + (last ? ': ' + last.message : ''));
}

(async () => {
  assert.equal(JSON.parse(btc('getblockchaininfo')).chain, 'regtest');
  const record = await app(`/wallets/${walletId}`);
  assert.equal(record.network, 'regtest');
  assert.equal(record.iroh?.relayOnly, true, 'Relay only is on in the app');
  const info = await node('/info');
  assert.equal(info.irohRelayOnly, true, 'the daemon reports relay only');
  assert.ok(info.irohUri?.includes('?relay='), 'the link carries a relay');
  const primaryUri = info.irohUri;
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
        resolve: result => {
          clearTimeout(timer);
          resolve(result);
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
  const evidence = {
    mode: info.irohRelayOnlyMode,
    paths: {},
    timings: {},
    phases: [],
  };

  // What each side reports about the one connection between them.
  const view = peer =>
    peer && {
      transport: peer.transport,
      path: peer.iroh?.path,
      rttMs: peer.iroh?.rttMs,
    };
  const sides = async phoneId => ({
    phone: view((await rpc('/peers')).find(p => p.pubkey === info.nodeId)),
    node: view((await node('/peers')).find(p => p.pubkey === phoneId)),
  });
  // A direct path would win if one were offered, so every sample has to
  // read relay on both sides.
  async function samplePaths(label, phoneId, seconds) {
    const counts = { phone: {}, node: {} };
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      const now = await sides(phoneId);
      for (const side of ['phone', 'node']) {
        const path = now[side]?.path ?? 'absent';
        counts[side][path] = (counts[side][path] || 0) + 1;
      }
      await delay(250);
    }
    evidence.paths[label] = counts;
    console.log(`PATH ${label} ${JSON.stringify(counts)}`);
    for (const side of ['phone', 'node']) {
      assert.deepEqual(
        Object.keys(counts[side]),
        ['relay'],
        `${label} ${side}`,
      );
    }
  }
  async function payBothWays(phase) {
    const receive = await rpc('/invoice/create', 'POST', {
      amountSats: 10000,
      description: 'Relay only receive',
    });
    const paid = await node('/invoice/pay-safe', 'POST', {
      bolt11: receive.bolt11,
      timeoutMs: 60000,
      maxFeeSats: 100,
    });
    assert.equal(paid.status, 'COMPLETED', JSON.stringify(paid));
    console.log('PASS primary to phone payment ' + phase);
    await wait('received balance committed', async () =>
      (
        await rpc('/channels')
      ).some(c => c.htlcUsable && c.localBalanceSats >= 9000),
    );
    const invoice = await node('/invoice/create', 'POST', {
      amountSats: 1000,
      description: 'Relay only send',
    });
    const send = await rpc('/invoice/pay-safe', 'POST', {
      bolt11: invoice.bolt11,
      timeoutMs: 60000,
      maxFeeSats: 100,
    });
    assert.equal(send.status, 'COMPLETED', JSON.stringify(send));
    console.log('PASS phone to primary payment ' + phase);
    evidence.phases.push({ phase, payments: [paid.status, send.status] });
  }
  const usable = async () => (await rpc('/channels')).some(c => c.htlcUsable);

  async function qualify(phone) {
    console.log('Native wallet connected');
    await wait(
      'the primary lists the phone as an Iroh peer',
      async () => (await sides(phone.nodeId)).node?.transport === 'iroh',
    );
    await samplePaths('after connect', phone.nodeId, 15);
    await node('/trusted-peer/add', 'POST', { pubkey: phone.nodeId });
    await node('/channel/open-zeroconf', 'POST', {
      pubkey: phone.nodeId,
      amountSats: 200000,
    });
    await wait('native Iroh channel usable', usable);
    btc('-generate', '1');
    await payBothWays('initial');

    const next = await command({ operation: 'restart' });
    assert.match(phone.nativeEndpointId, /^[0-9a-f]{64}$/);
    assert.equal(next.nativeEndpointId, phone.nativeEndpointId);
    console.log('PASS native endpoint identity after restart');
    await wait('native channel reestablished', usable);
    await payBothWays('after phone restart');

    // The primary restarts. In this mode its link is away for about twelve
    // seconds longer, and the phone has to find it again unaided.
    await app(`/wallets/${walletId}/stop`, 'POST', {});
    await wait(
      'the phone sees the primary gone',
      async () => !(await usable()),
    );
    await app(`/wallets/${walletId}/start`, 'POST', {});
    const started = Date.now();
    const back = await wait('the relay-only link is back', async () => {
      const now = await node('/info');
      return now.irohUri && now.irohRelayOnly === true ? now : null;
    });
    evidence.timings.linkBackMs = Date.now() - started;
    assert.equal(back.irohUri, primaryUri, 'the same link after the restart');
    await wait('the phone reconnected by itself', usable, 180000);
    evidence.timings.phoneUsableMs = Date.now() - started;
    await samplePaths('after primary restart', phone.nodeId, 10);
    await payBothWays('after primary restart');
    console.log('IROH_RELAY_ONLY_QUALIFICATION ' + JSON.stringify(evidence));
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
          qualify(JSON.parse(raw)).catch(error =>
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
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
