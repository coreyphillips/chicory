/**
 * The React Native preset's resolver, plus the one rule the worklets package
 * asks for: its modules resolve without the `.native` platform extensions, so
 * Jest loads the JavaScript implementation rather than native bindings that
 * have no runtime here.
 * Jest takes a single resolver, so the two are composed here.
 */
const reactNative = require('@react-native/jest-preset/jest/resolver.js');

module.exports = (request, options) => {
  if (/react-native-worklets/.test(`${options.basedir} ${request}`)) {
    options = {
      ...options,
      extensions: options.extensions?.filter(ext => !ext.includes('native')),
    };
  }
  // Reanimated runs its JavaScript implementation under Jest, but its native
  // initializer wires up a CSS event bridge that implementation does not have.
  // The plain initializer is the one that matches it.
  if (
    request === './initializers' &&
    options.basedir.includes('react-native-reanimated')
  ) {
    options = {
      ...options,
      extensions: options.extensions?.filter(ext => !ext.includes('native')),
    };
  }
  return reactNative(request, options);
};
