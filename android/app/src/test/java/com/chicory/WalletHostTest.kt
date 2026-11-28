package com.chicory

import android.os.Handler
import com.facebook.react.ReactHost
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.mockito.Mockito.*

class WalletHostTest {
    private val context = mock(ReactApplicationContext::class.java)
    private val owner = newOwner()
    private val endpoint = mock(ChicoryWalletEngine::class.java)
    private val generations = mutableListOf<Any>()
    private lateinit var finishDestroy: (Boolean) -> Unit
    private lateinit var hostFailure: (Exception) -> Unit
    private var timeout: Runnable? = null

    private val main = mock(Handler::class.java) { call ->
        when (call.method.name) {
            "post" -> { call.getArgument<Runnable>(0).run(); true }
            "postDelayed" -> { timeout = call.getArgument(0); true }
            "removeCallbacks" -> { timeout = null; null }
            else -> RETURNS_DEFAULTS.answer(call)
        }
    }
    private val router = WalletHosts(main) { _, token, onError ->
        generations.add(token)
        hostFailure = onError
        mock(ReactHost::class.java) { call ->
            if (call.method.name == "destroy") finishDestroy = call.getArgument(2)
            RETURNS_DEFAULTS.answer(call)
        }
    }
    init {
        `when`(context.getJSModule(ChicoryWalletEngine::class.java)).thenReturn(endpoint)
    }

    private fun newOwner() = mock(WalletHostModule::class.java).also {
        `when`(it.context).thenReturn(context)
    }

    @Test fun startupKeepsOrderAndSettlesEachReplyOnce() {
        val first = mock(Promise::class.java)
        val second = mock(Promise::class.java)
        `when`(context.lifecycleState).thenReturn(LifecycleState.RESUMED)
        router.dispatch(owner, "one", first)
        router.dispatch(owner, "two", second)
        verify(checkNotNull(router.hostFor(owner))).onHostResume(null)
        assertEquals(1, generations.size)
        assertNotNull(timeout)
        verifyNoInteractions(endpoint)
        router.ready(generations.single(), context)
        router.ready(generations.single(), context)
        assertNull(timeout)
        val order = inOrder(endpoint)
        order.verify(endpoint).receive("1", "one")
        order.verify(endpoint).receive("2", "two")
        verifyNoMoreInteractions(endpoint)
        router.reply(generations.single(), "2", "second")
        router.reply(generations.single(), "2", "duplicate")
        router.reply(generations.single(), "1", "first")
        verify(first).resolve("first")
        verify(second).resolve("second")
        verifyNoMoreInteractions(first, second)
    }

    @Test fun failedHostRejectsCallsAndCannotReplyIntoItsReplacement() {
        val first = mock(Promise::class.java)
        val next = mock(Promise::class.java)
        router.dispatch(owner, "sign", first)
        val old = generations.single()
        router.ready(old, context)
        hostFailure(IllegalStateException("fixture"))
        verify(first).reject("WALLET_HOST", "Wallet runtime failed")
        router.dispatch(owner, "status", next)
        assertNull(router.hostFor(owner))
        assertEquals(1, generations.size)
        finishDestroy(true)
        assertEquals(2, generations.size)
        router.ready(old, context)
        router.reply(old, "2", "stale")
        router.invalidate(newOwner(), old)
        verifyNoInteractions(next)
        router.ready(generations.last(), context)
        verify(endpoint, times(1)).receive("1", "sign")
        verify(endpoint, times(1)).receive("2", "status")
        router.reply(generations.last(), "2", "current")
        verify(next).resolve("current")
    }

    @Test fun replacementWaitsForItsInvalidatedOwnerAndNeverStartsAfterFailedTeardown() {
        val first = mock(Promise::class.java)
        val next = mock(Promise::class.java)
        val newOwner = newOwner()
        router.dispatch(owner, "open", first)
        `when`(owner.invalidated).thenReturn(true)
        router.dispatch(newOwner, "open", next)
        router.invalidate(owner, null)
        assertEquals(1, generations.size)
        verify(first).reject("WALLET_HOST", "Wallet runtime closed")
        finishDestroy(false)
        verify(next).reject("WALLET_HOST", "Could not close the previous wallet runtime")
        val retry = mock(Promise::class.java)
        router.dispatch(newOwner, "retry", retry)
        verify(retry).reject("WALLET_HOST", "Restart the app to reopen the wallet runtime")
        assertEquals(1, generations.size)
    }

    @Test fun missingBootstrapRejectsQueuedWorkWithoutReplayingIt() {
        val first = mock(Promise::class.java)
        router.dispatch(owner, "sign", first)
        timeout!!.run()
        verify(first).reject("WALLET_HOST", "Wallet runtime did not start")
        finishDestroy(true)
        router.ready(generations.single(), context)
        verifyNoInteractions(endpoint)
        assertNull(router.hostFor(owner))
    }
}
