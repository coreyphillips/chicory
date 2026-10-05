import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import HapticFeedback from 'react-native-haptic-feedback';
import * as Keychain from 'react-native-keychain';
import { Stop } from 'react-native-svg';
import { copy } from '../../../design/copy';
import { forgetSpoken } from '../../../design/announce';
import { gradients, palette } from '../../../design/palette';
import { Bloom } from '../../../glyphs/Bloom';
import { durations, springs } from '../../../motion/tokens';
import { SettingsScreen } from '../../../screens/Settings';
import type { WalletAdapter } from '../../../services/wallet';
import { radius } from '../../../theme';
import { snapshotOf } from '../../../../test-support/fixtures';
import { find, press } from '../../../../test-support/query';
import { DISC_DIP } from '../hub';
import { cardWords } from '../hubModel';

/**
 * Settings as a grouped hub (REDESIGN.md 6, Settings): the card, then rows
 * in four groups that open in place one at a time, what each row draws only
 * while it is open, the recovery phrase that leads the page until it is
 * saved and then becomes the Wallet group's first row, focus handed back to
 * a row whose content closed itself, and what Reduce Motion and a test
 * network change.
 */

const s = copy.settings;
const PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

function client(over: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    connection: { url: 'embedded:', token: '' },
    demo: false,
    getConfig: jest
      .fn()
      .mockResolvedValue({ engineVersion: '0.15.0', drainAvailable: true }),
    snapshot: jest.fn().mockResolvedValue(snapshotOf()),
    getRecoveryPhrase: jest.fn().mockResolvedValue(PHRASE),
    diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
    updatePrimary: jest.fn().mockResolvedValue(undefined),
    retrySetup: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as WalletAdapter;
}

type Props = Partial<Parameters<typeof SettingsScreen>[0]>;

const trees: ReactTestRenderer[] = [];

function element(over: Props = {}) {
  return (
    <SettingsScreen
      snapshot={snapshotOf()}
      client={client()}
      switchError=""
      onDisconnect={jest.fn()}
      onRefresh={jest.fn()}
      onNetwork={jest.fn()}
      onErase={jest.fn().mockResolvedValue(undefined)}
      {...over}
    />
  );
}

async function render(over: Props = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element(over));
  });
  trees.push(tree);
  return tree;
}

/** Focus moves once nothing is moving, which here is the next tick. */
const settle = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  });

/** The host element a screen reader reaches for `label`. */
const host = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  )[0];

/** What each focus move landed on, by its label or the text it holds. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, kind]) => kind === 'focus')
    .map(([node]) => {
      const { props } = node as unknown as ReactTestInstance;
      return props.accessibilityLabel ?? props.children;
    });

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(node => node.type === Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'string');

const flat = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style) ?? {};

/** The frame a row is drawn in: the nearest view above it that clips. */
function frameOf(node: ReactTestInstance): ReactTestInstance {
  let at: ReactTestInstance | null = node.parent;
  while (at && !(typeof at.type === 'string' && flat(at).overflow === 'hidden'))
    at = at.parent;
  return at!;
}

/** A finger landing on the row labelled `label`. */
const pressIn = (tree: ReactTestRenderer, label: string) =>
  act(async () => {
    tree.root
      .findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPressIn === 'function',
      )[0]
      .props.onPressIn();
  });

/** The disc a row's glyph sits on. */
const discOf = (row: ReactTestInstance) =>
  row.find(
    node => typeof node.type === 'string' && node.props.testID === 'glyph-disc',
  );

beforeEach(() => {
  // Pinned: a suite that ran before may have left Reduce Motion on.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
  forgetSpoken();
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.mocked(Keychain.getSupportedBiometryType).mockReset();
  jest.mocked(Keychain.getSupportedBiometryType).mockResolvedValue(null);
  jest.restoreAllMocks();
});

describe('the page', () => {
  test('is the card, then the groups and their rows, in reading order', async () => {
    jest
      .mocked(Keychain.getSupportedBiometryType)
      .mockResolvedValue('FaceID' as never);
    const tree = await render();
    const reached = tree.root
      .findAll(
        node =>
          typeof node.type === 'string' &&
          typeof node.props.accessibilityLabel === 'string' &&
          ['summary', 'header', 'button', 'switch'].includes(
            node.props.accessibilityRole,
          ),
      )
      .map(node => [
        node.props.accessibilityRole,
        node.props.accessibilityLabel,
      ]);
    expect(reached).toEqual([
      ['summary', cardWords({ snapshot: snapshotOf(), live: true })],
      ['header', s.wallet.heading],
      ['button', s.recovery.heading],
      ['button', s.primary.heading],
      ['button', s.wallet.serversLabel],
      ['header', s.phone.heading],
      ['switch', s.phone.requireLabel('Face ID')],
      ['switch', s.phone.haptics],
      ['header', s.funds.heading],
      ['button', s.empty.link],
      ['button', s.wallet.lock],
      ['button', s.erase.link],
      ['header', s.help.heading],
      ['button', s.diagnostics.heading],
    ]);
  });

  test('a row that opens is a button that says its value and whether it is open', async () => {
    const tree = await render();
    expect(host(tree, s.primary.heading).props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityValue: { text: s.primary.connected },
      accessibilityState: { expanded: false, disabled: false },
    });
    expect(host(tree, s.wallet.serversLabel).props).toMatchObject({
      accessibilityValue: { text: 'regtest' },
      accessibilityState: { expanded: false },
    });
    // Diagnostics keeps its hint; Lock acts at once and opens nothing.
    expect(host(tree, s.diagnostics.heading).props.accessibilityHint).toBe(
      s.diagnostics.hint,
    );
    expect(
      host(tree, s.wallet.lock).props.accessibilityState?.expanded,
    ).toBeUndefined();
  });

  test('a group is a header a screen reader hears in sentence case, drawn in small capitals', async () => {
    const tree = await render();
    const header = (title: string) =>
      tree.root.find(
        node =>
          node.type === Text &&
          node.props.accessibilityRole === 'header' &&
          node.props.children === title,
      );
    for (const title of [s.wallet.heading, s.phone.heading, s.help.heading]) {
      expect(header(title).props.accessibilityLabel).toBe(title);
      expect(flat(header(title))).toMatchObject({
        textTransform: 'uppercase',
        color: palette.dust,
      });
    }
    // The group that moves money out is in honey, which never moves.
    expect(flat(header(s.funds.heading)).color).toBe(palette.honey);
    expect(header(s.funds.heading).props).toMatchObject({
      numberOfLines: 3,
      adjustsFontSizeToFit: true,
    });
  });

  test("each row is its card's share: corners at the card's edge, a hairline where it joins", async () => {
    const tree = await render();
    const frame = (label: string) => flat(frameOf(host(tree, label)));
    // The Wallet group's top, middle and foot.
    expect(frame(s.recovery.heading)).toMatchObject({
      borderTopLeftRadius: radius.lg,
      borderBottomLeftRadius: 0,
      backgroundColor: palette.espresso,
    });
    expect(frame(s.primary.heading)).toMatchObject({
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    });
    expect(frame(s.wallet.serversLabel)).toMatchObject({
      borderTopLeftRadius: 0,
      borderBottomRightRadius: radius.lg,
    });
    // Alone in its group, every corner is round.
    expect(frame(s.diagnostics.heading)).toMatchObject({
      borderTopRightRadius: radius.lg,
      borderBottomRightRadius: radius.lg,
    });
    // The hairline shows only where a row joins the one above.
    const seam = (label: string) =>
      flat(frameOf(host(tree, label)).children[0] as ReactTestInstance);
    expect(seam(s.recovery.heading).opacity).toBe(0);
    expect(seam(s.primary.heading)).toMatchObject({
      opacity: 1,
      backgroundColor: palette.husk,
    });
  });
});

describe('one row open at a time', () => {
  test('opening a row closes the one open, and pressing it again closes it', async () => {
    const tree = await render();
    await press(tree, s.primary.heading);
    expect(find(tree, s.primary.change)).toBeDefined();
    expect(
      host(tree, s.primary.heading).props.accessibilityState.expanded,
    ).toBe(true);
    await press(tree, s.erase.link);
    expect(find(tree, s.primary.change)).toBeUndefined();
    expect(find(tree, s.erase.confirm)).toBeDefined();
    expect(
      host(tree, s.primary.heading).props.accessibilityState.expanded,
    ).toBe(false);
    await press(tree, s.erase.link);
    expect(find(tree, s.erase.confirm)).toBeUndefined();
  });

  test('what a row opens is not drawn, nor asked for, until it opens, and opens fresh', async () => {
    const adapter = client();
    const tree = await render({ client: adapter });
    expect(adapter.diagnostics).not.toHaveBeenCalled();
    expect(find(tree, s.diagnostics.refresh)).toBeUndefined();
    await press(tree, s.diagnostics.heading);
    expect(adapter.diagnostics).toHaveBeenCalledTimes(1);
    expect(find(tree, s.diagnostics.refresh)).toBeDefined();
    await press(tree, s.diagnostics.heading);
    expect(find(tree, s.diagnostics.refresh)).toBeUndefined();
    await press(tree, s.diagnostics.heading);
    expect(adapter.diagnostics).toHaveBeenCalledTimes(2);
  });

  test('a switch and Lock act at once and leave the open row open', async () => {
    const onDisconnect = jest.fn();
    const tree = await render({ onDisconnect });
    await press(tree, s.primary.heading);
    await press(tree, s.wallet.lock);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(find(tree, s.primary.change)).toBeDefined();
  });

  test('opening a row moves no screen reader, and its open disc fills', async () => {
    const tree = await render();
    await settle();
    await press(tree, s.wallet.serversLabel);
    await settle();
    expect(focused()).toEqual([]);
    expect(
      flat(discOf(host(tree, s.wallet.serversLabel))).backgroundColor,
    ).toBe(palette.slateSoft);
    expect(flat(discOf(host(tree, s.primary.heading))).backgroundColor).toBe(
      palette.mocha,
    );
  });
});

describe('what closes itself hands a screen reader back to its row', () => {
  test('Keep my wallet closes Erase and lands on its row', async () => {
    const tree = await render();
    await press(tree, s.erase.link);
    await settle();
    expect(focused()).toEqual([s.erase.warning]);
    await press(tree, s.erase.keep);
    await settle();
    expect(find(tree, s.erase.confirm)).toBeUndefined();
    expect(focused()).toEqual([s.erase.warning, s.erase.link]);
  });

  test('Keep my channel closes Empty wallet and lands on its row', async () => {
    const tree = await render({
      snapshot: snapshotOf({ wallet: { network: 'mainnet' } }),
    });
    await press(tree, s.empty.link);
    await settle();
    await press(tree, s.empty.keep);
    await settle();
    expect(find(tree, s.empty.review)).toBeUndefined();
    expect(focused().at(-1)).toBe(s.empty.link);
  });
});

describe('the rows the page offers', () => {
  test('Empty wallet only where the engine can empty one, and waits for the primary node', async () => {
    const without = await render({
      client: client({
        getConfig: jest.fn().mockResolvedValue({ engineVersion: '0.15.0' }),
      }),
    });
    expect(host(without, s.empty.link)).toBeUndefined();
    const away = await render({
      snapshot: snapshotOf({ primary: { connected: false } }),
    });
    expect(host(away, s.empty.link).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(find(away, s.empty.link)).toBeUndefined();
  });

  test('Erase only in device mode', async () => {
    const tree = await render({ onErase: undefined });
    expect(host(tree, s.erase.link)).toBeUndefined();
  });

  test('the app lock draws nothing until the phone says what it offers', async () => {
    let answer!: (type: unknown) => void;
    jest.mocked(Keychain.getSupportedBiometryType).mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      }) as never,
    );
    const tree = await render();
    // P10: the line for a phone with no lock flashed on one with Face ID.
    expect(texts(tree)).not.toContain(s.phone.noLock);
    expect(host(tree, s.phone.requireLabel('Face ID'))).toBeUndefined();
    await act(async () => answer(null));
    expect(texts(tree)).toContain(s.phone.noLock);
  });

  test('a switch that failed opens Network & servers to say why', async () => {
    const tree = await render({ switchError: 'The wallet did not close.' });
    expect(
      host(tree, s.wallet.serversLabel).props.accessibilityState.expanded,
    ).toBe(true);
    expect(texts(tree)).toContain('The wallet did not close.');
  });

  test('the servers wait behind Edit servers, which the networks make room for', async () => {
    const tree = await render();
    await press(tree, s.wallet.serversLabel);
    expect(host(tree, 'mainnet')).toBeDefined();
    await press(tree, s.wallet.editServers);
    expect(host(tree, 'mainnet')).toBeUndefined();
    expect(host(tree, s.wallet.editServers).props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  test('an outcome is felt and said once, not again as its row opens again', async () => {
    const said = jest.mocked(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    );
    said.mockClear();
    const tree = await render();
    await press(tree, s.primary.heading);
    await press(tree, s.primary.change);
    await press(tree, s.primary.save);
    const felt = () =>
      jest
        .mocked(HapticFeedback.trigger)
        .mock.calls.filter(([kind]) => kind === 'notificationSuccess').length;
    const heard = () =>
      said.mock.calls.filter(([text]) => text === s.primary.updated).length;
    expect(texts(tree)).toContain(s.primary.updated);
    expect([felt(), heard()]).toEqual([1, 1]);
    forgetSpoken();
    await press(tree, s.primary.heading);
    await press(tree, s.primary.heading);
    expect(texts(tree)).toContain(s.primary.updated);
    expect([felt(), heard()]).toEqual([1, 1]);
  });
});

describe('the recovery phrase to save', () => {
  const pending = { backupPending: true, onBackupSaved: jest.fn() };

  test('leads the page in honey, open, pinned, and is not a row to toggle', async () => {
    const tree = await render(pending);
    const headings = tree.root
      .findAll(
        node => node.type === Text && node.props.accessibilityRole === 'header',
      )
      .map(node => node.props.children);
    expect(headings[0]).toBe(s.recovery.pending);
    const title = tree.root.find(
      node => node.type === Text && node.props.children === s.recovery.pending,
    );
    expect(flat(title).color).toBe(palette.honey);
    expect(flat(frameOf(title))).toMatchObject({
      backgroundColor: palette.honeyWash,
      borderColor: palette.honey,
      borderTopLeftRadius: radius.lg,
      borderBottomLeftRadius: radius.lg,
    });
    expect(find(tree, s.recovery.heading)).toBeUndefined();
    expect(find(tree, s.recovery.reveal)).toBeDefined();
    // The Wallet group starts at the primary node meanwhile.
    expect(flat(frameOf(host(tree, s.primary.heading)))).toMatchObject({
      borderTopLeftRadius: radius.lg,
    });
  });

  test('once saved, it is the Wallet group’s first row, plain and closed, and focus follows it', async () => {
    const tree = await render(pending);
    await settle();
    await act(async () => tree.update(element({ onBackupSaved: jest.fn() })));
    await settle();
    const row = host(tree, s.recovery.heading);
    expect(row.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityState: { expanded: false },
    });
    expect(flat(frameOf(row))).toMatchObject({
      backgroundColor: palette.espresso,
      borderBottomLeftRadius: 0,
    });
    expect(find(tree, s.recovery.reveal)).toBeUndefined();
    expect(focused().at(-1)).toBe(s.recovery.heading);
    // The halo on its disc has gone with the honey.
    expect(tree.root.findAll(node => node.type === Bloom)[0].props.halo).toBe(
      false,
    );
  });
});

describe('the card', () => {
  const bloom = (tree: ReactTestRenderer) =>
    tree.root.findAll(node => node.type === Bloom)[0].props;

  test('breathes at rest, and ratchets while the engine starts, the primary node then sought', async () => {
    const tree = await render();
    expect(bloom(tree)).toMatchObject({ mode: 'breathe', tone: 'test' });
    await act(async () => tree.update(element({ connecting: true })));
    expect(bloom(tree).mode).toBe('ratchet');
    expect(texts(tree)).toContain(s.card.connecting);
    expect(
      tree.root.find(node => node.props.accessibilityRole === 'summary').props
        .accessibilityLabel,
    ).toContain(s.card.connecting);
  });

  test('wilts with a honey pip once setup has stopped short', async () => {
    const tree = await render({
      snapshot: snapshotOf({ primary: { setup: 'failed' } }),
    });
    expect(bloom(tree)).toMatchObject({
      open: 0.6,
      event: { kind: 'wilt' },
    });
    expect(
      tree.root.findAll(node => node.props.testID === 'card-pip').length,
    ).toBeGreaterThan(0);
    // The Primary node row says so in honey.
    expect(host(tree, s.primary.heading).props.accessibilityValue.text).toBe(
      'Connected. Setup failed',
    );
  });

  test('unfolds as it arrives', async () => {
    jest.useFakeTimers();
    try {
      const tree = await render();
      expect(bloom(tree).open).toBe(0.6);
      await act(async () => jest.advanceTimersByTime(80));
      expect(bloom(tree).open).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('is slate on a test network and bloom on mainnet, glow and tag alike', async () => {
    const test = await render();
    const live = await render({
      snapshot: snapshotOf({ wallet: { network: 'mainnet' } }),
    });
    const stops = (tree: ReactTestRenderer) =>
      tree.root.findAllByType(Stop).map(stop => stop.props.stopColor);
    expect(stops(test)[0]).toBe(gradients.G1.test[0].color);
    expect(stops(live)[0]).toBe(gradients.G1.stops[0].color);
    // The tag is the first place the network is named: its glyph beside
    // its word.
    const tag = (tree: ReactTestRenderer, network: string) => {
      const [word] = tree.root.findAll(
        node => node.type === Text && node.props.children === network,
      );
      return word.parent!.findAll(
        node =>
          typeof node.type !== 'string' &&
          typeof node.props.name === 'string' &&
          typeof node.props.color === 'string',
      )[0].props;
    };
    expect(tag(test, 'regtest')).toMatchObject({
      name: 'flask',
      color: palette.slate,
    });
    expect(tag(live, 'mainnet')).toMatchObject({
      name: 'bolt',
      color: palette.bloom,
    });
  });
});

/**
 * Shared values that live as long as their component, as on a device: the
 * mock makes a new one each render, which would lose where a fill stood.
 */
function keepSharedValues() {
  const made = Reanimated.useSharedValue;
  jest
    .spyOn(Reanimated, 'useSharedValue')
    .mockImplementation(init => React.useState(() => made(init))[0]);
}

// Last: Reduce Motion, once read, holds while the next screen reads it.
describe('under Reduce Motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    keepSharedValues();
  });

  /** Settings, once it has read the setting. */
  async function reduced() {
    const tree = await render();
    await act(async () => {});
    return tree;
  }

  test('a chevron turns and a disc fills at once, and a press dips nothing', async () => {
    const tree = await reduced();
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await pressIn(tree, s.primary.heading);
    await press(tree, s.primary.heading);
    expect(
      springing.mock.calls.filter(([, config]) => config === springs.snap),
    ).toEqual([]);
    expect(springing.mock.calls.map(([to]) => to)).not.toContain(DISC_DIP);
    // The fill is set where it ends, with no timing to run.
    expect(
      timing.mock.calls.filter(
        ([to, config]) => to === 1 && config?.duration === durations.crossfade,
      ),
    ).toEqual([]);
  });

  test('the card holds still: its breath rests, and it is drawn unfolded', async () => {
    const tree = await reduced();
    const card = tree.root.findAll(node => node.type === Bloom)[0].props;
    expect(card.open).toBe(1);
  });

  test('without it, a chevron turns on the snap spring and a disc fills over a crossfade', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    const tree = await reduced();
    const springing = jest.spyOn(Reanimated, 'withSpring');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await pressIn(tree, s.primary.heading);
    await press(tree, s.primary.heading);
    expect(springing).toHaveBeenCalledWith(DISC_DIP, springs.snap);
    expect(springing).toHaveBeenCalledWith(1, springs.snap);
    expect(timing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: durations.crossfade }),
    );
  });
});
