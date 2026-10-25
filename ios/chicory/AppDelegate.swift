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
    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting session: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Wallet", sessionRole: session.role)
    configuration.delegateClass = ChicorySceneDelegate.self
    return configuration
  }
}

/// The single wallet scene owns its native window and React runtime. Scene
/// callbacks also cover a foreground return after iOS suspends the app.
class ChicorySceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var reactNativeDelegate: ReactNativeDelegate?
  private var reactNativeFactory: RCTReactNativeFactory?
  private var privacyCover: UIView?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let delegate = ReactNativeDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = RCTReactNativeFactory(delegate: delegate)

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(windowScene: windowScene)
    window?.backgroundColor = roast

    // React Native reads a cold payment link from its launch options before
    // JavaScript has subscribed to later Linking events.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    factory.startReactNative(
      withModuleName: "chicory",
      in: window,
      launchOptions: launchOptions
    )
    // React's root view is the root view controller's view. It starts as the
    // system background until the first React frame draws; nothing has been
    // painted yet, so roast holds from the launch screen through that gap.
    window?.rootViewController?.view.backgroundColor = roast

  }

  // The privacy cover (REDESIGN.md 6, app switcher). The picture the app
  // switcher keeps is taken once the app is in the background, and React's
  // own cover reaches it only if JavaScript is free to draw in time. A plain
  // roast view put over the window here, in the same call, is in that
  // picture however busy JavaScript is. It is not put up as the app merely
  // turns inactive: a prompt the app raised (paste, the camera, Face ID)
  // does that too, and the screen stays behind those, and an app-to-app
  // switch animates from a picture iOS takes before the app is told it is
  // leaving, which no cover reaches (P16).
  func sceneDidEnterBackground(_ scene: UIScene) {
    showPrivacyCover()
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
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
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = RCTLinkingManager.application(
        UIApplication.shared, open: context.url, options: options
      )
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if IROH_QUALIFICATION
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#elseif DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
