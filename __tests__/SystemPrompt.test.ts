import {
  PROMPT_SETTLE_MS,
  duringSystemPrompt,
  systemPromptOpen,
} from '../src/stage/systemPrompt';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

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
