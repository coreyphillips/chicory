/** Simulator-only entry. Use a dedicated bundle identifier and regtest data. */
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppRegistry, ScrollView, Text } from 'react-native';
import { openDeviceWallet } from '../src/embedded/client';
import { installNativeCrypto } from '../src/embedded/random';

const endpoint = 'http://127.0.0.1:31078';
async function run(report: (message: string) => void) {
  installNativeCrypto();
  const config = await (await fetch(endpoint + '/config')).json();
  if (config.settings.network !== 'regtest') throw Error('Regtest only');
  const client = await openDeviceWallet(config.settings);
  const wallets = await client.listWallets();
  let wallet = wallets[0];
  if (!wallet)
    wallet = await client.createWallet({
      name: 'Offline receive test',
      network: 'regtest',
      primaryUri: config.settings.primaryUri,
      electrum: config.settings.electrum,
    });
  if (wallet.network !== 'regtest') throw Error('Regtest only');
  client.selectWallet(wallet.id);
  await client.startWallet();
  if (config.phase === 'create') {
    if (wallets.length) throw Error('Use a fresh test bundle identifier');
    const invoice = await client.receive(
      await client.quoteReceive({
        amountSats: 20000,
        description: 'Simulator offline receipt',
      }),
    );
    await fetch(endpoint + '/created', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoice),
    });
    report(
      'PASS saved invoice using native Hermes and SQLCipher. Ready for process termination.',
    );
  } else {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      const snapshot = await client.snapshot();
      const rows = snapshot.activity.filter(
        r => r.paymentHash === config.paymentHash && r.status === 'completed',
      );
      if (rows.length === 1 && rows[0].amountSats === 20000) {
        report(
          'PASS cold launch automatically recovered 20,000 sats with one Activity entry',
        );
        await fetch(endpoint + '/verified', { method: 'POST' });
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Automatic receipt recovery timed out');
  }
}
function OfflineReceive() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    const report = (message: string) => setMessages(old => [...old, message]);
    run(report).catch(error => {
      report('FAIL ' + error.message);
      void fetch(endpoint + '/failed', {
        method: 'POST',
        body: JSON.stringify({ message: error.message }),
      });
    });
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 32, paddingTop: 90 }}>
      {messages.map((message, index) => (
        <Text key={index} style={{ marginBottom: 18 }}>
          {message}
        </Text>
      ))}
    </ScrollView>
  );
}
AppRegistry.registerComponent('chicory', () => OfflineReceive);
