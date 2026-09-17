import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { CreateWalletScreen } from '../src/screens/Settings';
import type { WalletAdapter } from '../src/services/wallet';
function field(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onChangeText === 'function')!;
}
function label(tree: ReactTestRenderer, value: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: value })
    .find(item => typeof item.props.onPress === 'function')!;
}
test('new wallet requires deliberate recovery reveal and backup acknowledgement before entry', async () => {
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const onBusy = jest.fn();
  const phrase =
    'sample fixture words only never use this phrase for a real wallet';
  const createWallet = jest.fn().mockResolvedValue({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'running',
    mnemonic: phrase,
  });
  const client = {
    connection: { url: 'https://wallet.example.com', token: 'test' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={onBusy}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  expect(onCreated).not.toHaveBeenCalled();
  expect(onBusy).toHaveBeenLastCalledWith(true);
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  expect(onCreated).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(onCreated).toHaveBeenCalledWith({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'running',
  });
  await act(async () => {
    tree.unmount();
  });
});

test('failed wallet startup keeps the created wallet backup available for retry', async () => {
  const onCreated = jest
    .fn()
    .mockRejectedValueOnce(new Error('Electrum is offline'))
    .mockResolvedValue(undefined);
  const createWallet = jest.fn().mockResolvedValue({
    id: 'new',
    name: 'Everyday wallet',
    network: 'mainnet',
    status: 'stopped',
    mnemonic: 'sample words for test only',
  });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await act(async () => {
    await label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Electrum is offline');
  expect(JSON.stringify(tree.toJSON())).toContain('Save your recovery phrase.');
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await act(async () => {
    await label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(onCreated).toHaveBeenCalledTimes(2);
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('a committed wallet with a metadata warning still offers its deliberate backup flow', async () => {
  const warning =
    'Your wallet is saved, but its reference for other networks could not be saved.';
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const createWallet = jest
    .fn()
    .mockResolvedValue({
      id: 'committed',
      name: 'Existing creation',
      network: 'mainnet',
      status: 'stopped',
      mnemonic: 'fixture words for testing only',
      warnings: [warning],
    });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    await label(tree, 'Create mainnet wallet').props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain(warning);
  expect(label(tree, 'Reveal recovery phrase')).toBeDefined();
  expect(onCreated).not.toHaveBeenCalled();
  await act(async () => {
    await label(tree, 'Reveal recovery phrase').props.onPress();
  });
  await act(async () => {
    await label(tree, 'I saved my recovery phrase').props.onPress();
  });
  expect(onCreated).toHaveBeenCalledWith({
    id: 'committed',
    name: 'Existing creation',
    network: 'mainnet',
    status: 'stopped',
  });
  expect(createWallet).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('restoring from a phrase sends it once and opens the wallet without a reveal step', async () => {
  const onCreated = jest.fn().mockResolvedValue(undefined);
  const phrase =
    'sample fixture words only never use this phrase for a real wallet';
  const createWallet = jest.fn().mockResolvedValue({
    id: 'restored',
    name: 'Everyday wallet',
    network: 'regtest',
    status: 'running',
    mnemonic: phrase,
  });
  const client = {
    connection: { url: 'embedded:', token: '' },
    getConfig: jest.fn().mockResolvedValue({ hasDefaultElectrum: true }),
    createWallet,
  } as unknown as WalletAdapter;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CreateWalletScreen
        client={client}
        profile={{
          network: 'regtest',
          primaryUri: 'node@host:9735',
          electrum: { host: 'localhost', port: 60001, tls: false },
          transport: 'native',
          relayUrl: '',
          relayToken: '',
        }}
        onCreated={onCreated}
        onBusy={jest.fn()}
      />,
    );
  });
  await act(async () => {
    label(tree, 'I already have a recovery phrase').props.onPress();
  });
  // Eleven words is not a phrase; the button waits.
  await act(async () => {
    field(tree, 'Recovery phrase').props.onChangeText(
      phrase.split(' ').slice(0, 11).join(' '),
    );
  });
  expect(label(tree, 'Restore regtest wallet').props.disabled).toBe(true);
  await act(async () => {
    field(tree, 'Recovery phrase').props.onChangeText(`  ${phrase}  `);
  });
  await act(async () => {
    await label(tree, 'Restore regtest wallet').props.onPress();
  });
  expect(createWallet).toHaveBeenCalledWith(
    expect.objectContaining({ network: 'regtest', mnemonic: `  ${phrase}  ` }),
  );
  // The owner already holds the phrase: straight in, and it is not shown back.
  expect(onCreated).toHaveBeenCalledWith({
    id: 'restored',
    name: 'Everyday wallet',
    network: 'regtest',
    status: 'running',
  });
  expect(JSON.stringify(tree.toJSON())).not.toContain('Reveal recovery phrase');
  await act(async () => {
    tree.unmount();
  });
});
