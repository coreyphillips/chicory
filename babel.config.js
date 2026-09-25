module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Turns animation callbacks into worklets that run on the UI thread. It must
  // stay the last plugin in the list.
  plugins: ['react-native-worklets/plugin'],
  env: { test: { plugins: ['@babel/plugin-transform-dynamic-import'] } },
};
