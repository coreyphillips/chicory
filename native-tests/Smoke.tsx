/** Development-only entry. Build with ENTRY_FILE=native-tests/Smoke.tsx and a separate bundle id. */
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppRegistry, ScrollView, StyleSheet, Text } from 'react-native';
import { Buffer } from 'buffer';
import { installNativeCrypto, secureRandomBytes } from '../src/embedded/random';
import { openDeviceWallet } from '../src/embedded/client';
import type { DeviceSettings } from '../src/embedded/client';

const settings: DeviceSettings = {
  network: 'regtest',
  primaryUri:
    '028c6651b7759f24585df5864b4f1eaa2fc32acd17eecfef316199bf9a7606ba67@127.0.0.1:19846',
  electrum: { host: '127.0.0.1', port: 60001, tls: false },
  transport: 'native',
  relayUrl: '',
  relayToken: '',
};
const primary =
  '028c6651b7759f24585df5864b4f1eaa2fc32acd17eecfef316199bf9a7606ba67@127.0.0.1:19846';
function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function smoke(report: (message: string) => void) {
  installNativeCrypto();
  const firstRandom = Buffer.from(secureRandomBytes(32)).toString('hex');
  const secondRandom = Buffer.from(secureRandomBytes(32)).toString('hex');
  assert(firstRandom !== secondRandom, 'Native CSPRNG uniqueness failed');
  report('PASS native CSPRNG');
  const { openEncryptedDeviceStorage } = await import(
    '../src/embedded/storage'
  );
  let storage = await openEncryptedDeviceStorage();
  const marker = Buffer.from('BEIGNET_NATIVE_ENCRYPTION_PROBE_NO_FUNDS');
  storage.volume.write('/probe', marker);
  const database = storage.databaseFactory('/probe-db');
  database.exec(
    'CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, payload BLOB)',
  );
  database.transaction(() =>
    database.prepare('INSERT OR REPLACE INTO probe VALUES(1, ?)').run(marker),
  )();
  assert(
    Buffer.isBuffer(
      database.prepare('SELECT payload FROM probe WHERE id = 1').get()?.payload,
    ),
    'SQL BLOB must return Buffer',
  );
  const { open } = await import('@op-engineering/op-sqlite');
  const competingLease = open({ name: 'beignet-runtime-lease.sqlite' });
  let nativeLeaseBlocked = false;
  try {
    competingLease.executeSync('PRAGMA busy_timeout = 0');
    competingLease.executeSync('BEGIN EXCLUSIVE');
  } catch {
    nativeLeaseBlocked = true;
  } finally {
    competingLease.close();
  }
  assert(
    nativeLeaseBlocked,
    'Native SQLite runtime lease did not exclude a competing connection',
  );
  let blocked = false;
  try {
    await openEncryptedDeviceStorage();
  } catch {
    blocked = true;
  }
  assert(blocked, 'Second vault runtime was not excluded');
  storage.close();
  storage = await openEncryptedDeviceStorage();
  assert(
    Buffer.from(storage.volume.read('/probe')!).equals(marker),
    'Encrypted durable volume restart failed',
  );
  assert(
    Buffer.from(
      storage
        .databaseFactory('/probe-db')
        .prepare('SELECT payload FROM probe WHERE id = 1')
        .get()!.payload as Uint8Array,
    ).equals(marker),
    'Committed SQL state restart failed',
  );
  storage.close();
  report(
    'PASS SQLCipher, sync commit, BLOB recovery, exclusive runtime, reopen',
  );
  for (const network of ['mainnet', 'testnet', 'regtest'] as const) {
    const scoped = await openEncryptedDeviceStorage(network);
    scoped.volume.write('/network-isolation-probe', Buffer.from(network));
    scoped.close();
  }
  for (const network of ['mainnet', 'testnet', 'regtest'] as const) {
    const scoped = await openEncryptedDeviceStorage(network);
    assert(
      Buffer.from(
        scoped.volume.read('/network-isolation-probe')!,
      ).toString() === network,
      'Network storage isolation failed',
    );
    scoped.close();
  }
  report('PASS independent mainnet/testnet/regtest encrypted storage reopen');
  const diagnostic = (event: {
    phase: string;
    message: string;
    stack?: string;
  }) => report(`DIAGNOSTIC ${event.phase}: ${event.stack || event.message}`);
  let client = await openDeviceWallet(settings, diagnostic);
  let records = await client.listWallets();
  let wallet = records[0];
  if (!wallet)
    wallet = await client.createWallet({
      name: 'Native regtest smoke',
      network: 'regtest',
      primaryUri: primary,
      electrum: settings.electrum,
    });
  assert(wallet.network === 'regtest', 'Smoke must stay on regtest');
  client.selectWallet(wallet.id);
  await client.startWallet();
  const phrase = await client.getRecoveryPhrase();
  const before = await client.snapshot();
  if (!before.primary.connected) {
    const record = await (
      client as unknown as {
        _runtime: {
          request(input: {
            path: string;
          }): Promise<{ lfbw: { setupError?: string } }>;
        };
      }
    )._runtime.request({ path: `/api/wallets/${wallet.id}` });
    throw new Error(
      `Native BOLT8 peer did not connect: ${
        record.lfbw.setupError || JSON.stringify(before.primary)
      }`,
    );
  }
  report('PASS real Hermes engine, native Electrum TCP, BOLT8 peer');
  // CLN provides the transport peer for this bounded native-platform test.
  // It does not implement Beignet JIT quotes; the separate funded integration
  // test covers the public receive flow against a Beignet liquidity provider.
  const receive = await (
    client as unknown as {
      _runtime: {
        request(input: {
          path: string;
          method: string;
          body: object;
        }): Promise<{ bolt11: string; paymentHash: string }>;
      };
    }
  )._runtime.request({
    path: `/wallets/${wallet.id}/api/invoice/create`,
    method: 'POST',
    body: { amountSats: 12000, description: 'Native Hermes regtest smoke' },
  });
  assert(
    receive.bolt11.startsWith('lnbcrt'),
    'Native signed regtest invoice was not produced',
  );
  report('PASS local invoice signing and durable BOLT11 invoice record');
  const walletId = wallet.id;
  await client.close();
  client = await openDeviceWallet(settings, diagnostic);
  records = await client.listWallets();
  assert(
    records.some(record => record.id === walletId),
    'Wallet identity failed restart',
  );
  client.selectWallet(walletId);
  await client.startWallet();
  assert(
    (await client.getRecoveryPhrase()) === phrase,
    'Local seed failed restart',
  );
  const after = await client.snapshot();
  assert(
    after.activity.some(
      item =>
        item.paymentHash === receive.paymentHash ||
        item.id.includes(receive.paymentHash),
    ),
    'Invoice history failed restart',
  );
  await client.close();
  report(
    'PASS full engine close/reopen, seed restore, invoice history restore',
  );
  report('ALL NATIVE CHECKS PASSED — REGTEST ONLY');
}
function Smoke() {
  const [messages, setMessages] = useState([
    'Starting native regtest verification…',
  ]);
  useEffect(() => {
    const report = (message: string) => {
      console.log(`[BEIGNET_NATIVE_SMOKE] ${message}`);
      setMessages(previous => [...previous, message]);
    };
    smoke(report).catch(error =>
      report(`FAIL ${error instanceof Error ? error.message : String(error)}`),
    );
  }, []);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Beignet native verification</Text>
      {messages.map((message, index) => (
        <Text key={index} style={styles.line}>
          {message}
        </Text>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: {
    padding: 28,
    paddingTop: 80,
    backgroundColor: '#12171b',
    minHeight: '100%',
  },
  title: { color: '#ff785f', fontSize: 28, marginBottom: 24 },
  line: { color: '#f2f1e8', fontSize: 17, marginBottom: 20 },
});
AppRegistry.registerComponent('chicory', () => Smoke);
