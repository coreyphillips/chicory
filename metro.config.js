const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The same platform-neutral client powers the native and browser apps. In the
// development workspace the engine and wallet core sit beside this app and are
// watched so an edit there reloads here. A standalone clone installs both from
// GitHub instead, and has no such siblings to watch.
const siblings = [
  path.resolve(__dirname, '../../shared'),
  path.resolve(__dirname, '../../beignet-engine'),
].filter(dir => fs.existsSync(dir));

const config = {
  watchFolders: siblings,
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};
module.exports = mergeConfig(getDefaultConfig(__dirname), config);
