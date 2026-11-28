package com.chicory

import android.os.Handler
import android.os.Looper
import com.asterinet.react.tcpsocket.TcpSocketPackage
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.common.LifecycleState
import com.facebook.react.common.JavascriptException
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.defaults.DefaultComponentsRegistry
import com.facebook.react.defaults.DefaultReactHostDelegate
import com.facebook.react.defaults.DefaultTurboModuleManagerDelegate
import com.facebook.react.fabric.ComponentFactory
import com.facebook.react.runtime.ReactHostImpl
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.uimanager.ViewManager
import com.oblador.keychain.KeychainPackage
import com.op.sqlite.OPSQLitePackage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.linusu.RNGetRandomValuesPackage
import rs.craby.reactnativenitrotor.ReactNativeNitroTorPackage

internal interface ChicoryWalletEngine : JavaScriptModule {
    fun receive(id: String, request: String)
}

internal interface ChicoryWalletEvents : JavaScriptModule {
    fun receive(session: String, event: String)
}

internal class WalletHostPackage(private val generation: Any? = null) : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(WalletHostModule(context, generation))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

internal class WalletHostModule(
    val context: ReactApplicationContext,
    private val generation: Any?,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    @Volatile var invalidated = false
        private set

    override fun getName() = "ChicoryWalletHost"
    override fun getConstants(): Map<String, Any> = mapOf("isEngineRuntime" to (generation != null))

    // Tor's native main may only run once per process, even following a failed bootstrap.
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun claimTorStart(): Boolean = torLaunched.compareAndSet(false, true)

    private companion object {
        val torLaunched = AtomicBoolean(false)
    }

    override fun initialize() {
        super.initialize()
        if (generation == null) context.addLifecycleEventListener(this)
    }

    @ReactMethod fun dispatch(request: String, promise: Promise) {
        if (generation != null) {
            promise.reject("WALLET_HOST", "Only the app can dispatch wallet requests")
            return
        }
        AndroidWallet.hosts.main.post { AndroidWallet.hosts.dispatch(this, request, promise) }
    }

    @ReactMethod fun ready() {
        generation?.let { AndroidWallet.hosts.main.post { AndroidWallet.hosts.ready(it, context) } }
    }

    @ReactMethod fun reply(id: String, response: String) {
        generation?.let { AndroidWallet.hosts.main.post { AndroidWallet.hosts.reply(it, id, response) } }
    }

    @ReactMethod fun notify(session: String, event: String) {
        generation?.let { AndroidWallet.hosts.main.post { AndroidWallet.hosts.notify(it, session, event) } }
    }

    override fun onHostResume() {
        AndroidWallet.hosts.hostFor(this)?.onHostResume(context.currentActivity)
    }
    override fun onHostPause() { AndroidWallet.hosts.hostFor(this)?.onHostPause() }
    override fun onHostDestroy() { AndroidWallet.hosts.hostFor(this)?.onHostDestroy() }

    override fun invalidate() {
        invalidated = true
        if (generation == null) context.removeLifecycleEventListener(this)
        AndroidWallet.hosts.main.post { AndroidWallet.hosts.invalidate(this, generation) }
        super.invalidate()
    }
}

/** Route on the main looper so dispatch, replies and Activity lifecycle share one ordering.
 * The two ReactHosts each have their own JS thread. No surface is mounted in the wallet host.
 */
internal class WalletHosts(
    val main: Handler,
    private val newHost: (ReactApplicationContext, Any, (Exception) -> Unit) -> ReactHost,
) {
    private var owner: WalletHostModule? = null
    private var engine: ReactHost? = null
    private var generation: Any? = null
    private var endpoint: ChicoryWalletEngine? = null
    private var walletContext: JavaScriptContextHolder? = null
    private var destroying = false
    private var teardownFailed = false
    private var nextId = 0L
    private val pending = mutableMapOf<String, Promise>()
    private val outgoing = ArrayDeque<Pair<String, String>>()
    private val startupTimeout = Runnable { stop("Wallet runtime did not start") }

    fun hostFor(module: WalletHostModule): ReactHost? = if (owner === module) engine else null

    fun dispatch(module: WalletHostModule, request: String, promise: Promise) {
        if (teardownFailed) {
            promise.reject("WALLET_HOST", "Restart the app to reopen the wallet runtime")
            return
        }
        if (owner?.invalidated == true) stop("Wallet runtime closed")
        if (module.invalidated || (owner != null && owner !== module)) {
            promise.reject("WALLET_HOST", "Wallet runtime owner changed")
            return
        }
        owner = module
        val id = (++nextId).toString()
        pending[id] = promise
        outgoing.addLast(id to request)
        if (!destroying && engine == null) start(module)
        flush()
    }

    private fun start(module: WalletHostModule) {
        val token = Any()
        generation = token
        try {
            val host = newHost(module.context, token) { error ->
                main.post { if (generation === token) fail("Wallet runtime failed", error) }
            }
            engine = host
            if (module.context.lifecycleState == LifecycleState.RESUMED) {
                host.onHostResume(module.context.currentActivity)
            }
            main.postDelayed(startupTimeout, 60_000)
            host.start()
        } catch (error: Exception) {
            fail("Could not start wallet runtime", error)
        }
    }

    fun ready(token: Any, context: ReactApplicationContext) {
        if (generation !== token || endpoint != null) return
        walletContext = context.javaScriptContextHolder
        endpoint = context.getJSModule(ChicoryWalletEngine::class.java)
        if (endpoint == null) {
            stop("Wallet runtime has no message handler")
            return
        }
        main.removeCallbacks(startupTimeout)
        flush()
    }

    private fun flush() {
        val target = endpoint ?: return
        try {
            while (outgoing.isNotEmpty()) {
                val (id, request) = outgoing.removeFirst()
                target.receive(id, request)
            }
        } catch (error: Exception) {
            fail("Could not reach wallet runtime", error)
        }
    }

    fun reply(token: Any, id: String, response: String) {
        if (generation === token) pending.remove(id)?.resolve(response)
    }

    fun notify(token: Any, session: String, event: String) {
        if (generation === token) {
            owner?.takeUnless { it.invalidated }?.context
                ?.getJSModule(ChicoryWalletEvents::class.java)?.receive(session, event)
        }
    }

    fun invalidate(module: WalletHostModule, token: Any?) {
        if (owner === module || (token != null && generation === token)) stop("Wallet runtime closed")
    }

    private fun fail(reason: String, error: Exception) {
        try {
            val cause = walletFailureCategory(error)
            owner?.takeUnless { it.invalidated }?.context?.getJSModule(ChicoryWalletEvents::class.java)
                ?.receive("", """{"type":"log","event":{"phase":"wallet-runtime","message":"$reason ($cause)"}}""")
        } catch (_: Exception) {
            // The UI may already be tearing down.
        } finally {
            stop(reason)
        }
    }

    private fun stop(reason: String) {
        main.removeCallbacks(startupTimeout)
        generation = null
        endpoint = null
        owner = null
        outgoing.clear()
        pending.values.forEach { it.reject("WALLET_HOST", reason) }
        pending.clear()
        val previous = engine ?: return
        val contextHolder = walletContext ?: previous.currentReactContext?.javaScriptContextHolder
        walletContext = null
        engine = null
        destroying = true
        previous.destroy(reason, null) { destroyed ->
            // RN 0.88 converts destroy failures to soft exceptions. ReactInstance.destroy
            // clears this holder only after native modules and the JS runtime are released.
            val released = contextHolder != null && synchronized(contextHolder) { contextHolder.get() == 0L }
            previous.invalidate()
            main.post {
                if (destroyed && released) {
                    destroying = false
                    owner?.let(::start)
                } else {
                    teardownFailed = true
                    stop("Could not close the previous wallet runtime")
                }
            }
        }
    }
}

private val jsErrorKinds = listOf("TypeError", "ReferenceError", "RangeError", "SyntaxError")
private val frameLocation = Regex("[0-9]{1,7}:[0-9]{1,8}")

internal fun walletFailureCategory(error: Exception): String = when (error) {
    is JavascriptException -> {
        val stack = error.message.orEmpty()
        val kind = jsErrorKinds.firstOrNull { stack.startsWith("$it:") } ?: "Error"
        // RN's JSStackTrace.format separates frames from the message and writes function@line:column.
        val frame = stack.substringAfterLast(", stack:\n", "").substringBefore('\n').substringAfterLast('@', "")
        if (frameLocation.matches(frame)) "JavaScript $kind at $frame" else "JavaScript $kind"
    }
    is android.database.sqlite.SQLiteException -> "SQLite error"
    is java.security.GeneralSecurityException, is SecurityException -> "security error"
    is java.io.IOException -> "I/O error"
    is IllegalArgumentException -> "invalid argument"
    is IllegalStateException -> "invalid state"
    else -> "native exception"
}

private object AndroidWallet {
    val hosts by lazy { WalletHosts(Handler(Looper.getMainLooper()), ::createWalletHost) }

    // ReactHostImpl schedules setup and destruction on this executor. Reuse it across app reloads.
    private val walletHostExecutor = Executors.newSingleThreadExecutor()

    @OptIn(UnstableReactNativeAPI::class)
    private fun createWalletHost(context: ReactApplicationContext, generation: Any, onError: (Exception) -> Unit): ReactHost {
        val app = context.applicationContext
        val source = checkNotNull(context.sourceURL) { "Missing app bundle" }
        // Metro already downloaded the exact bundle running in the app. Reuse its local file
        // so only the UI host owns the packager connection and reload lifecycle.
        val loader = when {
            source.startsWith("assets://") -> JSBundleLoader.createAssetLoader(app, source, true)
            source.startsWith("http://") || source.startsWith("https://") -> {
                val uiHost = (app as ReactApplication).reactHost
                val cached = checkNotNull(uiHost?.devSupportManager?.downloadedJSBundleFile)
                JSBundleLoader.createCachedBundleFromNetworkLoader(source, cached)
            }
            else -> JSBundleLoader.createFileLoader(source)
        }
        val delegate = DefaultReactHostDelegate(
            jsMainModulePath = "index",
            jsBundleLoader = loader,
            reactPackages = listOf(
                MainReactPackage(), OPSQLitePackage(), RNGetRandomValuesPackage(), KeychainPackage(),
                TcpSocketPackage(), ReactNativeNitroTorPackage(), IrohPackage(), WalletHostPackage(generation),
            ),
            turboModuleManagerDelegateBuilder = DefaultTurboModuleManagerDelegate.Builder(),
            exceptionHandler = onError,
        )
        val components = ComponentFactory()
        DefaultComponentsRegistry.register(components)
        return ReactHostImpl(
            app, delegate, components, bgExecutor = walletHostExecutor,
            allowPackagerServerAccess = false, useDevSupport = false,
        )
    }
}
