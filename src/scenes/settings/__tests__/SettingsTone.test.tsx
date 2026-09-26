import React from 'react';
import type { PropsWithChildren } from 'react';
import { Dimensions, StyleSheet, Switch, Text } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import type { WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../../../design/copy';
import { palette } from '../../../design/palette';
import { defaultProfile } from '../../../services/networks';
import type { WalletAdapter } from '../../../services/wallet';
import type { Backup, CanvasSession, CanvasView } from '../../../stage/Canvas';
import { BackupPanel } from '../../../stage/layers/BackupPanel';
import { CreateSheet } from '../../../stage/layers/CreateSheet';
import { STATUS_ROW } from '../../../stage/layout';
import { CORNER_REACH } from '../../../stage/panes/CornerControl';
import { space } from '../../../theme';
import { OfflineWallet } from '../../phases/Offline';
import { SetupPanel } from '../../phases/parts';
import { Picker } from '../../phases/Picker';
import { StageProvider, useStageStore } from '../../../stage/StageContext';
import { snapshotOf, walletOf } from '../../../../test-support/fixtures';
import { mount } from '../../../../test-support/guard';
import { SettingsLayer } from '../SettingsLayer';
import {
  Action,
  SettingsNetwork,
  Toggle,
  accentFor,
  glyphScale,
  noteLook,
} from '../ui';

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

/** A heading's glyph, grown with Jest's text size as Settings grows it. */
const HEADING_GLYPH = Math.round(
  18 * glyphScale(Dimensions.get('window').fontScale),
);

/** The colour each section heading's glyph is drawn in, by glyph. */
const headingGlyphs = (tree: ReactTestRenderer) =>
  Object.fromEntries(
    tree.root
      .findAll(
        node =>
          typeof node.type !== 'string' &&
          node.props.size === HEADING_GLYPH &&
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
      // Its close sits where the canvas's cog does, its target reaching
      // past the page edge.
      let header: ReactTestInstance | null = host(tree, copy.home.close);
      while (header && flat(header).height !== STATUS_ROW) {
        header = header.parent;
      }
      expect(flat(header!).paddingRight).toBe(space.xl - CORNER_REACH);
      await unmount(tree);
    }
  });

  test("draws a wallet's phrase over a phase in its network's tone", async () => {
    for (const [network, accent] of [
      ['regtest', palette.slate],
      ['mainnet', palette.bloom],
    ] as const) {
      const tree = await mount(
        <OnStage>
          <BackupPanel backup={pending} network={network} onClose={jest.fn()} />
        </OnStage>,
      );
      expect(flat(host(tree, 'Reveal recovery phrase')).backgroundColor).toBe(
        accent,
      );
      await unmount(tree);
    }
  });

  test("draws a phase's setup panel in its network's tone", async () => {
    for (const [network, accent] of [
      ['regtest', palette.slate],
      ['mainnet', palette.bloom],
    ] as const) {
      const tree = await mount(
        <OnStage>
          <SetupPanel network={network}>
            <Action label="Apply" onPress={jest.fn()} />
          </SetupPanel>
        </OnStage>,
      );
      expect(flat(host(tree, 'Apply')).backgroundColor).toBe(accent);
      await unmount(tree);
    }
    // Offline's panel, the network editor and the recovery phrase, takes
    // the wallet's network.
    const tree = await mount(
      <OnStage>
        <OfflineWallet
          name="Everyday"
          network="regtest"
          error="Electrum is offline."
          busy={false}
          networkEditor
          onRetryConnection={jest.fn()}
          onRetrySetup={jest.fn()}
          onToggleNetwork={jest.fn()}
          onApplyNetwork={jest.fn(async () => {})}
          onChooseWallet={jest.fn()}
          onDisconnect={jest.fn()}
          loadPhrase={jest.fn(async () => PHRASE)}
        />
      </OnStage>,
    );
    const [tone] = tree.root.findAllByType(SettingsNetwork);
    expect(tone.props.network).toBe('regtest');
    expect(
      tone.findAll(
        node => node.props.accessibilityLabel === 'Reveal recovery phrase',
      ),
    ).not.toEqual([]);
    await unmount(tree);
  });

  test("hands the picker's network editor the active profile's network", async () => {
    for (const network of ['regtest', 'mainnet'] as const) {
      const tree = await mount(
        <OnStage>
          <Picker
            wallets={[]}
            activeProfile={defaultProfile(network)}
            error=""
            switchError=""
            networkEditor
            selecting={false}
            switchNetwork={jest.fn(async () => {})}
            setNetworkEditor={jest.fn()}
            selectWallet={jest.fn(async () => {})}
            createDefaultWallet={jest.fn(async () => {})}
            disconnect={jest.fn(async () => {})}
            onCreateWallet={jest.fn()}
          />
        </OnStage>,
      );
      const [tone] = tree.root.findAllByType(SettingsNetwork);
      expect(tone.props.network).toBe(network);
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
