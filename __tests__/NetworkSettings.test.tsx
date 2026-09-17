import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { NetworkSettings } from '../src/screens/NetworkSettings';
import { DEFAULT_REGTEST_ELECTRUM } from '../src/services/networks';
function label(tree: ReactTestRenderer, name: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: name })
    .find(item => typeof item.props.onPress === 'function')!;
}
function field(tree: ReactTestRenderer, name: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: name })
    .find(item => typeof item.props.onChangeText === 'function')!;
}
test('editing a network prepares its own server default; applying switches only after explicit save', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  const onApply = jest.fn().mockResolvedValue(undefined);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <NetworkSettings initialNetwork="mainnet" onApply={onApply} />,
    );
  });
  expect(field(tree, 'Default Electrum server').props.value).toBe('bitkit.to');
  expect(field(tree, 'Default Electrum port').props.value).toBe('9999');
  await act(async () => {
    label(tree, 'Select regtest').props.onPress();
  });
  expect(field(tree, 'Default Electrum server').props.value).toBe(
    DEFAULT_REGTEST_ELECTRUM.host,
  );
  expect(field(tree, 'Default Electrum port').props.value).toBe(
    String(DEFAULT_REGTEST_ELECTRUM.port),
  );
  // Regtest has no primary node until one is supplied, so nothing here dials
  // an onion address for a peer that may not exist.
  expect(field(tree, 'Default primary node').props.value).toBe('');
  await act(async () => {
    field(tree, 'Default Electrum server').props.onChangeText('localhost');
  });
  await act(async () => {
    field(tree, 'Default Electrum port').props.onChangeText('60001');
  });
  expect(onApply).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'Use regtest').props.onPress();
  });
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({
      network: 'regtest',
      electrum: { host: 'localhost', port: 60001, tls: false },
    }),
  );
  const saved = JSON.parse(
    jest.mocked(Keychain.setGenericPassword).mock.calls.at(-1)![1],
  );
  expect(saved.profiles.mainnet.electrum).toEqual({
    host: 'bitkit.to',
    port: 9999,
    tls: true,
  });
  expect(saved.selectedNetwork).toBe('mainnet');
  onApply.mockRejectedValueOnce(new Error('Previous wallet could not close'));
  await act(async () => {
    await label(tree, 'Use regtest').props.onPress();
  });
  const afterFailedSwitch = JSON.parse(
    jest.mocked(Keychain.setGenericPassword).mock.calls.at(-1)![1],
  );
  expect(afterFailedSwitch.selectedNetwork).toBe('mainnet');
  expect(JSON.stringify(tree.toJSON())).toContain(
    'Previous wallet could not close',
  );
  await act(async () => {
    tree.unmount();
  });
});
