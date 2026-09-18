import { createPortableRuntime } from '@beignet/portable-engine';

// Exercise the installed engine, rather than mocking the wallet adapter. A
// passing UI test must not hide a stale native dependency after an upgrade.
test('the installed engine reports the verified upstream release', async () => {
  const runtime = await createPortableRuntime({
    volume: {
      read: () => null,
      write: () => {
        throw new Error('No wallet should be written');
      },
      remove: () => {},
      rename: () => {},
    },
    databaseFactory: () => {
      throw new Error('No database should be opened');
    },
    socketFactory: () => {
      throw new Error('No network should be opened');
    },
  });
  try {
    const config = await runtime.request({ path: '/api/config' });
    expect(config.engineVersion).toBe('0.21.7-portable');
  } finally {
    await runtime.close();
  }
});
