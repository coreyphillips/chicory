/**
 * The app's own version, read from package.json so there is one number to bump.
 * `android/app/build.gradle` and `ios/chicory/Info.plist` are kept in step
 * with it; the About row in Settings shows this value.
 */
export const APP_VERSION: string = require('../package.json').version;
