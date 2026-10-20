import React from 'react';
import { NativeModules, Text } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type { WalletAdapter } from '../../../services/wallet';
import { copy } from '../../../design/copy';
import {
  clearDiagnostics,
  recordDiagnostic,
} from '../../../services/diagnosticLog';
import { threadCount } from '../../../services/processInfo';
import { mount } from '../../../../test-support/guard';
import { press } from '../../../../test-support/query';
import { DiagnosticsPanel } from '../Diagnostics';

/**
 * The Diagnostics report carries the process's thread count beside the
 * engine's figures, so a copied report shows a process growing towards the
 * system's limit. A build without the native module, or one it cannot
 * answer in, leaves the figure out rather than failing the report.
 */

const words = copy.settings.diagnostics;

const client = () =>
  ({
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready', peers: 1 }),
  } as unknown as WalletAdapter);

/** The report as the panel draws it, parsed. */
const report = (tree: ReactTestRenderer) => {
  const [node] = tree.root.findAll(
    item =>
      item.type === Text &&
      typeof item.props.children === 'string' &&
      item.props.children.startsWith('{'),
  );
  return JSON.parse(node.props.children) as Record<string, unknown>;
};

afterEach(() => {
  delete NativeModules.ChicoryProcess;
  clearDiagnostics();
});

test('the report carries the thread count, after the engine and before the events', async () => {
  NativeModules.ChicoryProcess = {
    threadCount: jest.fn().mockResolvedValue(1462),
  };
  recordDiagnostic({ phase: 'perf', message: 'boot 1 2 3' });
  const tree = await mount(<DiagnosticsPanel client={client()} />);
  const drawn = report(tree);
  expect(drawn.threads).toBe(1462);
  expect(Object.keys(drawn)).toEqual(['setup', 'peers', 'threads', 'events']);
  // And the copy is the same text.
  jest.mocked(Clipboard.setString).mockClear();
  await press(tree, words.copy);
  const [copied] = jest.mocked(Clipboard.setString).mock.calls[0];
  expect(JSON.parse(copied).threads).toBe(1462);
  await act(async () => tree.unmount());
});

test('refresh reads the count again', async () => {
  const native = { threadCount: jest.fn().mockResolvedValue(40) };
  NativeModules.ChicoryProcess = native;
  const tree = await mount(<DiagnosticsPanel client={client()} />);
  expect(report(tree).threads).toBe(40);
  native.threadCount.mockResolvedValue(1050);
  await press(tree, words.refresh);
  expect(report(tree).threads).toBe(1050);
  expect(native.threadCount).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});

test('a build without the module, or one that cannot answer, leaves the figure out', async () => {
  const without = await mount(<DiagnosticsPanel client={client()} />);
  expect(Object.keys(report(without))).toEqual(['setup', 'peers', 'events']);
  await act(async () => without.unmount());

  NativeModules.ChicoryProcess = {
    threadCount: jest.fn().mockRejectedValue(new Error('unreadable')),
  };
  const failing = await mount(<DiagnosticsPanel client={client()} />);
  expect(Object.keys(report(failing))).toEqual(['setup', 'peers', 'events']);
  await act(async () => failing.unmount());
});

test('only a positive whole number is a count', async () => {
  await expect(threadCount()).resolves.toBeNull();
  for (const answer of [0, -1, 1.5, NaN, '12', undefined]) {
    NativeModules.ChicoryProcess = {
      threadCount: jest.fn().mockResolvedValue(answer),
    };
    await expect(threadCount()).resolves.toBeNull();
  }
  NativeModules.ChicoryProcess = {
    threadCount: jest.fn().mockResolvedValue(963),
  };
  await expect(threadCount()).resolves.toBe(963);
});
