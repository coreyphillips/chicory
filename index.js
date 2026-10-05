/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { startBootPerf } from './src/services/perf';
import { name as appName } from './app.json';

// The boot report (src/services/perf.ts) times the launch from here. The app
// is required after it starts rather than imported: every import is
// evaluated before this file's own code runs, so an imported App, and the
// wallet code it brings with it, would load before the clock started.
startBootPerf();
const App = require('./App').default;

AppRegistry.registerComponent(appName, () => App);
