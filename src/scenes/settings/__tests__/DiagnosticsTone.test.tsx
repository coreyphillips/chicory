import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act } from 'react-test-renderer';
import type { WalletAdapter } from '../../../services/wallet';
import { copy } from '../../../design/copy';
import { palette } from '../../../design/palette';
import {
  clearDiagnostics,
  recordDiagnostic,
} from '../../../services/diagnosticLog';
import { mount } from '../../../../test-support/guard';
import { press } from '../../../../test-support/query';
import { Diagnostics, entryTone } from '../Diagnostics';

/**
 * Settings > Diagnostics lists every line the app showed only as a glyph.
 * Some are failures and some are safety states that are not (REDESIGN.md
 * rule 4); each keeps its semantic colour (3.1), so a test network's line
 * is slate and a backup to save is honey, never the radish of a failure.
 */

const at = (message: string, code?: string) => ({
  at: '2026-09-25T12:00:00.000Z',
  phase: 'ui',
  message,
  ...(code ? { code } : {}),
});

test('a test network is slate, a safety state honey, anything else radish', () => {
  // As the safety signals, Send and Receive log them.
  expect(
    entryTone(at(copy.health.testNetwork('regtest'), 'TEST_NETWORK')),
  ).toBe('test');
  expect(entryTone(at(copy.health.backupPending, 'BACKUP_PENDING'))).toBe(
    'attention',
  );
  expect(entryTone(at(copy.health.stale, 'STALE'))).toBe('attention');
  expect(entryTone(at(copy.receive.expired, 'EXPIRED'))).toBe('attention');
  expect(entryTone(at('Expired.', 'QUOTE_EXPIRED'))).toBe('attention');
  expect(entryTone(at('Held.', 'HELD'))).toBe('attention');
  expect(entryTone(at('Not known yet.', 'UNCERTAIN'))).toBe('attention');
  expect(entryTone(at('Reused.', 'AMBIGUOUS_RECEIVE_ADDRESS'))).toBe(
    'attention',
  );
  expect(entryTone(at('No route was found.', 'NO_ROUTE'))).toBe('failed');
  expect(entryTone(at('The primary did not answer.'))).toBe('failed');
});

test('an entry is coloured by its code, never by matching its words', () => {
  // Words alone, as nothing logs a safety state any more, are a failure.
  expect(entryTone(at(copy.health.testNetwork('regtest')))).toBe('failed');
  expect(entryTone(at(copy.health.stale))).toBe('failed');
  // And the code holds whatever the words become.
  expect(entryTone(at('Any words at all.', 'TEST_NETWORK'))).toBe('test');
  expect(entryTone(at('Any words at all.', 'BACKUP_PENDING'))).toBe(
    'attention',
  );
});

test('each entry is drawn on the wash of its kind', async () => {
  clearDiagnostics();
  const lines = [
    copy.health.testNetwork('regtest'),
    copy.health.backupPending,
    'No route was found.',
  ];
  const codes = ['TEST_NETWORK', 'BACKUP_PENDING', 'NO_ROUTE'];
  lines.forEach((message, index) =>
    recordDiagnostic({ phase: 'ui', message, code: codes[index] }),
  );
  const client = {
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
  const tree = await mount(<Diagnostics client={client} />);
  await press(tree, copy.settings.diagnostics.heading);
  const wash = (message: string) => {
    const [line] = tree.root.findAll(
      node => node.type === Text && node.props.children === message,
    );
    return StyleSheet.flatten(line.parent!.props.style).backgroundColor;
  };
  expect(lines.map(wash)).toEqual([
    palette.slateSoft,
    palette.honeyWash,
    palette.radishWash,
  ]);
  await act(async () => tree.unmount());
  clearDiagnostics();
});
