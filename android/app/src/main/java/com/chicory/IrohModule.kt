package com.chicory

import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import computer.iroh.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** One outbound BOLT 8 stream per connection. No Lightning keys or frames are interpreted here. */
class IrohModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val endpoints = ConcurrentHashMap<String, Endpoint>()
    private data class Link(val owner: String, val connection: Connection, val stream: BiStream)
    private val links = ConcurrentHashMap<String, Link>()
    private val binding = ConcurrentHashMap<String, Job>()
    private val dialing = ConcurrentHashMap<String, Pair<String, Job>>()
    override fun getName() = "ChicoryIroh"
    private fun strings(json: String): List<String> = JSONArray(json).let { a -> (0 until a.length()).map { a.getString(it) } }
    private fun run(promise: Promise, block: suspend () -> Any?) = scope.launch {
        try { promise.resolve(block()) } catch (e: Exception) { promise.reject("IROH_ERROR", e.message ?: "Iroh connection failed", e) }
    }
    private fun link(id: String) = links[id] ?: error("Iroh connection is closed")

    @ReactMethod fun bind(id: String, secret: String, relays: String, discovery: Boolean, promise: Promise) {
        val job = run(promise) {
            IrohAndroid.installAndroidContext(reactApplicationContext)
            val key = Base64.decode(secret, Base64.NO_WRAP)
            require(key.size == 32)
            val mode = if (relays.isEmpty()) RelayMode.defaultMode() else strings(relays).let {
                if (it.isEmpty()) RelayMode.disabled() else RelayMode.customFromUrls(it)
            }
            val endpoint = try { Endpoint.bind(EndpointOptions(
                preset = if (discovery) presetN0() else presetMinimal(),
                secretKey = key, alpns = emptyList(), relayMode = mode,
            )) } finally { key.fill(0) }
            if (!currentCoroutineContext().isActive) { endpoint.shutdown(); error("Iroh endpoint closed") }
            endpoints[id] = endpoint
            endpoint.id().toString()
        }
        binding[id] = job
        job.invokeOnCompletion { binding.remove(id, job) }
    }
    @ReactMethod fun connect(owner: String, id: String, peer: String, relay: String, addresses: String, promise: Promise) {
        val job = run(promise) {
            val endpoint = endpoints[owner] ?: error("Iroh endpoint is closed")
            val conn = endpoint.connect(EndpointAddr(EndpointId.fromString(peer), relay.ifEmpty { null }, strings(addresses)), "beignet/bolt8/1".toByteArray())
            try {
                conn.setMaxConcurrentBiStreams(0u)
                conn.setMaxConcurrentUniStreams(0u)
                val stream = conn.openBi()
                currentCoroutineContext().ensureActive()
                if (endpoints[owner] !== endpoint) error("Iroh endpoint closed")
                links[id] = Link(owner, conn, stream)
                // Already advertised stream credits cannot be withdrawn. Reject any extra stream.
                scope.launch { try { conn.acceptBi(); conn.close(1, "Unexpected stream".toByteArray()) } catch (_: Exception) {} }
                scope.launch { try { conn.acceptUni(); conn.close(1, "Unexpected stream".toByteArray()) } catch (_: Exception) {} }
                null
            } catch (e: Exception) { conn.close(0, byteArrayOf()); throw e }
        }
        dialing[id] = owner to job
        job.invokeOnCompletion { dialing.remove(id) }
    }
    @ReactMethod fun read(id: String, limit: Double, promise: Promise) { run(promise) {
        require(limit >= 1 && limit <= 65536 && limit == limit.toInt().toDouble())
        Base64.encodeToString(link(id).stream.recv().read(limit.toInt().toUInt()), Base64.NO_WRAP)
    } }
    @ReactMethod fun write(id: String, data: String, promise: Promise) { run(promise) {
        require(data.length <= 350000)
        link(id).stream.send().writeAll(Base64.decode(data, Base64.NO_WRAP)); null
    } }
    @ReactMethod fun closed(id: String, promise: Promise) { run(promise) { links[id]?.connection?.closed(); null } }
    @ReactMethod fun diagnostics(id: String, promise: Promise) { run(promise) {
        val conn = link(id).connection
        val path = conn.paths().firstOrNull { it.isSelected }
        JSONObject().put("endpointId", conn.remoteId().toString())
            .put("path", if (path?.isIp == true) "direct" else if (path?.isRelay == true) "relay" else "unknown")
            .apply { path?.let { put("rttMs", it.rttMs.toDouble()) } }.toString()
    } }
    private fun closeLink(id: String) {
        dialing.remove(id)?.second?.cancel()
        links.remove(id)?.connection?.close(0, byteArrayOf())
    }
    @ReactMethod fun closeConnection(id: String, promise: Promise) { run(promise) { closeLink(id); null } }
    @ReactMethod fun closeEndpoint(id: String, promise: Promise) { run(promise) {
        binding.remove(id)?.cancel()
        dialing.entries.filter { it.value.first == id }.forEach { closeLink(it.key) }
        links.entries.filter { it.value.owner == id }.forEach { closeLink(it.key) }
        endpoints.remove(id)?.shutdown(); null
    } }
    override fun invalidate() {
        binding.values.forEach { it.cancel() }
        dialing.keys.toList().forEach(::closeLink)
        links.keys.toList().forEach(::closeLink)
        val remaining = endpoints.values.toList(); endpoints.clear()
        scope.launch { try { remaining.forEach { it.shutdown() } } finally { scope.cancel() } }
        super.invalidate()
    }
}

class IrohPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(IrohModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
