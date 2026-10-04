const {
  PREFIX,
  databaseOptions,
  replacements,
  replaceChecked,
} = require('./isolation');

test('fixture credentials cannot read, enumerate or erase ordinary wallet entries', async () => {
  const entries = new Map([
    ['wallet', 'original'],
    [PREFIX + 'wallet', 'fixture'],
  ]);
  const base = {
    getGenericPassword: jest.fn(async o =>
      entries.has(o.service)
        ? { password: entries.get(o.service), service: o.service }
        : false,
    ),
    setGenericPassword: jest.fn(async (u, p, o) => {
      entries.set(o.service, p);
      return { service: o.service };
    }),
    hasGenericPassword: jest.fn(async o => entries.has(o.service)),
    resetGenericPassword: jest.fn(async o => entries.delete(o.service)),
    getAllGenericPasswordServices: async () => [...entries.keys()],
  };
  const { keychain } = replacements(base, { open: jest.fn() });
  expect(await keychain.getGenericPassword({ service: 'wallet' })).toEqual({
    password: 'fixture',
    service: 'wallet',
  });
  expect(await keychain.getAllGenericPasswordServices()).toEqual(['wallet']);
  expect(await keychain.hasGenericPassword({ service: 'wallet' })).toBe(true);
  await keychain.resetGenericPassword({ service: 'wallet' });
  expect(await keychain.getGenericPassword({ service: 'wallet' })).toBe(false);
  await keychain.setGenericPassword('user', 'new', undefined);
  expect(entries.get(PREFIX + 'default')).toBe('new');
  expect(entries.get('wallet')).toBe('original');
  expect(await keychain.getGenericPassword()).toEqual({
    password: 'new',
    service: 'default',
  });
  expect(await keychain.hasGenericPassword()).toBe(true);
  await keychain.resetGenericPassword();
  expect(await keychain.getAllGenericPasswordServices()).toEqual([]);
});

test('lease, probe, encrypted databases and deletes open only prefixed names', () => {
  const { safeDatabaseName } = require('../../src/embedded/storage');
  const native = { open: jest.fn(o => ({ delete: () => o.name })) };
  const { sqlite } = replacements({}, native);
  for (const name of [
    'beignet-runtime-lease.sqlite',
    'beignet-regtest-device-volume.sqlite',
    'legacy.sqlite',
    safeDatabaseName('/wallet/regtest.db', 'regtest'),
    safeDatabaseName('device-volume', 'legacy'),
  ]) {
    const options = { name, encryptionKey: 'test-key', readOnly: true };
    const db = sqlite.open(options);
    expect(native.open).toHaveBeenLastCalledWith({
      ...options,
      name: PREFIX + name,
    });
    expect(db.delete()).toBe(PREFIX + name);
    expect(options.name).toBe(name);
  }
  for (const options of [
    { name: '../vault' },
    { name: '/vault' },
    { name: 'a\\vault' },
    { name: 'a', location: '/tmp' },
    { name: 'a', path: '/tmp' },
    { name: 'a'.repeat(161) },
    { name: ':memory:' },
  ])
    expect(() => databaseOptions(options)).toThrow();
  for (const method of [
    'openAsync',
    'openSync',
    'openRemote',
    'moveAssetsDatabase',
  ])
    expect(() => sqlite[method]({ name: 'vault' })).toThrow();
});

test('unwritable module replacement prevents fixture startup', () => {
  const target = Object.defineProperty({}, 'open', { get: () => null });
  expect(() => replaceChecked(target, { open: () => null })).toThrow();
});
