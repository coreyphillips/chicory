import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

/// Roast, #110E0C: the launch storyboard's colour and `palette.roast` in
/// src/design/palette.ts. The window and React's root view are painted with it
/// so the hand-off from the launch screen to the first React frame never shows
/// the system background, which is near white in light appearance.
let roast = UIColor(red: 17 / 255, green: 14 / 255, blue: 12 / 255, alpha: 1)

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// The privacy cover while it is up (REDESIGN.md 6, app switcher).
  private var privacyCover: UIView?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Restoring an old system backup of a live channel can roll back commitment
    // state. Wallet files stay on this device; recovery must use current state.
    do {
      for kind in [FileManager.SearchPathDirectory.documentDirectory, .libraryDirectory] {
        var directory = FileManager.default.urls(for: kind, in: .userDomainMask)[0]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
      }
    } catch {
      fatalError("Could not exclude wallet state from stale system backups.")
    }
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    window?.backgroundColor = roast

    factory.startReactNative(
      withModuleName: "chicory",
      in: window,
      launchOptions: launchOptions
    )
    // React's root view is the root view controller's view. It starts as the
    // system background until the first React frame draws; nothing has been
    // painted yet, so roast holds from the launch screen through that gap.
    window?.rootViewController?.view.backgroundColor = roast

    return true
  }

  // The privacy cover (REDESIGN.md 6, app switcher). iOS starts the app
  // switcher's animation from a picture it takes as the app goes inactive,
  // before React can draw its own cover, so the balance showed in the
  // outgoing card. A plain roast view put over the window in this same call
  // is in that picture. Behind a prompt the app raised itself (paste, the
  // camera, Face ID) the screen stays, so the person sees what they are
  // answering for, and over the lock, which shows nothing of the wallet, its
  // bud stays in view behind Face ID. JavaScript says when, through
  // PrivacyCover.
  func applicationWillResignActive(_ application: UIApplication) {
    if PrivacyCover.systemPromptOpen || PrivacyCover.lockShown {
      return
    }
    showPrivacyCover()
  }

  // No prompt outlasts going to the background, so the cover is up there
  // whatever JavaScript said.
  func applicationDidEnterBackground(_ application: UIApplication) {
    showPrivacyCover()
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    privacyCover?.removeFromSuperview()
    privacyCover = nil
  }

  /// Over everything in the window, at once: nothing fades that the switcher
  /// could catch half drawn.
  private func showPrivacyCover() {
    guard let window = window else { return }
    if let cover = privacyCover {
      window.bringSubviewToFront(cover)
      return
    }
    let cover = UIView(frame: window.bounds)
    cover.backgroundColor = roast
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.accessibilityElementsHidden = true
    window.addSubview(cover)
    privacyCover = cover
  }

  // A payment link opened while the app runs reaches React Native's Linking,
  // which only hears about it through these. A cold start reads the launch
  // URL on its own.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
