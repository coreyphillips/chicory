/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import { registerWalletEngine } from './src/embedded/registerWalletEngine';
import { walletHost } from './src/embedded/walletHostNative';

registerWalletEngine();
if (!walletHost.isEngineRuntime) {
  require('./src/services/perf').startBootPerf();
  AppRegistry.registerComponent(appName, () => require('./App').default);
}
