import { TurboModuleRegistry } from 'react-native';
import { Buffer } from 'buffer';
import { secureRandomBytes } from '../src/embedded/random';

afterEach(() => jest.restoreAllMocks());
test('native secure randomness fails closed when the native generator is unavailable', () => {
  jest.spyOn(TurboModuleRegistry, 'getEnforcing').mockImplementation(() => {
    throw new Error('Native module unavailable');
  });
  const insecureFallback = jest.spyOn(Math, 'random');
  let thrown: unknown;
  try {
    secureRandomBytes(32);
  } catch (error) {
    thrown = error;
  }
  const calls = insecureFallback.mock.calls.length;
  insecureFallback.mockRestore();
  expect((thrown as Error).message).toBe('Native module unavailable');
  expect(calls).toBe(0);
});
test('native secure randomness rejects a truncated result instead of generating weak key material', () => {
  jest.spyOn(TurboModuleRegistry, 'getEnforcing').mockReturnValue({
    getRandomBase64: () => Buffer.alloc(4).toString('base64'),
  } as never);
  expect(() => secureRandomBytes(32)).toThrow('invalid result');
  expect(() => secureRandomBytes(65537)).toThrow(
    'Invalid secure random byte count',
  );
});
