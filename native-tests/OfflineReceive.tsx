/** Isolated regtest entry. Never include this entry in a production application bundle. */
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppRegistry, ScrollView, Text, Platform } from 'react-native';
import { openDeviceWallet } from '../src/embedded/client';
import { installNativeCrypto } from '../src/embedded/random';

const endpoint = 'http://127.0.0.1:31078';
async function run(report: (message: string) => void) {
  installNativeCrypto();
  const config = await (await fetch(endpoint + '/config')).json();
  if (config.settings.network !== 'regtest') throw Error('Regtest only');
  const client = await openDeviceWallet(config.settings);
  const wallets = await client.listWallets();
  if (wallets[0]) {
    if (wallets[0].network !== 'regtest') throw Error('Regtest only');
    client.selectWallet(wallets[0].id);
  }
  const runtime = (
    client as unknown as {
      _runtime: { request(body: unknown): Promise<unknown> };
    }
  )._runtime;
  const allowed = [
    'createWallet',
    'startWallet',
    'snapshot',
    'refreshWallet',
    'quoteReceive',
    'receive',
  ];
  report(
    `Ready: ${Platform.OS}, Hermes ${!!(globalThis as any)
      .HermesInternal}, encrypted SQLCipher storage`,
  );
  await fetch(endpoint + '/ready', {
    method: 'POST',
    body: JSON.stringify({
      platform: Platform.OS,
      hermes: !!(globalThis as any).HermesInternal,
      walletCount: wallets.length,
    }),
  });
  for (;;) {
    const command = await (await fetch(endpoint + '/next')).json();
    if (!command.id) continue;
    try {
      let result;
      if (command.operation === 'request')
        result = await runtime.request(command.body);
      else {
        if (!allowed.includes(command.operation))
          throw Error('Unknown qualification operation');
        if (
          command.operation === 'quoteReceive' &&
          command.args[0]?.mode !== 'offline'
        )
          throw Error('Qualification requires explicit offline mode');
        result = await (client as any)[command.operation](
          ...(command.args || []),
        );
      }
      await fetch(endpoint + '/result', {
        method: 'POST',
        body: JSON.stringify({ id: command.id, result }),
      });
      report(`PASS ${command.operation}`);
    } catch (error: any) {
      await fetch(endpoint + '/result', {
        method: 'POST',
        body: JSON.stringify({
          id: command.id,
          error: { message: error.message, code: error.code },
        }),
      });
      report(`REFUSED ${command.operation}: ${error.message}`);
    }
  }
}
function OfflineReceive() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    run(message => setMessages(old => [...old.slice(-20), message])).catch(
      error => {
        setMessages(old => [...old, 'FAIL ' + error.message]);
        void fetch(endpoint + '/failed', {
          method: 'POST',
          body: JSON.stringify({ message: error.message }),
        });
      },
    );
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
