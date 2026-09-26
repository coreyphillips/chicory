import { NativeModules, Platform } from 'react-native';

/**
 * What the iOS app delegate's privacy cover is told (REDESIGN.md 6, app
 * switcher). iOS starts the app switcher from a picture it takes as the app
 * goes inactive, before React draws the stage's own cover, so a plain roast
 * view goes up natively in that same moment. It leaves the screen in view
 * where the stage's cover does: behind a prompt the app raised, and over the
 * lock, which shows nothing of the wallet. These say when.
 *
 * Each call is blocking and synchronous (`PrivacyCover` in ios/chicory), so
 * the flag is set before JavaScript's next native call, the one that raises
 * the prompt. Android has no such cover, its recents card being blank
 * instead, and without the module, as under Jest, nothing is told.
 */
interface PrivacyCoverModule {
  setSystemPromptOpen(open: boolean): null;
  setLockShown(shown: boolean): null;
}

// Held from the start. A prompt's settle timer can run as the JavaScript
// environment is torn down, when react-native's lazy exports can no longer
// be asked for.
const platform = Platform;
const modules = NativeModules;

function nativeCover(): PrivacyCoverModule | null {
  if (platform.OS !== 'ios') return null;
  return (modules.PrivacyCover as PrivacyCoverModule | undefined) ?? null;
}

/**
 * Untold, the native cover goes up over the prompt or the lock, which hides
 * more rather than less, so a call that fails is let go, reaching the
 * module included.
 */
function tell(say: (module: PrivacyCoverModule) => void) {
  try {
    const module = nativeCover();
    if (module) say(module);
  } catch {
    // Covered rather than shown: the side to be wrong on.
  }
}

/** A prompt the app raised may be up now, or no longer is. */
export function tellSystemPromptOpen(open: boolean): void {
  tell(module => module.setSystemPromptOpen(open));
}

/** The lock is what the stage draws, or no longer is. */
export function tellLockShown(shown: boolean): void {
  tell(module => module.setLockShown(shown));
}

// The flags outlive a reload of the JavaScript runtime, which starts with no
// prompt open and no lock drawn.
tell(module => {
  module.setSystemPromptOpen(false);
  module.setLockShown(false);
});
