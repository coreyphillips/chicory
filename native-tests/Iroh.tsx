/** Isolated regtest entry, built only with a separate application identifier. */
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppRegistry, ScrollView, Text } from 'react-native';
import { openDeviceWallet } from '../src/embedded/client';
import { installNativeCrypto } from '../src/embedded/random';

const host = 'http://127.0.0.1:31079';
async function run(report: (message: string) => void) {
  installNativeCrypto();
  const settings = await (await fetch(host + '/config')).json();
  if (settings.network !== 'regtest' || !settings.primaryUri.includes('@iroh:'))
    throw Error('Iroh regtest only');
  let client = await openDeviceWallet(settings);
  let wallets = await client.listWallets();
  const wallet =
    wallets[0] ||
    (await client.createWallet({
      name: 'Iroh qualification',
      network: 'regtest',
      primaryUri: settings.primaryUri,
    }));
  if (wallet.network !== 'regtest') throw Error('Regtest only');
  client.selectWallet(wallet.id);
  if (wallet.lfbw?.primaryUri !== settings.primaryUri)
    await client.updatePrimary(settings.primaryUri);
  await client.startWallet();
  const request = (path: string, method = 'GET', body?: unknown) =>
    (client as any)._runtime.request({
      method,
      path: `/wallets/${wallet.id}/api${path}`,
      body,
    });
  await fetch(host + '/ready', {
    method: 'POST',
    body: JSON.stringify(await request('/info')),
  });
  report('Native Iroh wallet ready');
  while (true) {
    const command = await (await fetch(host + '/next')).json();
    if (!command.id) continue;
    try {
      let result;
      if (command.operation === 'restart') {
        await client.close();
        client = await openDeviceWallet(settings);
        client.selectWallet(wallet.id);
        await client.startWallet();
        result = await request('/info');
      } else {
        if (
          ![
            '/info',
            '/peers',
            '/channels',
            '/invoice/create',
            '/invoice/pay-safe',
          ].includes(command.path)
        )
          throw Error('Unsupported qualification operation');
        result = await request(command.path, command.method, command.body);
      }
      await fetch(host + '/result', {
        method: 'POST',
        body: JSON.stringify({ id: command.id, result }),
      });
      report('PASS ' + (command.operation || command.path));
    } catch (error) {
      await fetch(host + '/result', {
        method: 'POST',
        body: JSON.stringify({ id: command.id, error: String(error) }),
      });
      report('FAIL ' + String(error));
    }
  }
}
function Qualification() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    void run(message => setLines(old => [...old, message])).catch(error => {
      setLines(old => [...old, String(error)]);
      void fetch(host + '/error', { method: 'POST', body: String(error) });
    });
  }, []);
  return (
    <ScrollView>
      <Text>{lines.join('\n')}</Text>
    </ScrollView>
  );
}
AppRegistry.registerComponent('chicory', () => Qualification);
