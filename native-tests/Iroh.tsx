/** Isolated regtest entry, built only with a separate application identifier. */
import 'react-native-url-polyfill/auto';
import { registerWalletEngine } from '../src/embedded/registerWalletEngine';
import { walletHost } from '../src/embedded/walletHostNative';
import React, { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, ScrollView, Text } from 'react-native';
import { openDeviceWallet } from '../src/embedded/client';
import { installNativeCrypto } from '../src/embedded/random';

const host = 'http://127.0.0.1:31079';
let nativeEndpointId = '';
if (walletHost.isEngineRuntime) {
  const native = NativeModules.ChicoryIroh;
  const bind = native.bind.bind(native);
  native.bind = async (...args: unknown[]) => {
    const id = await bind(...args);
    if (!/^[0-9a-f]{64}$/.test(id))
      throw Error('Missing native endpoint identity');
    nativeEndpointId = id;
    return id;
  };
}
registerWalletEngine(
  () => async payload =>
    payload === 'fixture-endpoint'
      ? nativeEndpointId
      : require('../src/embedded/walletEngineServer').handleEngineMessage(
          payload,
        ),
);
async function run(report: (message: string) => void) {
  installNativeCrypto();
  const endpoint = () => walletHost.dispatch('fixture-endpoint');
  const settings = await (await fetch(host + '/config')).json();
  // The helper decides the kind of primary: an Iroh address
  // (iroh-primary.cjs, iroh-relay-only-primary.cjs) or a Porch link through a
  // relay on this computer's loopback (porch-primary.cjs).
  if (
    settings.network !== 'regtest' ||
    !/@(iroh:|ws:\/\/127\.0\.0\.1:)/.test(settings.primaryUri)
  )
    throw Error('Iroh or loopback Porch regtest only');
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
    body: JSON.stringify({
      ...(await request('/info')),
      nativeEndpointId: await endpoint(),
    }),
  });
  report(
    settings.primaryUri.includes('@iroh:')
      ? 'Native Iroh wallet ready'
      : 'Native Porch wallet ready',
  );
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
        result = {
          ...(await request('/info')),
          nativeEndpointId: await endpoint(),
        };
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
