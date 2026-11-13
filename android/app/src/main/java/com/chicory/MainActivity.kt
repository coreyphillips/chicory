package com.chicory

import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * The privacy cover (REDESIGN.md 6, app switcher). Recents shows a picture Android takes as the
   * app leaves, before React can draw its cover, so from Android 13 on it takes none and the app's
   * card is blank. The person's own screenshots are left alone, as FLAG_SECURE would not.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(false)
    }
  }

  /**
   * A payment link, or a tag read by the phone, reaches the app as an intent. Once JavaScript is
   * up, React Native reads the one this activity holds (IntentModule.getInitialURL). Android can
   * make that the wrong one in two ways, both after it has taken the app's process back while the
   * app was behind others, which it does freely.
   *
   * Android builds the activity again with the intent it was first made for, which the app acted
   * on long ago. So an activity built from saved state, or from the recents list, forgets the
   * request in its intent: opening the app again must not open Send on a request already dealt
   * with.
   */
  override fun onPostCreate(savedInstanceState: Bundle?) {
    super.onPostCreate(savedInstanceState)
    val fromRecents = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    if (savedInstanceState != null || fromRecents) {
      setIntent(Intent(intent).setData(null))
    }
  }

  /**
   * And the link or tag that brought the app back is handed over here, before JavaScript is up to
   * be told of it. React Native passes it on only to a running app. Kept as the activity's own
   * intent, it is the one read at launch. Without this a tap at a terminal after the app had been
   * left a while opened it on Home, or on the request before.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "chicory"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
