import React from 'react';
import { AccessibilityInfo, AppState, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import * as Keychain from 'react-native-keychain';
import type { WalletRecord, WalletSnapshot } from '@beignet/wallet-core';
import { copy } from '../src/design/copy';
import { GLYPHS } from '../src/design/glyphs';
import type { GlyphName } from '../src/design/glyphs';
import { haptics } from '../src/design/haptics';
import { drawPlan } from '../src/scenes/settings/motion';
import { SettingsScreen, WalletPicker } from '../src/screens/Settings';
import {
  clearDiagnostics,
  recentDiagnostics,
  recordDiagnostic,
} from '../src/services/diagnosticLog';
import { setHapticsEnabled } from '../src/services/haptics';
import type { WalletAdapter } from '../src/services/wallet';
import { APP_VERSION } from '../src/version';
import { ACTIVATE, activate } from '../test-support/query';

function strings(children: unknown, out: string[] = []): string[] {
  if (typeof children === 'string' || typeof children === 'number')
    out.push(String(children));
  else if (Array.isArray(children)) children.forEach(c => strings(c, out));
  else if (children && typeof children === 'object')
    strings(
      (children as { props?: { children?: unknown } }).props?.children,
      out,
    );
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
    getConfig: jest
      .fn()
      .mockResolvedValue({ engineVersion: '0.15.0-portable' }),
    snapshot: jest.fn().mockResolvedValue(base),
    getRecoveryPhrase: jest.fn(),
    updatePrimary: jest.fn().mockResolvedValue(base.wallet),
    retrySetup: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as WalletAdapter;
}

async function render(
  snapshot: WalletSnapshot,
  adapter: WalletAdapter,
  backup: { backupPending?: boolean; onBackupSaved?: () => void } = {},
) {
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
        {...backup}
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

test('a wallet that reports no engine version shows no engine row, nor any while it is asked', async () => {
  let answer!: (config: object) => void;
  const getConfig = jest.fn().mockReturnValue(
    new Promise(resolve => {
      answer = resolve;
    }),
  );
  const tree = await render(base, client({ getConfig }));
  const about = () =>
    tree.root
      .findAllByType(Text)
      .map(node => strings(node.props.children).join(''))
      .filter(line => line.startsWith('Chicory '));
  // Still asking: the line names the app alone, with no word standing in for
  // the version that has not come.
  expect(getConfig).toHaveBeenCalledTimes(1);
  expect(about()).toEqual([`Chicory ${APP_VERSION}`]);
  await act(async () => answer({}));
  expect(about()).toEqual([`Chicory ${APP_VERSION}`]);
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

/** The section headings, top to bottom. */
const headings = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .filter(node => node.props.accessibilityRole === 'header')
    .map(node => strings(node.props.children).join(''));

describe('the recovery phrase still to be saved', () => {
  const PHRASE =
    'one two three four five six seven eight nine ten eleven twelve';
  const SAVED = 'I saved my recovery phrase';
  const played = () =>
    jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);
  const words = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        node =>
          typeof node.type === 'string' &&
          /^\d+\. /.test(node.props.accessibilityLabel ?? ''),
      )
      .map(node => node.props.accessibilityLabel);
  const hold = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === SAVED &&
        typeof node.props.onPressIn === 'function',
    )[0];
  const pending = async (onBackupSaved: () => void) => {
    const adapter = client({
      getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    });
    const tree = await render(base, adapter, {
      backupPending: true,
      onBackupSaved,
    });
    await act(async () =>
      press(tree, 'Reveal recovery phrase').props.onPress(),
    );
    return tree;
  };

  test('leads Settings in honey, and slides back to its place once saved', async () => {
    const onBackupSaved = jest.fn();
    const tree = await render(base, client(), {
      backupPending: true,
      onBackupSaved,
    });
    expect(headings(tree)[0]).toBe('Save your recovery phrase.');
    expect(press(tree, SAVED)).toBeUndefined();
    await act(async () => {
      tree.update(
        <SettingsScreen
          snapshot={base}
          client={client()}
          switchError=""
          onDisconnect={jest.fn()}
          onChooseWallet={jest.fn()}
          onRefresh={jest.fn()}
          onNetwork={jest.fn()}
          onBackupSaved={onBackupSaved}
        />,
      );
    });
    const after = headings(tree);
    expect(after[0]).toBe('Wallet');
    expect(after).toContain('Recovery phrase');
    expect(after).not.toContain('Save your recovery phrase.');
    await act(async () => tree.unmount());
  });

  test('shows the words in reading order, then takes a 900ms hold, not a tap', async () => {
    jest.useFakeTimers();
    try {
      const onBackupSaved = jest.fn();
      const tree = await pending(onBackupSaved);
      expect(words(tree)).toEqual(
        PHRASE.split(' ').map((word, index) => `${index + 1}. ${word}`),
      );
      // A finger's tap, however deliberate, saves nothing.
      act(() => {
        hold(tree).props.onPressIn();
        hold(tree).props.onPress();
        hold(tree).props.onPressOut();
      });
      act(() => jest.advanceTimersByTime(2000));
      expect(onBackupSaved).not.toHaveBeenCalled();
      // Nor does letting go before the ring has filled.
      act(() => {
        hold(tree).props.onPressIn();
        jest.advanceTimersByTime(600);
        hold(tree).props.onPressOut();
        jest.advanceTimersByTime(2000);
      });
      expect(onBackupSaved).not.toHaveBeenCalled();
      jest.mocked(HapticFeedback.trigger).mockClear();
      act(() => {
        hold(tree).props.onPressIn();
        jest.advanceTimersByTime(899);
      });
      expect(onBackupSaved).not.toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(1));
      expect(onBackupSaved).toHaveBeenCalledTimes(1);
      // Pressed in, a tick at each quarter, the thud, then the success.
      expect(played()).toEqual([
        'impactLight',
        'selection',
        'selection',
        'selection',
        'impactMedium',
        'notificationSuccess',
      ]);
      // The words are gone the moment it is saved.
      expect(words(tree)).toEqual([]);
      await act(async () => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  test('a screen reader confirms with one activate action, once', async () => {
    const onBackupSaved = jest.fn();
    const tree = await pending(onBackupSaved);
    const control = hold(tree);
    expect(control.props.accessibilityActions).toEqual([{ name: 'activate' }]);
    await act(async () => {
      control.props.onAccessibilityAction({
        nativeEvent: { actionName: 'magicTap' },
      });
    });
    expect(onBackupSaved).not.toHaveBeenCalled();
    await act(async () => {
      control.props.onAccessibilityAction(ACTIVATE);
      control.props.onAccessibilityAction(ACTIVATE);
    });
    expect(onBackupSaved).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('a press no finger started, as a switch or keyboard makes, confirms too', async () => {
    const onBackupSaved = jest.fn();
    const tree = await pending(onBackupSaved);
    await act(async () => hold(tree).props.onPress());
    expect(onBackupSaved).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('the words clear when the app leaves the foreground', async () => {
    const tree = await pending(jest.fn());
    expect(words(tree)).toHaveLength(12);
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    await act(async () => listeners.forEach(listener => listener('inactive')));
    expect(words(tree)).toEqual([]);
    expect(press(tree, 'Reveal recovery phrase')).toBeDefined();
    await act(async () => tree.unmount());
  });
});

describe('haptics', () => {
  const HAPTICS = 'com.beignet.wallet.haptics';
  const trigger = jest.mocked(HapticFeedback.trigger);
  const toggle = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Haptics' &&
        typeof node.props.onValueChange === 'function',
    )[0];
  afterEach(() => {
    jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
    setHapticsEnabled(true);
  });

  test('are on by default, and turning them off is saved and silences them', async () => {
    const tree = await render(base, client());
    expect(toggle(tree).props.value).toBe(true);
    await act(async () => toggle(tree).props.onValueChange(false));
    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
      'beignet-haptics',
      'off',
      expect.objectContaining({ service: HAPTICS }),
    );
    expect(toggle(tree).props.value).toBe(false);
    trigger.mockClear();
    haptics.tick();
    expect(trigger).not.toHaveBeenCalled();
    await act(async () => toggle(tree).props.onValueChange(true));
    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
      'beignet-haptics',
      'on',
      expect.objectContaining({ service: HAPTICS }),
    );
    // Turning them back on is felt at once.
    expect(trigger).toHaveBeenCalledWith('selection', expect.anything());
    await act(async () => tree.unmount());
  });

  test('a saved choice to keep them off is applied when Settings opens', async () => {
    jest
      .mocked(Keychain.getGenericPassword)
      .mockImplementation(async options =>
        options?.service === HAPTICS ? ({ password: 'off' } as never) : false,
      );
    const tree = await render(base, client());
    expect(toggle(tree).props.value).toBe(false);
    trigger.mockClear();
    haptics.success();
    expect(trigger).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a choice that could not be saved changes nothing and says why', async () => {
    jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
    const tree = await render(base, client());
    await act(async () => toggle(tree).props.onValueChange(false));
    expect(toggle(tree).props.value).toBe(true);
    expect(text(tree)).toContain('Could not save the haptics setting.');
    trigger.mockClear();
    haptics.tick();
    expect(trigger).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('diagnostics', () => {
  afterEach(() => clearDiagnostics());

  test('show the errors the app drew as glyphs, newest first and in full', async () => {
    const long =
      `No route to the payee was found. ${'Every channel was tried. '.repeat(
        30,
      )}`.trim();
    recordDiagnostic({ phase: 'ui', message: 'An earlier error.' });
    recordDiagnostic({ phase: 'peer:connect', message: 'peer chatter' });
    recordDiagnostic({ phase: 'ui', message: long, code: 'NO_ROUTE' });
    const adapter = client({
      diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
    });
    const tree = await render(base, adapter);
    expect(text(tree)).not.toContain('An earlier error.');
    await act(async () => press(tree, 'Diagnostics').props.onPress());
    expect(adapter.diagnostics).toHaveBeenCalledTimes(1);
    expect(long.length).toBeGreaterThan(300);
    const shown = tree.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .filter(
        children =>
          children === long ||
          children === 'An earlier error.' ||
          children === 'peer chatter',
      );
    expect(shown).toEqual([long, 'An earlier error.']);
    await act(async () => tree.unmount());
  });

  test('keep up to 1000 characters of a ui error, and 300 of anything else', () => {
    recordDiagnostic({ phase: 'ui', message: 'u'.repeat(1500) });
    recordDiagnostic({ phase: 'node:error', message: 'n'.repeat(1500) });
    const [ui, node] = recentDiagnostics();
    expect(ui.message).toHaveLength(1000);
    expect(node.message).toHaveLength(300);
  });
});

describe('a screen reader follows each change', () => {
  const PHRASE =
    'one two three four five six seven eight nine ten eleven twelve';
  const sent = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
  /**
   * What each focus event landed on, by the label or the text it carries.
   * Under Jest a host ref holds the mocked component, props and all.
   */
  const landed = () =>
    sent.mock.calls
      .filter(([, kind]) => kind === 'focus')
      .map(([node]) => {
        const { props } = node as unknown as {
          props: { accessibilityLabel?: string; children?: unknown };
        };
        return props.accessibilityLabel ?? strings(props.children).join('');
      });
  /** Focus moves once nothing is moving, which here is the next tick. */
  const settle = () =>
    act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });
  const mount = async (
    adapter: WalletAdapter,
    extra: Partial<Parameters<typeof SettingsScreen>[0]> = {},
  ) => {
    let tree!: ReactTestRenderer;
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
          {...extra}
        />,
      );
    });
    await settle();
    return tree;
  };
  beforeEach(() => sent.mockClear());

  test('from the reveal to the first word, back to the reveal, and to the heading once saved', async () => {
    const adapter = client({
      getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    });
    const tree = await mount(adapter, {
      backupPending: true,
      onBackupSaved: jest.fn(),
    });
    // Opening Settings moves nothing by itself.
    expect(landed()).toEqual([]);
    await act(async () =>
      press(tree, 'Reveal recovery phrase').props.onPress(),
    );
    await settle();
    expect(landed()).toEqual(['1. one']);
    await act(async () => press(tree, 'Hide phrase').props.onPress());
    await settle();
    expect(landed()).toEqual(['1. one', 'Reveal recovery phrase']);
    await act(async () =>
      press(tree, 'Reveal recovery phrase').props.onPress(),
    );
    await settle();
    await activate(tree, 'I saved my recovery phrase');
    await settle();
    expect(landed()).toEqual([
      '1. one',
      'Reveal recovery phrase',
      '1. one',
      'Save your recovery phrase.',
    ]);
    await act(async () => tree.unmount());
  });

  test('into the erase warning, and back to the link when the wallet is kept', async () => {
    const tree = await mount(client(), {
      onErase: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () =>
      press(tree, 'Erase wallet from this phone').props.onPress(),
    );
    await settle();
    expect(landed()).toEqual([copy.settings.erase.warning]);
    await act(async () => press(tree, 'Keep my wallet').props.onPress());
    await settle();
    expect(landed()).toEqual([
      copy.settings.erase.warning,
      'Erase wallet from this phone',
    ]);
    await act(async () => tree.unmount());
  });

  test('into the node field, and back to the change when it closes', async () => {
    const tree = await mount(client());
    await act(async () => press(tree, 'Change primary node').props.onPress());
    await settle();
    expect(landed()).toEqual(['Node address']);
    await act(async () => press(tree, 'Cancel').props.onPress());
    await settle();
    expect(landed()).toEqual(['Node address', 'Change primary node']);
    await act(async () => tree.unmount());
  });
});

test('an error is read out as it arrives', async () => {
  const announced = jest.mocked(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  );
  announced.mockClear();
  const adapter = client({
    updatePrimary: jest
      .fn()
      .mockRejectedValue(new Error('The node refused the change.')),
  });
  const tree = await render(base, adapter);
  await act(async () => press(tree, 'Change primary node').props.onPress());
  await act(async () => press(tree, 'Save primary node').props.onPress());
  expect(announced).toHaveBeenCalledWith(
    'The node refused the change.',
    expect.anything(),
  );
  await act(async () => tree.unmount());
});

describe('outcome glyphs', () => {
  test('draw in the way each is drawn everywhere', () => {
    expect(drawPlan('check')).toEqual([
      { delay: 0, duration: 420, pop: false },
    ]);
    // Two strokes of 140ms, the second 60ms behind the first.
    expect(drawPlan('cross')).toEqual([
      { delay: 0, duration: 140, pop: false },
      { delay: 60, duration: 140, pop: false },
    ]);
    // The line draws in 200ms, then the dot pops.
    expect(drawPlan('bang')).toEqual([
      { delay: 0, duration: 200, pop: false },
      { delay: 200, duration: 0, pop: true },
    ]);
  });

  test('have a step for every part of every glyph', () => {
    for (const name of Object.keys(GLYPHS) as GlyphName[]) {
      expect(drawPlan(name)).toHaveLength(GLYPHS[name].length);
    }
  });
});

describe('the wallet picker', () => {
  test('turns the chosen wallet into an orbit while it opens', async () => {
    const wallets = [
      { id: 'a', name: 'First', network: 'regtest', status: 'stopped' },
      { id: 'b', name: 'Second', network: 'mainnet', status: 'stopped' },
    ] as WalletRecord[];
    const onSelect = jest.fn();
    const picker = (busy: boolean) => (
      <WalletPicker
        wallets={wallets}
        busy={busy}
        onSelect={onSelect}
        onCreate={jest.fn()}
      />
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(picker(false));
    });
    await act(async () => press(tree, 'Open Second').props.onPress());
    expect(onSelect).toHaveBeenCalledWith(wallets[1]);
    await act(async () => tree.update(picker(true)));
    const state = (label: string) =>
      tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === label,
      )[0].props.accessibilityState;
    expect(state('Open Second')).toEqual({ disabled: true, busy: true });
    expect(state('Open First')).toEqual({ disabled: true, busy: false });
    await act(async () => tree.unmount());
  });
});
