package com.chicory

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.nfc.NfcAdapter
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
    val fromRecents = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    // Android may recreate the activity with a request already handled.
    val launch = if (savedInstanceState != null || fromRecents) {
      Intent(intent).setData(null)
    } else {
      paymentIntent(intent)
    }
    setIntent(launch)
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(false)
    }
  }

  /**
   * Linking delivers only a URI. Mark requests delivered through the permission-protected NFC
   * alias so JavaScript can distinguish a terminal tap from a browser link. The public activity
   * accepts only the two payment schemes, so no caller can supply the internal marker itself.
   */
  private fun paymentIntent(incoming: Intent): Intent {
    val uri = incoming.data ?: return incoming
    if (!uri.scheme.equals("bitcoin", ignoreCase = true) && !uri.scheme.equals("lightning", ignoreCase = true)) {
      return Intent(incoming).setData(null)
    }
    val fromTerminal = incoming.action == NfcAdapter.ACTION_NDEF_DISCOVERED &&
      incoming.component == ComponentName(this, "$packageName.NfcPayment")
    return if (fromTerminal) Intent(incoming).setData(Uri.parse("chicory-nfc:$uri")) else incoming
  }

  /**
   * And the link or tag that brought the app back is handed over here, before JavaScript is up to
   * be told of it. React Native passes it on only to a running app. Kept as the activity's own
   * intent, it is the one read at launch. Without this a tap at a terminal after the app had been
   * left a while opened it on Home, or on the request before.
   */
  override fun onNewIntent(intent: Intent) {
    val payment = paymentIntent(intent)
    setIntent(payment)
    super.onNewIntent(payment)
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
