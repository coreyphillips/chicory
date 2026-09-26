import { NativeModules, Platform } from 'react-native';
import {
  PROMPT_SETTLE_MS,
  duringSystemPrompt,
  systemPromptOpen,
} from '../src/stage/systemPrompt';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  delete NativeModules.PrivacyCover;
  jest.restoreAllMocks();
});

/**
 * iOS's native privacy cover, as `ios/chicory/PrivacyCover.m` exports it,
 * writing what it is told, as it is told, to `told`.
 */
function nativeCover(told: string[]) {
  const setSystemPromptOpen = jest.fn((open: boolean) => {
    told.push(open ? 'open' : 'closed');
    return null;
  });
  NativeModules.PrivacyCover = { setSystemPromptOpen, setLockShown: jest.fn() };
  return setSystemPromptOpen;
}

test('a prompt the app raised is open until a moment after it settles', async () => {
  expect(systemPromptOpen()).toBe(false);
  let answer!: (text: string) => void;
  const pasted = duringSystemPrompt(
    () => new Promise<string>(resolve => (answer = resolve)),
  );
  expect(systemPromptOpen()).toBe(true);
  answer('lnbc1');
  await expect(pasted).resolves.toBe('lnbc1');
  expect(systemPromptOpen()).toBe(true);
  jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  expect(systemPromptOpen()).toBe(false);
});

test('a refused prompt closes the span too', async () => {
  const refused = duringSystemPrompt(() => Promise.reject(new Error('no')));
  await expect(refused).rejects.toThrow('no');
  jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  expect(systemPromptOpen()).toBe(false);
});

test('overlapping prompts keep the span open until the last settles', async () => {
  const first = duringSystemPrompt(() => Promise.resolve(1));
  let answer!: () => void;
  const second = duringSystemPrompt(
    () => new Promise<void>(resolve => (answer = resolve)),
  );
  await first;
  jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  expect(systemPromptOpen()).toBe(true);
  answer();
  await second;
  jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  expect(systemPromptOpen()).toBe(false);
});

describe("iOS's native cover", () => {
  test('is told the span is open before the prompt is raised, and closed only once it settles', async () => {
    const told: string[] = [];
    nativeCover(told);
    let answer!: (text: string) => void;
    const pasted = duringSystemPrompt(() => {
      // The call that raises the prompt: the flag is already set.
      told.push('raised');
      return new Promise<string>(resolve => (answer = resolve));
    });
    expect(told).toEqual(['open', 'raised']);
    answer('lnbc1');
    await expect(pasted).resolves.toBe('lnbc1');
    jest.advanceTimersByTime(PROMPT_SETTLE_MS - 1);
    expect(told).toEqual(['open', 'raised']);
    jest.advanceTimersByTime(1);
    expect(told).toEqual(['open', 'raised', 'closed']);
  });

  test('is told once each way across overlapping prompts, a refused one included', async () => {
    const told: string[] = [];
    nativeCover(told);
    const refused = duringSystemPrompt(() => Promise.reject(new Error('no')));
    let answer!: () => void;
    const second = duringSystemPrompt(
      () => new Promise<void>(resolve => (answer = resolve)),
    );
    await expect(refused).rejects.toThrow('no');
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(told).toEqual(['open']);
    answer();
    await second;
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(told).toEqual(['open', 'closed']);
  });

  test('never stands in the way of the prompt: missing, failing, or on Android', async () => {
    // Missing, as under Jest or in a build without it.
    await expect(duringSystemPrompt(() => Promise.resolve(1))).resolves.toBe(1);
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    // Failing: untold, it covers the prompt, which hides more, not less.
    NativeModules.PrivacyCover = {
      setSystemPromptOpen: () => {
        throw new Error('gone');
      },
    };
    await expect(duringSystemPrompt(() => Promise.resolve(2))).resolves.toBe(2);
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(systemPromptOpen()).toBe(false);
    // Android draws no native cover (its recents card is blank instead), so
    // nothing is told there.
    jest.replaceProperty(Platform, 'OS', 'android');
    const told: string[] = [];
    const setSystemPromptOpen = nativeCover(told);
    await expect(duringSystemPrompt(() => Promise.resolve(3))).resolves.toBe(3);
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(setSystemPromptOpen).not.toHaveBeenCalled();
  });
});
