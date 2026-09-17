/**
 * Disposable Android emulator fixture; never import from the production entry.
 * Build explicitly with ENTRY_FILE=native-tests/ColdStartSeed.tsx.
 * Creates one unfunded regtest wallet for an in-place production APK upgrade.
 * It does not write a WalletSession marker, export a seed, or replace a wallet.
 */
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppRegistry, Platform, StyleSheet, Text, View } from 'react-native';
import type { DeviceSettings } from '../src/embedded/client';

const NAME = 'Android restart check 20260905';
const settings: DeviceSettings = {
  network: 'regtest',
  electrum: { host: '127.0.0.1', port: 9, tls: false },
  primaryUri:
    '028c6651b7759f24585df5864b4f1eaa2fc32acd17eecfef316199bf9a7606ba67@127.0.0.1:19846',
  transport: 'native',
  relayUrl: '',
  relayToken: '',
};

function assertDisposablePlatform() {
  if (Platform.OS !== 'android') throw new Error('ANDROID_EMULATOR_REQUIRED');
  const { Model, Brand, Fingerprint } = Platform.constants;
  if (
    !/^sdk_gphone(?:16k|64)?_/.test(Model) ||
    Brand.toLowerCase() !== 'google' ||
    !/sdk_gphone/i.test(Fingerprint)
  ) {
    throw new Error('ANDROID_EMULATOR_REQUIRED');
  }
}

async function seedFixture(): Promise<string> {
  // No wallet storage, keychain or randomness is accessed before this guard.
  assertDisposablePlatform();
  const { loadWalletSession, clearWalletSession } = await import(
    '../src/services/session'
  );
  const previous = await loadWalletSession();
  if (previous) {
    if (
      previous.mode !== 'device' ||
      previous.prepared !== true ||
      previous.walletId ||
      previous.backupPending
    ) {
      throw new Error('EXISTING_ESTABLISHED_SESSION');
    }
    // The prior manual test may have opened empty mainnet storage. Remove
    // only its metadata marker to exercise pre-session wallet discovery.
    await clearWalletSession();
  }
  const { openDeviceWallet } = await import('../src/embedded/client');
  const client = await openDeviceWallet(settings);
  let walletId = '';
  try {
    // The actual runtime also rejects duplicate creation. This explicit check
    // keeps a second fixture launch from modifying an existing regtest wallet.
    if ((await client.listWallets()).length !== 0)
      throw new Error('EXISTING_REGTEST_WALLET');

    const created = await client.createWallet({
      name: NAME,
      network: settings.network,
      primaryUri: settings.primaryUri,
      electrum: settings.electrum,
    });
    // The public creation API returns backup words. Never render, log, persist
    // separately or request them again; only the encrypted engine owns them.
    delete created.mnemonic;
    walletId = created.id;
    const records = await client.listWallets();
    if (
      records.length !== 1 ||
      records[0].id !== walletId ||
      records[0].name !== NAME ||
      records[0].network !== 'regtest'
    ) {
      throw new Error('REGTEST_RECORD_VERIFICATION_FAILED');
    }
  } finally {
    // The ready marker is emitted only after the real engine and encrypted
    // database have both closed, leaving the production APK free to reopen.
    await client.close();
  }
  return `COLD_START_FIXTURE_READY\n${NAME}\nregtest\n${walletId}`;
}

// Avoid duplicate create attempts if React mounts the developer entry twice.
let run: Promise<string> | undefined;
function ColdStartSeed() {
  const [status, setStatus] = useState('COLD_START_FIXTURE_RUNNING');
  useEffect(() => {
    let mounted = true;
    run ??= seedFixture();
    run.then(
      result => {
        console.log(result);
        if (mounted) setStatus(result);
      },
      error => {
        // Error objects from lower layers are intentionally not logged: this
        // fixture exposes fixed failure labels only, never arbitrary payloads.
        const known = [
          'ANDROID_EMULATOR_REQUIRED',
          'EXISTING_REGTEST_WALLET',
          'EXISTING_ESTABLISHED_SESSION',
          'REGTEST_RECORD_VERIFICATION_FAILED',
        ];
        const label =
          error instanceof Error && known.includes(error.message)
            ? error.message
            : 'NATIVE_FIXTURE_FAILED';
        const result = `COLD_START_FIXTURE_FAILED: ${label}`;
        console.log(result);
        if (mounted) setStatus(result);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <View style={styles.page}>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 28, paddingTop: 80, backgroundColor: '#12171b' },
  status: { color: '#f2f1e8', fontSize: 18 },
});

AppRegistry.registerComponent('chicory', () => ColdStartSeed);
