#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * What the native privacy cover is told from JavaScript (REDESIGN.md 6, app
 * switcher). The app delegate puts a roast view over the window as the app
 * goes inactive, since iOS starts the app switcher from a picture it takes
 * then, before React can draw a cover of its own. Two things leave the screen
 * in view instead: a prompt the app raised itself (paste, the camera, Face
 * ID), which makes the app inactive too, and the lock, which shows nothing of
 * the wallet and keeps its bud in view behind its own Face ID prompt.
 *
 * JavaScript sets both through the `PrivacyCover` module, blocking and
 * synchronous, so each is set before its next native call, the one that
 * raises the prompt. They are process wide and read on the main thread.
 */
@interface PrivacyCover : NSObject

/** A prompt the app raised may be up now (`duringSystemPrompt`). */
@property (class, nonatomic, readonly) BOOL systemPromptOpen;

/** The lock is what the app draws, so nothing of the wallet shows. */
@property (class, nonatomic, readonly) BOOL lockShown;

@end

NS_ASSUME_NONNULL_END
