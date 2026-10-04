/** Native storage namespacing for the disposable regtest entry only. */
const PREFIX = 'send-max-fixture-v1.';
function credentialOptions(options) {
  const service = options?.service ?? 'default';
  if (typeof service !== 'string' || !service || service.length > 512)
    throw new Error('Invalid fixture credential service');
  return { ...options, service: PREFIX + service };
}
function databaseOptions(options) {
  if (
    !options ||
    typeof options.name !== 'string' ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.%-]{0,159}$/.test(options.name) ||
    options.location !== undefined ||
    options.path !== undefined
  )
    throw new Error('Fixture database must use a plain local name');
  return { ...options, name: PREFIX + options.name };
}
function replacements(keychain, sqlite) {
  const original = { ...keychain };
  const open = sqlite.open;
  return {
    keychain: {
      getGenericPassword: async options => {
        const result = await original.getGenericPassword(
          credentialOptions(options),
        );
        return result
          ? { ...result, service: options?.service ?? 'default' }
          : false;
      },
      setGenericPassword: async (username, password, options) => {
        const result = await original.setGenericPassword(
          username,
          password,
          credentialOptions(options),
        );
        return result
          ? { ...result, service: options?.service ?? 'default' }
          : false;
      },
      hasGenericPassword: options =>
        original.hasGenericPassword(credentialOptions(options)),
      resetGenericPassword: options =>
        original.resetGenericPassword(credentialOptions(options)),
      getAllGenericPasswordServices: async options =>
        (await original.getAllGenericPasswordServices(options))
          .filter(service => service.startsWith(PREFIX))
          .map(service => service.slice(PREFIX.length)),
    },
    sqlite: {
      open: options => open(databaseOptions(options)),
      // No alternate entry into native storage is allowed in this fixture.
      openAsync: () => {
        throw new Error('Use fixture open');
      },
      openSync: () => {
        throw new Error('Use fixture open');
      },
      openRemote: () => {
        throw new Error('Remote fixture storage is disabled');
      },
      moveAssetsDatabase: () => {
        throw new Error('Fixture database import is disabled');
      },
    },
  };
}
function replaceChecked(target, methods) {
  Object.assign(target, methods);
  for (const [key, value] of Object.entries(methods)) {
    if (target[key] !== value)
      throw new Error('Fixture storage isolation failed');
  }
}
module.exports = { PREFIX, databaseOptions, replacements, replaceChecked };
