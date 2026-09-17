import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { SettingsScreen } from '../src/screens/Settings';
import type { WalletAdapter } from '../src/services/wallet';

function strings(children: unknown, out: string[] = []): string[] {
  if (typeof children === 'string' || typeof children === 'number')
    out.push(String(children));
  else if (Array.isArray(children)) children.forEach(c => strings(c, out));
  else if (children && typeof children === 'object')
    strings((children as { props?: { children?: unknown } }).props?.children, out);
  return out;
}
const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(node => strings(node.props.children))
    .join(' | ');
const press = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onPress === 'function')!;
const field = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onChangeText === 'function')!;

const base: WalletSnapshot = {
  wallet: { id: 'w', name: 'Everyday', network: 'regtest', status: 'running' },
  balance: {
    totalSats: 1000,
    availableSats: 1000,
    pendingSats: 0,
    receivableSats: 5000,
  },
  activity: [],
  primary: { uri: 'node@host:9735', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: Date.now(),
  demo: false,
};

function client(over: Partial<WalletAdapter> = {}) {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0-portable' }),
    snapshot: jest.fn().mockResolvedValue(base),
    getRecoveryPhrase: jest.fn(),
    updatePrimary: jest.fn().mockResolvedValue(base.wallet),
    retrySetup: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as WalletAdapter;
}

async function render(snapshot: WalletSnapshot, adapter: WalletAdapter) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SettingsScreen
        snapshot={snapshot}
        client={adapter}
        switchError=""
        onDisconnect={jest.fn()}
        onChooseWallet={jest.fn()}
        onRefresh={jest.fn()}
        onNetwork={jest.fn()}
      />,
    );
  });
  return tree;
}

test('a committed primary change that reconnected reports success', async () => {
  const adapter = client();
  const tree = await render(base, adapter);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => {
    field(tree, 'Node address').props.onChangeText('other@host:9735');
  });
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(adapter.updatePrimary).toHaveBeenCalledWith('other@host:9735');
  expect(text(tree)).toContain('Primary node updated');
  await act(async () => tree.unmount());
});

test('a committed change that has not reconnected says saved, not failed', async () => {
  // The distinction the browser client draws: once the change commits, calling
  // it unsaved would push the user to change it a second time. The verdict
  // comes from a fresh read after the change, not from the snapshot this
  // screen was rendered with, which still describes the old node.
  const adapter = client({
    snapshot: jest.fn().mockResolvedValue({
      ...base,
      primary: { ...base.primary, connected: false },
    }),
  });
  const tree = await render(base, adapter);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(adapter.updatePrimary).toHaveBeenCalled();
  const rendered = text(tree);
  expect(rendered).toContain('Primary node saved');
  expect(rendered).toContain('has not reconnected');
  await act(async () => tree.unmount());
});

test('a refused change keeps the draft and reports the reason', async () => {
  const adapter = client({
    updatePrimary: jest
      .fn()
      .mockRejectedValue(new Error('That node URI is not valid.')),
  });
  const tree = await render(base, adapter);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => {
    field(tree, 'Node address').props.onChangeText('broken');
  });
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(text(tree)).toContain('That node URI is not valid.');
  // The edit is still on screen with what was typed, ready to correct.
  expect(field(tree, 'Node address').props.value).toBe('broken');
  await act(async () => tree.unmount());
});

test('the engine version reported by the running wallet is shown', async () => {
  const adapter = client();
  const tree = await render(base, adapter);
  expect(text(tree)).toContain('0.15.0-portable');
  await act(async () => tree.unmount());
});

test('a change whose fresh read fails is saved, not failed, and a failed setup is not success', async () => {
  const unreadable = client({
    snapshot: jest.fn().mockRejectedValue(new Error('offline')),
  });
  let tree = await render(base, unreadable);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(unreadable.updatePrimary).toHaveBeenCalled();
  expect(text(tree)).toContain('has not reconnected');
  await act(async () => tree.unmount());

  const failed = client({
    snapshot: jest.fn().mockResolvedValue({
      ...base,
      wallet: { ...base.wallet, lfbw: { enabled: true, setup: 'failed' } },
    }),
  });
  tree = await render(base, failed);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(text(tree)).not.toContain('Primary node updated');
  expect(text(tree)).toContain('has not reconnected');
  await act(async () => tree.unmount());
});

test('the node field follows the wallet it describes', async () => {
  const adapter = client();
  const tree = await render(
    { ...base, primary: { ...base.primary, uri: '' } },
    adapter,
  );
  await act(async () => press(tree, 'Change primary node').props.onPress());
  expect(field(tree, 'Node address').props.value).not.toBe('');
  await act(async () => {
    tree.update(
      <SettingsScreen
        snapshot={{ ...base, primary: { ...base.primary, uri: 'new@host:1' } }}
        client={adapter}
        switchError=""
        onDisconnect={jest.fn()}
        onChooseWallet={jest.fn()}
        onRefresh={jest.fn()}
        onNetwork={jest.fn()}
      />,
    );
  });
  expect(field(tree, 'Node address').props.value).toBe('new@host:1');
  await act(async () => tree.unmount());
});

test('a wallet that reports no engine version shows no engine row', async () => {
  const adapter = client({ getConfig: jest.fn().mockResolvedValue({}) });
  const tree = await render(base, adapter);
  expect(text(tree)).not.toContain('Checking');
  expect(text(tree)).not.toContain('Engine');
  await act(async () => tree.unmount());
});

test('erasing is offered only in device mode, behind a second explicit step', async () => {
  const adapter = client();
  let tree = await render(base, adapter);
  expect(press(tree, 'Erase wallet from this phone')).toBeUndefined();
  await act(async () => tree.unmount());

  const onErase = jest.fn().mockResolvedValue(undefined);
  await act(async () => {
    tree = create(
      <SettingsScreen
        snapshot={base}
        client={adapter}
        switchError=""
        onDisconnect={jest.fn()}
        onChooseWallet={jest.fn()}
        onRefresh={jest.fn()}
        onNetwork={jest.fn()}
        onErase={onErase}
      />,
    );
  });
  expect(press(tree, 'Erase wallet')).toBeUndefined();
  await act(async () =>
    press(tree, 'Erase wallet from this phone').props.onPress(),
  );
  expect(text(tree)).toContain('funds are lost');
  await act(async () => press(tree, 'Keep my wallet').props.onPress());
  expect(press(tree, 'Erase wallet')).toBeUndefined();
  expect(onErase).not.toHaveBeenCalled();
  await act(async () =>
    press(tree, 'Erase wallet from this phone').props.onPress(),
  );
  await act(async () => press(tree, 'Erase wallet').props.onPress());
  expect(onErase).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
