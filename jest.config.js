module.exports = {
  preset: '@react-native/jest-preset',
  watchman: false,
  // A cold cache pays the Babel transform inside the first test of a suite,
  // which overruns the 5s default on a clean checkout and in CI.
  testTimeout: 20000,
  resolver: '<rootDir>/test-support/jest-resolver.js',
  transformIgnorePatterns: [
    // The wallet core ships ES modules, as do the animation and gesture
    // packages, so they are transformed rather than skipped the way the rest
    // of node_modules is.
    'node_modules/(?!((jest-)?react-native|react-native-(url-polyfill|reanimated|worklets|gesture-handler)|@react-native(-community)?|@beignet/wallet-core)/)',
  ],
  modulePaths: ['<rootDir>/node_modules'],
  setupFiles: [
    '<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js',
    './jest.setup.js',
  ],
  moduleNameMapper: {
    '^@beignet/wallet-core$': '<rootDir>/node_modules/@beignet/wallet-core/src/index.js',
  },
};
