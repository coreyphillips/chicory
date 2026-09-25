import React, { useState } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Keychain from 'react-native-keychain';
import HapticFeedback from 'react-native-haptic-feedback';
import { copy } from '../../src/design/copy';
import { palette } from '../../src/design/palette';
import { Bloom } from '../../src/glyphs/Bloom';
import { handOff, takeHandOff } from '../../src/scenes/phases/handoff';
import { OpeningWallet } from '../../src/scenes/phases/Loading';
import { LockScreen } from '../../src/scenes/phases/Locked';
import { OfflineWallet } from '../../src/scenes/phases/Offline';
import { Opening } from '../../src/scenes/phases/Opening';
import { Picker } from '../../src/scenes/phases/Picker';
import { Saved } from '../../src/scenes/phases/Saved';
import { Transit } from '../../src/scenes/phases/Transit';
import {
  bloomTone,
  flightFrom,
  lockVisual,
  markFlight,
  markPoint,
  SIZES,
  transitVisual,
  unlockGlyph,
  welcomeVisual,
} from '../../src/scenes/phases/visual';
import { Welcome } from '../../src/scenes/phases/Welcome';
import { SettingsSurface } from '../../src/scenes/settings/ui';
import { defaultProfile } from '../../src/services/networks';
import type { WalletSession } from '../../src/services/session';
import { PANE_SETTLE_MS, STATUS_ROW } from '../../src/stage/layout';
import {
  newestFirst,
  StageProvider,
  useStage,
  useStageStore,
} from '../../src/stage/StageContext';
import type { StageStore } from '../../src/stage/StageContext';
import { SETTINGS_MARKER, copyViolations } from '../../test-support/copyGuard';
import { guardData, snapshotOf, walletOf } from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import {
  find,
  meaning,
  press,
  pressableLabels,
} from '../../test-support/query';

/**
 * The shell phases under the copy guard (REDESIGN.md rule 1) and the
 * accessibility check (section 9): the lock, opening, closing, switching,
 * erasing, and the ways back into a wallet, each in every state it draws.
 * Their setup panels are Settings-class surfaces and carry the Settings
 * marker, so the guard reads their words as allowed and still checks that
 * every control in them is named.
 */

/**
 * The shell phases answer Android back through the stage, and their status
 * glyphs whisper through the gesture handler, so they are drawn inside both,
 * as the app draws them.
 */
let stage!: StageStore;

function Staged({ children }: PropsWithChildren) {
  stage = useStageStore();
  return (
    <GestureHandlerRootView>
      <StageProvider value={stage}>{children}</StageProvider>
    </GestureHandlerRootView>
  );
}

const staged = (element: ReactElement) => mount(<Staged>{element}</Staged>);

/** Where a measured mark sits in the window. */
const ROW_MARK = { x: 40, y: 320, width: SIZES.mark, height: SIZES.mark };

/**
 * Host views answer a measure the way a device does, reporting ROW_MARK,
 * until `done` is called.
 */
function measuring() {
  type Measured = (x: number, y: number, w: number, h: number) => void;
  const measure = jest.mocked(
    (View.prototype as unknown as { measureInWindow: (done: Measured) => void })
      .measureInWindow,
  );
  measure.mockImplementation(done =>
    done(ROW_MARK.x, ROW_MARK.y, ROW_MARK.width, ROW_MARK.height),
  );
  return { done: () => measure.mockReset() };
}

/**
 * Renders a state with Reduce Motion on. The setting stays read as on until
 * the next mount asks again, which every phase does.
 */
async function reduced(render: () => Promise<ReactTestRenderer>) {
  const asked = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  asked.mockResolvedValue(true);
  try {
    return await render();
  } finally {
    asked.mockResolvedValue(false);
  }
}

const everyday = walletOf();
const savings = walletOf({
  id: 'savings',
  name: 'Savings',
  network: 'mainnet',
});
const DATA = guardData(snapshotOf(), [savings.name]);

const remembered: WalletSession = {
  mode: 'device',
  network: 'regtest',
  walletId: everyday.id,
  locked: true,
};

const lock = (props: Partial<React.ComponentProps<typeof LockScreen>> = {}) =>
  staged(
    <LockScreen prompting={false} error="" onUnlock={jest.fn()} {...props} />,
  );

const saved = (props: Partial<React.ComponentProps<typeof Saved>> = {}) =>
  staged(
    <Saved
      name={everyday.name}
      network="regtest"
      error=""
      switchError=""
      connecting={false}
      networkEditor={false}
      openWallet={jest.fn(async () => {})}
      setError={jest.fn()}
      setNetworkEditor={jest.fn()}
      setDeviceVisible={jest.fn()}
      switchNetwork={jest.fn(async () => {})}
      {...props}
    />,
  );

const welcome = (props: Partial<React.ComponentProps<typeof Welcome>> = {}) =>
  staged(
    <Welcome
      error=""
      connecting={false}
      initializing={false}
      deviceVisible={false}
      deviceHint={false}
      rememberedSession={null}
      openDevice={jest.fn(async () => {})}
      openWallet={jest.fn(async () => {})}
      setError={jest.fn()}
      setDeviceVisible={jest.fn()}
      onCreateWallet={jest.fn()}
      {...props}
    />,
  );

const picker = (props: Partial<React.ComponentProps<typeof Picker>> = {}) =>
  staged(
    <Picker
      wallets={[everyday, savings]}
      activeProfile={{
        ...defaultProfile('regtest'),
        primaryUri: `02${'a'.repeat(64)}@127.0.0.1:19846`,
      }}
      error=""
      switchError=""
      networkEditor={false}
      selecting={false}
      switchNetwork={jest.fn(async () => {})}
      setNetworkEditor={jest.fn()}
      selectWallet={jest.fn(async () => {})}
      createDefaultWallet={jest.fn(async () => {})}
      disconnect={jest.fn(async () => {})}
      onCreateWallet={jest.fn()}
      {...props}
    />,
  );

const loading = (
  props: Partial<React.ComponentProps<typeof OpeningWallet>> = {},
) =>
  staged(
    <OpeningWallet
      name={everyday.name}
      network="regtest"
      busy={false}
      onDisconnect={jest.fn()}
      {...props}
    />,
  );

const offlineWallet = (
  props: Partial<React.ComponentProps<typeof OfflineWallet>> = {},
) => (
  <Staged>
    <OfflineWallet
      name={everyday.name}
      network="regtest"
      error="Electrum is offline."
      busy={false}
      networkEditor={false}
      onRetryConnection={jest.fn()}
      onRetrySetup={jest.fn()}
      onToggleNetwork={jest.fn()}
      onApplyNetwork={jest.fn(async () => {})}
      onChooseWallet={jest.fn()}
      onDisconnect={jest.fn()}
      loadPhrase={jest.fn(async () => 'never shown')}
      {...props}
    />
  </Staged>
);

const offline = (
  props: Partial<React.ComponentProps<typeof OfflineWallet>> = {},
) => mount(offlineWallet(props));

/** Renders a state, then opens what it keeps behind the control `label`. */
const opened = async (
  render: () => Promise<ReactTestRenderer>,
  label: string,
) => {
  const tree = await render();
  await press(tree, label);
  return tree;
};

const GUARDED: GuardedState[] = [
  { name: 'lock, waiting', render: () => lock(), data: DATA },
  {
    name: 'lock, prompting',
    render: () => lock({ prompting: true }),
    data: DATA,
  },
  {
    name: 'lock, refused',
    render: () => lock({ error: copy.phase.lockRefused }),
    data: DATA,
  },
  {
    name: 'lock with Face ID',
    render: () => {
      jest
        .mocked(Keychain.getSupportedBiometryType)
        .mockResolvedValueOnce('FaceID' as never);
      return lock();
    },
    data: DATA,
  },
  {
    name: 'lock with a fingerprint',
    render: () => {
      jest
        .mocked(Keychain.getSupportedBiometryType)
        .mockResolvedValueOnce('TouchID' as never);
      return lock();
    },
    data: DATA,
  },
  {
    name: 'lock with iris recognition',
    render: () => {
      jest
        .mocked(Keychain.getSupportedBiometryType)
        .mockResolvedValueOnce('Iris' as never);
      return lock();
    },
    data: DATA,
  },
  {
    name: 'lock, refused under Reduce Motion',
    render: () => reduced(() => lock({ error: copy.phase.lockRefused })),
    data: DATA,
  },
  {
    name: 'transit, closing',
    render: () =>
      staged(<Transit erasing={false} closing switchTarget={null} />),
    data: DATA,
  },
  {
    name: 'transit, switching to mainnet',
    render: () =>
      staged(
        <Transit
          erasing={false}
          closing={false}
          switchTarget="mainnet"
          network="regtest"
        />,
      ),
    data: DATA,
  },
  {
    name: 'transit, switching with no target',
    render: () =>
      staged(<Transit erasing={false} closing={false} switchTarget={null} />),
    data: DATA,
  },
  {
    name: 'transit, erasing',
    render: () => staged(<Transit erasing closing switchTarget={null} />),
    data: DATA,
  },
  {
    name: 'transit, erasing under Reduce Motion',
    render: () =>
      reduced(() => staged(<Transit erasing closing switchTarget={null} />)),
    data: DATA,
  },
  { name: 'opening', render: () => staged(<Opening />), data: DATA },
  { name: 'saved', render: () => saved(), data: DATA },
  {
    name: 'saved, unnamed',
    render: () => saved({ name: undefined }),
    data: DATA,
  },
  {
    name: 'saved, open failed',
    render: () => saved({ error: 'Electrum is offline.' }),
    data: DATA,
  },
  {
    name: 'saved, switch failed',
    render: () => saved({ switchError: 'The Electrum server did not answer.' }),
    data: DATA,
  },
  {
    name: 'saved, opening',
    render: () => saved({ connecting: true }),
    data: DATA,
  },
  {
    name: 'saved, network editor',
    render: () => saved({ networkEditor: true }),
    data: DATA,
  },
  {
    name: 'saved, network editor while opening',
    render: () => saved({ networkEditor: true, connecting: true }),
    data: DATA,
  },
  { name: 'welcome, first run', render: () => welcome(), data: DATA },
  {
    name: 'welcome, after a lock',
    render: () => welcome({ rememberedSession: remembered }),
    data: DATA,
  },
  {
    name: 'welcome, opening',
    render: () => welcome({ connecting: true }),
    data: DATA,
  },
  {
    name: 'welcome, open failed',
    render: () => welcome({ error: 'Electrum is offline.' }),
    data: DATA,
  },
  {
    name: 'welcome, open failed after a lock',
    render: () =>
      welcome({ rememberedSession: remembered, error: 'Electrum is offline.' }),
    data: DATA,
  },
  {
    name: 'welcome, device setup',
    render: () => welcome({ deviceVisible: true, deviceHint: true }),
    data: DATA,
  },
  {
    name: 'welcome, device setup opening',
    render: () =>
      welcome({ deviceVisible: true, connecting: true, error: 'Refused.' }),
    data: DATA,
  },
  { name: 'picker', render: () => picker(), data: DATA },
  {
    name: 'picker on mainnet',
    render: () =>
      picker({ wallets: [savings], activeProfile: defaultProfile('mainnet') }),
    data: DATA,
  },
  { name: 'picker, empty', render: () => picker({ wallets: [] }), data: DATA },
  {
    name: 'picker, empty and creating',
    render: () => picker({ wallets: [], selecting: true }),
    data: DATA,
  },
  {
    name: 'picker, choosing',
    render: () =>
      opened(
        () => picker({ selectWallet: jest.fn(() => new Promise(() => {})) }),
        'Open Everyday',
      ),
    data: DATA,
  },
  {
    name: 'picker, failed',
    render: () =>
      picker({
        wallets: [],
        error: 'Add a primary node for regtest.',
        switchError: 'The Electrum server did not answer.',
      }),
    data: DATA,
  },
  {
    name: 'picker, network editor',
    render: () => picker({ networkEditor: true }),
    data: DATA,
  },
  { name: 'loading', render: () => loading(), data: DATA },
  {
    name: 'loading, unnamed and busy',
    render: () => loading({ name: undefined, busy: true }),
    data: DATA,
  },
  {
    name: 'loading, arriving from the picker',
    render: () => {
      handOff(ROW_MARK);
      return loading({ busy: true });
    },
    data: DATA,
  },
  { name: 'offline', render: () => offline(), data: DATA },
  {
    name: 'offline, setup failed',
    render: () => offline({ setupError: 'Liquidity provider is unavailable.' }),
    data: DATA,
  },
  {
    name: 'offline, retrying',
    render: () => offline({ busy: true }),
    data: DATA,
  },
  {
    name: 'offline, connecting',
    render: () => offline({ error: '' }),
    data: DATA,
  },
  {
    name: 'offline, settings',
    render: () => opened(() => offline(), copy.phase.settings),
    data: DATA,
  },
  {
    name: 'offline, settings while retrying',
    render: () => opened(() => offline({ busy: true }), copy.phase.settings),
    data: DATA,
  },
  {
    name: 'offline, network editor',
    render: () => offline({ networkEditor: true }),
    data: DATA,
  },
];

guard('phases', GUARDED);

describe('phase visuals', () => {
  test('slate stands in for bloom on every network but mainnet', () => {
    expect(bloomTone('mainnet')).toBe('live');
    expect(bloomTone('regtest')).toBe('test');
    expect(bloomTone('testnet')).toBe('test');
    expect(bloomTone(null)).toBe('live');
  });

  test('the unlock glyph follows the way the phone proves its owner', () => {
    expect(unlockGlyph('face')).toBe('faceScan');
    expect(unlockGlyph('fingerprint')).toBe('fingerprint');
    expect(unlockGlyph('iris')).toBe('eye');
    expect(unlockGlyph('passcode')).toBe('passcode');
    expect(unlockGlyph(null)).toBe('passcode');
  });

  test('a refusal holds until the next prompt, and the lock is always said', () => {
    expect(lockVisual({ prompting: false, error: '' })).toEqual({
      status: 'Locked',
      value: 'Locked',
      drawing: false,
      refused: false,
    });
    expect(lockVisual({ prompting: true, error: '' })).toMatchObject({
      drawing: true,
      refused: false,
    });
    const refused = lockVisual({
      prompting: false,
      error: copy.phase.lockRefused,
    });
    expect(refused).toMatchObject({
      status: copy.phase.lockRefused,
      drawing: false,
      refused: true,
    });
    expect(refused.value).toContain('Locked');
    expect(refused.value).toContain(copy.phase.lockRefused);
  });

  test('each transit says what it is and moves its own way', () => {
    const closing = transitVisual({
      erasing: false,
      closing: true,
      switchTarget: null,
      network: 'regtest',
    });
    expect(closing).toEqual({
      kind: 'closing',
      label: 'Closing your wallet…',
      from: 'test',
      to: 'test',
      mode: 'still',
    });
    // Erasing closes too, and says the more serious thing.
    expect(
      transitVisual({ erasing: true, closing: true, switchTarget: null }),
    ).toMatchObject({ kind: 'erasing', to: 'dormant', mode: 'still' });
    expect(
      transitVisual({
        erasing: false,
        closing: false,
        switchTarget: 'mainnet',
        network: 'regtest',
      }),
    ).toEqual({
      kind: 'switching',
      label: 'Closing this wallet and opening mainnet…',
      from: 'test',
      to: 'live',
      mode: 'ratchet',
    });
    // Without the network it leaves, it starts in the tone it will end in.
    expect(
      transitVisual({
        erasing: false,
        closing: false,
        switchTarget: 'regtest',
      }),
    ).toMatchObject({ from: 'test', to: 'test' });
    expect(
      transitVisual({ erasing: false, closing: false, switchTarget: null })
        .label,
    ).toBe('Closing this wallet and opening the selected network…');
  });

  test('welcome offers one big control, or the chase in its place', () => {
    expect(
      welcomeVisual({ error: '', opening: true, returning: false }),
    ).toEqual({ open: 1, mode: 'chase', wilted: false, primary: null });
    expect(
      welcomeVisual({ error: 'Refused.', opening: false, returning: true }),
    ).toEqual({
      open: 0.5,
      mode: 'still',
      wilted: true,
      primary: { glyph: 'refresh', label: 'Try again' },
    });
    expect(
      welcomeVisual({ error: '', opening: false, returning: true }).primary,
    ).toEqual({ glyph: 'unlock', label: 'Try again' });
    expect(
      welcomeVisual({ error: '', opening: false, returning: false }),
    ).toEqual({
      open: 1,
      mode: 'breathe',
      wilted: false,
      primary: { glyph: 'sprout', label: 'Create a wallet' },
    });
  });

  test('the mark sits in the status row, and a flight lands a bloom on it', () => {
    const mark = markPoint({ top: 47, left: 0 });
    expect(mark).toEqual({ x: 24 + SIZES.mark / 2, y: 47 + STATUS_ROW / 2 });
    const flight = markFlight(mark, { x: 200, y: 400 }, SIZES.loader);
    expect(flight.dx).toBe(mark.x - 200);
    expect(flight.dy).toBe(mark.y - 400);
    expect(flight.scale).toBeCloseTo(28 / 96);
    // A bloom already on the mark does not move.
    expect(markFlight(mark, mark, SIZES.mark)).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
    });
  });

  test('a flight from the picker starts over the row it came from', () => {
    const to = { x: 24, y: 60, width: 28, height: 28 };
    expect(flightFrom(ROW_MARK, to)).toEqual({
      dx: ROW_MARK.x - to.x,
      dy: ROW_MARK.y - to.y,
      scale: 1,
    });
    // A larger source starts scaled up, centre over centre.
    expect(flightFrom({ x: 0, y: 0, width: 96, height: 96 }, to)).toEqual({
      dx: 48 - 38,
      dy: 48 - 74,
      scale: 96 / 28,
    });
  });

  test("the picker's hand-off is taken once, and only while it is fresh", () => {
    handOff(ROW_MARK);
    expect(takeHandOff()).toEqual(ROW_MARK);
    expect(takeHandOff()).toBeNull();
    const now = Date.now();
    handOff(ROW_MARK);
    jest.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    try {
      expect(takeHandOff()).toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('phase behaviour', () => {
  const haptic = jest.mocked(HapticFeedback.trigger);
  const spoken = jest.mocked(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  );

  beforeEach(() => {
    haptic.mockClear();
    spoken.mockClear();
  });

  test('the whole lock screen is the unlock control, held while it prompts', async () => {
    const onUnlock = jest.fn();
    const tree = await lock({ onUnlock });
    await press(tree, copy.phase.unlock);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    await act(async () =>
      tree.update(
        <Staged>
          <LockScreen prompting error="" onUnlock={onUnlock} />
        </Staged>,
      ),
    );
    expect(find(tree, copy.phase.unlock)?.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(find(tree, copy.phase.unlock)?.props.disabled).toBe(true);
    await act(async () => tree.unmount());
  });

  test('a refused unlock is felt and spoken at once, and stays on the glyph', async () => {
    // The guard above spoke this already; a repeat within 2s is dropped.
    const later = Date.now() + 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const tree = await lock({ error: copy.phase.lockRefused });
    jest.restoreAllMocks();
    expect(haptic).toHaveBeenCalledWith('notificationError', expect.anything());
    expect(spoken).toHaveBeenCalledWith(copy.phase.lockRefused, {
      queue: false,
    });
    const glyph = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'image' &&
        node.props.accessibilityLabel === copy.phase.lockRefused,
    );
    expect(glyph).toBeDefined();
    // The bud shakes: its event is a shake, keyed to play once.
    const [bud] = tree.root
      .findAllByType(Bloom)
      .filter(node => node.props.mode === 'breathe');
    expect(bud.props.event).toEqual({ kind: 'shake', key: 1 });
    await act(async () => tree.unmount());
  });

  test('leaving the lock right after a prompt is an unlock the hand can feel', async () => {
    const tree = await lock({ prompting: true });
    haptic.mockClear();
    await act(async () => tree.unmount());
    expect(haptic).toHaveBeenCalledWith(
      'notificationSuccess',
      expect.anything(),
    );
  });

  test('choosing a wallet chases its mark and dims the rest', async () => {
    const selectWallet = jest.fn(() => new Promise<void>(() => {}));
    const tree = await picker({ selectWallet });
    await press(tree, 'Open Everyday');
    expect(selectWallet).toHaveBeenCalledWith(everyday);
    await act(async () =>
      tree.update(
        <Staged>
          <Picker
            wallets={[everyday, savings]}
            activeProfile={defaultProfile('regtest')}
            error=""
            switchError=""
            networkEditor={false}
            selecting
            switchNetwork={jest.fn(async () => {})}
            setNetworkEditor={jest.fn()}
            selectWallet={selectWallet}
            createDefaultWallet={jest.fn(async () => {})}
            disconnect={jest.fn(async () => {})}
            onCreateWallet={jest.fn()}
          />
        </Staged>,
      ),
    );
    const modes = tree.root
      .findAllByType(Bloom)
      .filter(node => node.props.size === SIZES.mark)
      .map(node => node.props.mode);
    expect(modes).toEqual(['chase', 'still']);
    expect(find(tree, 'Open Everyday')?.props.accessibilityState).toMatchObject(
      { busy: true, disabled: true },
    );
    expect(find(tree, 'Open Savings')?.props.accessibilityState).toMatchObject({
      busy: false,
      disabled: true,
    });
    await act(async () => tree.unmount());
  });

  test('a test network wears its flask and says so', async () => {
    const tree = await picker();
    expect(meaning(tree)).toContain('regtest');
    expect(meaning(tree)).toContain(copy.phase.testNetwork('regtest'));
    expect(meaning(tree)).toContain('regtest · running');
    await act(async () => tree.unmount());
  });

  test('offline keeps its setup behind the cog', async () => {
    const onToggleNetwork = jest.fn();
    const tree = await offline({ onToggleNetwork });
    expect(meaning(tree)).toContain(copy.phase.offline);
    expect(meaning(tree)).toContain('Electrum is offline.');
    expect(find(tree, copy.phase.lockDevice)).toBeUndefined();
    await press(tree, copy.phase.settings);
    expect(find(tree, copy.phase.lockDevice)).toBeDefined();
    expect(find(tree, copy.phase.chooseWallet)).toBeDefined();
    expect(find(tree, 'Reveal recovery phrase')).toBeDefined();
    await press(tree, copy.phase.close);
    expect(find(tree, copy.phase.lockDevice)).toBeUndefined();
    expect(onToggleNetwork).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('back on offline closes the editor, then the panel, then lets go', async () => {
    const onToggleNetwork = jest.fn();
    const tree = await offline({ networkEditor: true, onToggleNetwork });
    const back = async () => {
      let took = false;
      await act(async () => {
        took = newestFirst(stage.responders.phaseBack)[0]();
      });
      return took;
    };
    // An editor already open brings its panel with it.
    expect(find(tree, copy.phase.lockDevice)).toBeDefined();
    expect(await back()).toBe(true);
    expect(onToggleNetwork).toHaveBeenCalledTimes(1);
    await act(async () =>
      tree.update(offlineWallet({ networkEditor: false, onToggleNetwork })),
    );
    expect(await back()).toBe(true);
    expect(find(tree, copy.phase.lockDevice)).toBeUndefined();
    expect(await back()).toBe(false);
    expect(onToggleNetwork).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('offline leaves its wallet by glyphs, outside the setup panel', async () => {
    const onChooseWallet = jest.fn();
    const onDisconnect = jest.fn();
    const tree = await offline({ onChooseWallet, onDisconnect });
    await press(tree, copy.phase.settings);
    const [panel] = tree.root.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === SETTINGS_MARKER,
    );
    for (const label of [copy.phase.chooseWallet, copy.phase.lockDevice]) {
      const control = find(tree, label)!;
      expect(control).toBeDefined();
      // Not setup, so not under the marker that lets setup keep its words,
      // and drawn as a glyph alone.
      expect({
        label,
        inPanel: panel.findAll(node => node === control).length,
        words: control.findAllByType(Text).length,
      }).toEqual({ label, inPanel: 0, words: 0 });
    }
    await press(tree, copy.phase.chooseWallet);
    expect(onChooseWallet).toHaveBeenCalledTimes(1);
    await press(tree, copy.phase.lockDevice);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test('the picker draws no network editor under the new wallet sheet', async () => {
    // The stage draws the sheet over the phase, rooted in a settings-class
    // surface of its own; this stands in for it.
    function WithSheet({ primaryUri }: { primaryUri: string }) {
      const [editor, setEditor] = useState(true);
      const { state, actions } = useStage();
      return (
        <>
          <Picker
            wallets={primaryUri ? [everyday, savings] : []}
            activeProfile={{ ...defaultProfile('regtest'), primaryUri }}
            error=""
            switchError=""
            networkEditor={editor}
            selecting={false}
            switchNetwork={jest.fn(async () => {})}
            setNetworkEditor={setEditor}
            selectWallet={jest.fn(async () => {})}
            createDefaultWallet={jest.fn(async () => {})}
            disconnect={jest.fn(async () => {})}
            onCreateWallet={actions.openCreate}
          />
          {state.overlay?.name === 'create' ? <SettingsSurface /> : null}
        </>
      );
    }
    const markers = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === SETTINGS_MARKER,
      ).length;
    const NODE = `02${'a'.repeat(64)}@127.0.0.1:19846`;
    // Restoring; making a wallet on a network with no primary node, which
    // asks for one in the sheet; and a sheet the picker did not open, as
    // restore from Welcome lands on the picker with it.
    for (const open of [
      {
        primaryUri: NODE,
        go: (tree: ReactTestRenderer) => press(tree, copy.phase.restore),
      },
      {
        primaryUri: '',
        go: (tree: ReactTestRenderer) => press(tree, copy.phase.createWallet),
      },
      {
        primaryUri: NODE,
        go: () => act(async () => stage.actions.openCreate(true)),
      },
    ]) {
      const tree = await staged(<WithSheet primaryUri={open.primaryUri} />);
      expect(markers(tree)).toBe(1);
      await open.go(tree);
      expect(stage.state.overlay?.name).toBe('create');
      expect(markers(tree)).toBe(1);
      expect(() => copyViolations(tree, { data: DATA })).not.toThrow();
      await act(async () => tree.unmount());
    }
  });

  test('a failed wallet setup puts a honey pip on its retry and says why', async () => {
    const tree = await offline({
      setupError: 'Liquidity provider is unavailable.',
    });
    const retry = find(tree, copy.phase.retrySetup);
    expect(retry?.props.accessibilityValue).toEqual({
      text: 'Liquidity provider is unavailable.',
    });
    expect(retry?.props.accessibilityHint).toBe(copy.phase.retrySetupHint);
    await act(async () => tree.unmount());
  });

  test('a busy retry turns and cannot be pressed again', async () => {
    const tree = await offline({ busy: true });
    expect(
      find(tree, copy.phase.retryConnection)?.props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    await act(async () => tree.unmount());
  });

  test('an open that was asked for and failed is felt, and says why', async () => {
    const setError = jest.fn();
    const tree = await saved({
      openWallet: jest.fn(async () => {
        throw new Error('Electrum is offline.');
      }),
      setError,
    });
    await press(tree, copy.phase.openDevice);
    expect(haptic).toHaveBeenCalledWith('notificationError', expect.anything());
    expect(setError).toHaveBeenCalledWith('Electrum is offline.');
    await act(async () => tree.unmount());
  });

  test('a wallet that would not open from the picker is felt', async () => {
    const tree = await picker({
      selectWallet: jest.fn(async () => {
        throw new Error('The wallet did not start.');
      }),
    });
    await press(tree, 'Open Everyday');
    expect(haptic).toHaveBeenCalledWith('notificationError', expect.anything());
    await act(async () => tree.unmount());
  });

  test('offline feels a retry it asked for fail, and not the ones the app runs', async () => {
    const error = 'Electrum is offline.';
    const tree = await offline({ error });
    const retry = (busy: boolean) =>
      act(async () => tree.update(offlineWallet({ error, busy })));
    const refused = () =>
      haptic.mock.calls.filter(([kind]) => kind === 'notificationError');
    // The app retrying on its own.
    await retry(true);
    await retry(false);
    expect(refused()).toHaveLength(0);
    // A retry asked for, which ends still offline.
    await press(tree, copy.phase.retryConnection);
    await retry(true);
    expect(refused()).toHaveLength(0);
    await retry(false);
    expect(refused()).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test('the loading page shows the actions to come, out of reach', async () => {
    const tree = await loading();
    // The actions are drawn in husk, as glyphs only: nothing to press.
    const actions = tree.root
      .findAll(
        node =>
          typeof node.type !== 'string' &&
          typeof node.props.name === 'string' &&
          node.props.color === palette.husk,
      )
      .map(node => node.props.name);
    expect([...new Set(actions)]).toEqual(['send', 'scan', 'receive']);
    expect([...pressableLabels(tree)]).toEqual([copy.phase.lockDevice]);
    await act(async () => tree.unmount());
  });

  test('choosing a wallet hands its mark to the page that follows', async () => {
    const host = measuring();
    try {
      const chooser = await picker({
        selectWallet: jest.fn(() => new Promise<void>(() => {})),
      });
      await press(chooser, 'Open Everyday');
      await act(async () => chooser.unmount());
    } finally {
      host.done();
    }
    jest.useFakeTimers();
    try {
      const page = await loading({ busy: true });
      const mark = () =>
        page.root
          .findAllByType(Bloom)
          .find(node => node.props.size === SIZES.mark);
      // It arrives still chasing, as the loader it became, and rests on
      // landing.
      expect(mark()?.props.mode).toBe('chase');
      await act(async () => {
        jest.advanceTimersByTime(PANE_SETTLE_MS);
      });
      expect(mark()?.props.mode).toBe('still');
      await act(async () => page.unmount());
    } finally {
      jest.useRealTimers();
    }
    // Taken by that page, so the next one arrives on its own.
    expect(takeHandOff()).toBeNull();
    const next = await loading();
    expect(
      next.root
        .findAllByType(Bloom)
        .find(node => node.props.size === SIZES.mark)?.props.mode,
    ).toBe('still');
    await act(async () => next.unmount());
  });

  describe('focus lands on what each phase is about', () => {
    const focused = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
    /** What each focus went to, by the label a screen reader reads there. */
    const landed = () =>
      focused.mock.calls.map(([node, kind]) => [
        (node as unknown as { props: { accessibilityLabel?: string } }).props
          .accessibilityLabel,
        kind,
      ]);
    /** Lets the work queued for after the transition run. */
    const settle = () =>
      act(async () => {
        jest.runOnlyPendingTimers();
      });

    beforeEach(() => {
      focused.mockClear();
      jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    const ARRIVALS: Array<[string, () => Promise<ReactTestRenderer>, string]> =
      [
        ['the lock', () => lock(), copy.phase.unlock],
        [
          'a transit',
          () => staged(<Transit erasing={false} closing switchTarget={null} />),
          copy.phase.closing,
        ],
        ['the opening', () => staged(<Opening />), copy.phase.openingWallet],
        [
          'a saved wallet',
          () => saved({ error: 'Electrum is offline.' }),
          copy.phase.openDevice,
        ],
        ['the welcome', () => welcome(), copy.phase.tagline],
        ['the picker', () => picker(), copy.phase.chooseTitle],
        ['the loading page', () => loading(), copy.phase.opening],
        ['an offline wallet', () => offline(), copy.phase.offline],
      ];

    test.each(ARRIVALS)('%s', async (_name, render, label) => {
      const tree = await render();
      expect(focused).not.toHaveBeenCalled();
      await settle();
      expect(landed()).toEqual([[label, 'focus']]);
      await act(async () => tree.unmount());
    });

    test('a phase that leaves before the move settles moves nothing', async () => {
      const tree = await staged(<Opening />);
      await act(async () => tree.unmount());
      await settle();
      expect(focused).not.toHaveBeenCalled();
    });
  });
});
