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
