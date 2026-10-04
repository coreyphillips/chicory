/** Release-only regtest fixture. Never selected by the ordinary entry. */
require('react-native-url-polyfill/auto');
const Keychain = require('react-native-keychain');
// The public index re-exports getters. Replace their underlying bindings and
// verify the public import before any wallet or App module can be evaluated.
const functions = require('../node_modules/@op-engineering/op-sqlite/lib/module/functions');
const { replacements, replaceChecked } = require('./send-max/isolation');
const wrapped = replacements(Keychain, functions);
replaceChecked(Keychain, wrapped.keychain);
replaceChecked(functions, wrapped.sqlite);
if (require('@op-engineering/op-sqlite').open !== wrapped.sqlite.open)
  throw new Error('Fixture SQLite binding was not isolated');

const React = require('react');
const { AppRegistry, Text } = require('react-native');
const host = 'http://127.0.0.1:31081';
async function report(kind, value) {
  try {
    await fetch(host + '/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, value }),
    });
  } catch {
    /* Evidence transport never changes a wallet result. */
  }
}
async function prepare() {
  const config = await (await fetch(host + '/config')).json();
  if (
    config.network !== 'regtest' ||
    !/^0[23][a-f0-9]{64}@127\.0\.0\.1:[0-9]+$/.test(config.primaryUri) ||
    config.electrum.host !== '127.0.0.1' ||
    config.electrum.port !== 60001 ||
    config.electrum.tls !== false
  )
    throw new Error('Fixture accepts only the local regtest configuration');
  const networks = require('../src/services/networks');
  const sessions = require('../src/services/session');
  const device = require('../src/embedded/client');
  const saved = await sessions.loadWalletSession();
  const preferences = await networks.loadNetworkPreferences();
  const profile = {
    ...networks.defaultProfile('regtest'),
    ...config,
    network: 'regtest',
  };
  if (
    saved &&
    (saved.network !== 'regtest' ||
      saved.locked ||
      !saved.walletId ||
      preferences.legacyNetwork !== null ||
      preferences.selectedNetwork !== 'regtest' ||
      preferences.profiles.regtest.primaryUri !== config.primaryUri)
  )
    throw new Error('Existing fixture identity does not match this run');
  if (!saved)
    await networks.saveNetworkPreferences({
      ...preferences,
      selectedNetwork: 'regtest',
      legacyNetwork: null,
      profiles: { ...preferences.profiles, regtest: profile },
    });
  const setup = await device.openDeviceWallet(profile, undefined, {
    existingOnly: !!saved,
  });
  try {
    const wallets = await setup.listWallets();
    if (
      wallets.length > 1 ||
      wallets.some(
        wallet =>
          wallet.network !== 'regtest' ||
          wallet.lfbw?.primaryUri !== config.primaryUri,
      )
    )
      throw new Error('Unexpected fixture wallet');
    if (saved && wallets[0]?.id !== saved.walletId)
      throw new Error('Fixture wallet is missing');
    const wallet =
      wallets[0] ||
      (await setup.createWallet({
        name: 'Send max regtest',
        network: 'regtest',
        primaryUri: config.primaryUri,
      }));
    await sessions.saveWalletSession({
      mode: 'device',
      network: 'regtest',
      walletId: wallet.id,
      locked: false,
    });
  } finally {
    await setup.close();
  }
  const open = device.openDeviceWallet;
  const observedOpen = async (...args) => {
    if (args[0].network !== 'regtest')
      throw new Error('Fixture is regtest only');
    const client = await open(...args);
    // These observers only copy public requests and balance/history evidence.
    // Every quote, hold, send and drain is still performed by the normal UI.
    for (const method of [
      'receive',
      'prepareSend',
      'prepareDrain',
      'send',
      'drain',
    ]) {
      if (typeof client[method] !== 'function') continue;
      const call = client[method].bind(client);
      client[method] = async (...input) => {
        const result = await call(...input);
        report(method, result);
        return result;
      };
    }
    const snapshot = client.snapshot.bind(client);
    client.snapshot = async () => {
      const result = await snapshot();
      report('snapshot', result);
      return result;
    };
    return client;
  };
  replaceChecked(device, { openDeviceWallet: observedOpen });
  return require('../App').default;
}
function Qualification() {
  const [App, setApp] = React.useState(null);
  const [error, setError] = React.useState('Preparing isolated regtest wallet');
  React.useEffect(() => {
    prepare()
      .then(component => setApp(() => component))
      .catch(reason => {
        setError(String(reason));
        report('error', String(reason));
      });
  }, []);
  return App
    ? React.createElement(App)
    : React.createElement(Text, null, error);
}
AppRegistry.registerComponent('chicory', () => Qualification);
