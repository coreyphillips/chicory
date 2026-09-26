import React from 'react';
import { Switch, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../../../design/copy';
import { SettingsScreen } from '../../../screens/Settings';
import { requireUnlock, setLockEnabled } from '../../../services/lock';
import type { WalletAdapter } from '../../../services/wallet';
import {
  PROMPT_SETTLE_MS,
  systemPromptOpen,
} from '../../../stage/systemPrompt';
import { snapshotOf } from '../../../../test-support/fixtures';
import { press } from '../../../../test-support/query';

/**
 * The biometric prompts Settings raises (the P10 device pass): turning the
 * app lock on and confirming an erase are marked as the app's own prompts
 * (`duringSystemPrompt`), so the privacy cover leaves Settings in view behind
 * Face ID rather than blanking it. Revealing the recovery phrase is held to
 * the same in RecoveryPhrase's own suite.
 */

jest.mock('../../../services/lock', () => ({
  ...jest.requireActual('../../../services/lock'),
  supportedBiometry: jest.fn().mockResolvedValue('face'),
  isLockEnabled: jest.fn().mockResolvedValue(false),
  setLockEnabled: jest.fn().mockResolvedValue(undefined),
  requireUnlock: jest.fn().mockResolvedValue(false),
}));

const words = copy.settings;

function client(): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn(),
    updatePrimary: jest.fn(),
    retrySetup: jest.fn(),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
  } as unknown as WalletAdapter;
}

let mounted: ReactTestRenderer | null = null;

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SettingsScreen
        snapshot={snapshotOf()}
        client={client()}
        switchError=""
        onDisconnect={jest.fn()}
        onChooseWallet={jest.fn()}
        onRefresh={jest.fn()}
        onNetwork={jest.fn()}
        onErase={jest.fn().mockResolvedValue(undefined)}
      />,
    );
  });
  mounted = tree;
  return tree;
}

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) await act(async () => tree.unmount());
});

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => node.type === Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'string');

describe('a biometric prompt Settings raises', () => {
  /** Resolves once every span a prompt opened has closed again. */
  const settled = () =>
    act(
      () => new Promise<void>(done => setTimeout(done, PROMPT_SETTLE_MS + 50)),
    );

  test("turning the app lock on is marked as the app's own prompt", async () => {
    let during: boolean | null = null;
    jest.mocked(setLockEnabled).mockImplementation(async () => {
      during = systemPromptOpen();
    });
    const tree = await render();
    await settled();
    expect(systemPromptOpen()).toBe(false);
    const toggle = tree.root.find(
      node =>
        node.type === Switch &&
        node.props.accessibilityLabel === words.phone.requireLabel('Face ID'),
    ) as ReactTestInstance;
    await act(async () => toggle.props.onValueChange(true));
    expect(setLockEnabled).toHaveBeenLastCalledWith(true);
    expect(during).toBe(true);
    await settled();
    expect(systemPromptOpen()).toBe(false);
  });

  test('turning it off raises no prompt, so marks none', async () => {
    let during: boolean | null = null;
    jest.mocked(setLockEnabled).mockImplementation(async () => {
      during = systemPromptOpen();
    });
    const tree = await render();
    await settled();
    const toggle = tree.root.find(
      node =>
        node.type === Switch &&
        node.props.accessibilityLabel === words.phone.requireLabel('Face ID'),
    );
    await act(async () => toggle.props.onValueChange(false));
    expect(setLockEnabled).toHaveBeenLastCalledWith(false);
    expect(during).toBe(false);
  });

  test("confirming an erase is marked as the app's own prompt", async () => {
    let during: boolean | null = null;
    jest.mocked(requireUnlock).mockImplementation(async () => {
      during = systemPromptOpen();
      return false;
    });
    const tree = await render();
    await settled();
    expect(systemPromptOpen()).toBe(false);
    await press(tree, words.erase.link);
    await press(tree, words.erase.confirm);
    expect(requireUnlock).toHaveBeenCalledWith(words.erase.prompt);
    expect(during).toBe(true);
    // Refused, so nothing was erased and the reason is on screen.
    expect(texts(tree)).toContain(words.erase.unconfirmed);
    await settled();
  });
});
