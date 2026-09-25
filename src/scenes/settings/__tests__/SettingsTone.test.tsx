import React from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, Switch, Text } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { palette } from '../../../design/palette';
import { defaultProfile } from '../../../services/networks';
import type { WalletAdapter } from '../../../services/wallet';
import type { Backup, CanvasSession, CanvasView } from '../../../stage/Canvas';
import { CreateSheet } from '../../../stage/layers/CreateSheet';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import { snapshotOf, walletOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { SettingsLayer } from '../SettingsLayer';
import { SettingsNetwork, Toggle, accentFor, noteLook } from '../ui';

/**
 * Test against mainnet is a safety state (REDESIGN.md rule 4), so on a test
 * network slate replaces bloom everywhere (3.1, and 6, Wallet health),
 * Settings and the setup surfaces included: their headings, the control a
 * section is for, links, switches, fields, what is in flight and the pull
 * to refresh. Honey, radish and sage keep their meaning.
 */

const PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
}

const session = {
  error: '',
  switchError: '',
  refreshing: false,
  connecting: false,
  refresh: jest.fn(),
  manualRefresh: jest.fn(),
  disconnect: jest.fn(),
  chooseWallet: jest.fn(),
  switchNetwork: jest.fn().mockResolvedValue(undefined),
  eraseDevice: jest.fn().mockResolvedValue(undefined),
} as unknown as CanvasSession;

const view = {
  hidden: false,
  setHidden: jest.fn(),
  unit: 'sats',
  setUnit: jest.fn(),
} as unknown as CanvasView;

function OnStage({ children }: PropsWithChildren) {
  const stage = useStageStore();
  return <StageProvider value={stage}>{children}</StageProvider>;
}

const pending: Backup = {
  pending: true,
  loadPhrase: async () => PHRASE,
  onSaved: jest.fn(),
};

function settings(snapshot: WalletSnapshot) {
  return mount(
    <OnStage>
      <SettingsLayer
        snapshot={snapshot}
        client={client()}
        session={session}
        view={view}
        stale={false}
        backup={pending}
        arrived={0}
      />
    </OnStage>,
  );
}

const regtest = snapshotOf();
const mainnet = snapshotOf({ wallet: walletOf({ network: 'mainnet' }) });

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

/** The host view drawn for the control labelled `label`. */
const host = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

/** The colour each section heading's glyph is drawn in, by glyph. */
const headingGlyphs = (tree: ReactTestRenderer) =>
  Object.fromEntries(
    tree.root
      .findAll(
        node =>
          typeof node.type !== 'string' &&
          node.props.size === 18 &&
          typeof node.props.name === 'string' &&
          typeof node.props.color === 'string',
      )
      .map(node => [node.props.name, node.props.color]),
  );

const unmount = (tree: ReactTestRenderer) => act(async () => tree.unmount());

afterEach(() => {
  jest.mocked(Keychain.getSupportedBiometryType).mockReset();
});

describe('a test network', () => {
  test('takes a switch track in slate', async () => {
    const tree = await mount(
      <SettingsNetwork network="regtest">
        <Toggle
          label="Haptics"
          accessibilityLabel="Haptics"
          value
          onValueChange={jest.fn()}
        />
      </SettingsNetwork>,
    );
    expect(tree.root.findByType(Switch).props.trackColor).toEqual({
      true: palette.slate,
      false: palette.husk,
    });
    await unmount(tree);
  });

  test('draws Settings in slate where mainnet draws bloom', async () => {
    jest
      .mocked(Keychain.getSupportedBiometryType)
      .mockResolvedValue('FaceID' as never);
    const test = await settings(regtest);
    const live = await settings(mainnet);
    for (const [tree, accent] of [
      [test, palette.slate],
      [live, palette.bloom],
    ] as const) {
      // The heading glyphs, the one control a section is for, the switches
      // and the pull to refresh.
      expect(headingGlyphs(tree)).toMatchObject({
        wallet: accent,
        bolt: accent,
        lock: accent,
      });
      expect(flat(host(tree, 'Reveal recovery phrase')).backgroundColor).toBe(
        accent,
      );
      for (const control of tree.root.findAllByType(Switch)) {
        expect(control.props.trackColor.true).toBe(accent);
      }
      expect(tree.root.findAllByType(Switch).length).toBeGreaterThan(0);
      const [refresh] = tree.root.findAll(
        node => node.props.tintColor !== undefined && !!node.props.onRefresh,
      );
      expect(refresh.props.tintColor).toBe(accent);
      expect(refresh.props.colors).toEqual([accent]);
      const change = tree.root.find(
        node =>
          node.type === Text &&
          node.props.children === copy.settings.primary.change,
      );
      expect(flat(change).color).toBe(accent);
    }
    await unmount(test);
    await unmount(live);
  });

  test('makes a wallet on it in slate, and a mainnet one in bloom', async () => {
    for (const [network, accent] of [
      ['regtest', palette.slate],
      ['mainnet', palette.bloom],
    ] as const) {
      const tree = await mount(
        <OnStage>
          <CreateSheet
            client={client()}
            profile={defaultProfile(network)}
            restoring={false}
            onCreated={jest.fn().mockResolvedValue(undefined)}
          />
        </OnStage>,
      );
      const create = host(tree, copy.settings.create.create(network));
      expect(flat(create).backgroundColor).toBe(accent);
      await unmount(tree);
    }
  });

  test('keeps what is in flight in slate too', () => {
    expect(noteLook('pending', accentFor(true))).toMatchObject({
      ink: palette.slate,
      fill: palette.slateSoft,
    });
    expect(noteLook('pending', accentFor(false))).toMatchObject({
      ink: palette.bloom,
      fill: palette.bloomSoft,
    });
    // Honey, radish and sage stay what they are.
    expect(noteLook('warning', accentFor(true)).ink).toBe(palette.honey);
    expect(noteLook('error', accentFor(true)).ink).toBe(palette.radish);
  });
});
