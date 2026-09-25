import React from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../../design/copy';
import { requireUnlock } from '../../services/lock';
import { PROMPT_SETTLE_MS, systemPromptOpen } from '../../stage/systemPrompt';
import { ACTIVATE, press } from '../../../test-support/query';
import { RecoveryPhrase } from '../RecoveryPhrase';

/**
 * Each render of the wrapper that decides whether the words' exit plays,
 * in turn: an exit keeps the words on screen until it ends, so it may play
 * only when the words are let go on purpose.
 */
const mockSkips: (boolean | undefined)[] = [];
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  LayoutAnimationConfig: ({
    skipExiting,
    children,
  }: {
    skipExiting?: boolean;
    children: ReactNode;
  }) => {
    mockSkips.push(skipExiting);
    return children;
  },
}));
jest.mock('../../services/lock', () => ({
  requireUnlock: jest.fn().mockResolvedValue(true),
}));

const words = copy.settings.recovery;
const PHRASE = 'one two three four five six seven eight nine ten eleven twelve';

const shown = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      /^\d+\. /.test(node.props.accessibilityLabel ?? ''),
  ).length;

let mounted: ReactTestRenderer | null = null;

async function revealed(onSaved?: () => void) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<RecoveryPhrase initialPhrase={PHRASE} onSaved={onSaved} />);
  });
  mounted = tree;
  await press(tree, words.reveal);
  expect(shown(tree)).toBe(12);
  return tree;
}

/** Whether the words' last render before they went let their exit play. */
const exitPlayed = () => mockSkips.at(-1) === false;

beforeEach(() => {
  mockSkips.length = 0;
});
// Unmounted even when a test fails, so no focus it queued outlives the suite.
afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) await act(async () => tree.unmount());
});

describe('the recovery words', () => {
  test('are held with their exit skipped while shown', async () => {
    await revealed();
    expect(mockSkips.length).toBeGreaterThan(0);
    expect(mockSkips.every(skip => skip === true)).toBe(true);
  });

  test('vanish at once, with no exit, as the app leaves the foreground', async () => {
    const tree = await revealed();
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    for (const state of ['inactive', 'background'] as const) {
      if (!shown(tree)) await press(tree, words.reveal);
      // Their last render as the app leaves has the exit skipped...
      expect(mockSkips.at(-1)).toBe(true);
      mockSkips.length = 0;
      await act(async () => listeners.forEach(listener => listener(state)));
      expect(shown(tree)).toBe(0);
      // ...and nothing lets it play before they go.
      expect(mockSkips).not.toContain(false);
    }
  });

  test('drop away when hidden', async () => {
    const tree = await revealed();
    await press(tree, words.hide);
    expect(shown(tree)).toBe(0);
    expect(exitPlayed()).toBe(true);
  });

  test('drop away once saved', async () => {
    const onSaved = jest.fn();
    const tree = await revealed(onSaved);
    const [hold] = tree.root.findAll(
      node =>
        node.props.accessibilityLabel === words.saved &&
        typeof node.props.onAccessibilityAction === 'function',
    );
    await act(async () => hold.props.onAccessibilityAction(ACTIVATE));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(shown(tree)).toBe(0);
    expect(exitPlayed()).toBe(true);
  });
});

describe('revealing the words', () => {
  test("asks for the lock's biometric as the app's own prompt", async () => {
    // The privacy cover leaves the page in view behind a prompt the app
    // raised, so Face ID does not blank the phrase's section.
    let during: boolean | null = null;
    jest.mocked(requireUnlock).mockImplementationOnce(async () => {
      during = systemPromptOpen();
      return true;
    });
    // The reveals before this one have let their spans go.
    await act(
      () => new Promise<void>(done => setTimeout(done, PROMPT_SETTLE_MS + 50)),
    );
    expect(systemPromptOpen()).toBe(false);
    const tree = await revealed();
    expect(requireUnlock).toHaveBeenCalledWith(words.prompt);
    expect(during).toBe(true);
    expect(shown(tree)).toBe(12);
  });
});
