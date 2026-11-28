package com.chicory

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.ReactApplicationContext
import com.oblador.keychain.DataStorePrefsStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.mockito.Mockito.*

class SharedKeychainTest {
    @get:Rule val directory = TemporaryFolder()

    @Test fun bothHostsSeeTheSameMigratedEntriesAfterEitherHostIsDestroyed() {
        val app = mock(Context::class.java)
        val legacy = mock(SharedPreferences::class.java)
        val edit = mock(SharedPreferences.Editor::class.java, RETURNS_SELF)
        val original = mapOf("legacy-wallet:c" to "old-wallet-cipher", "app-lock:c" to "lock-cipher")
        `when`(app.applicationContext).thenReturn(app)
        `when`(app.filesDir).thenReturn(directory.root)
        `when`(app.getSharedPreferences("RN_KEYCHAIN", Context.MODE_PRIVATE)).thenReturn(legacy)
        doReturn(original).`when`(legacy).all
        `when`(legacy.edit()).thenReturn(edit)
        `when`(edit.commit()).thenReturn(true)

        fun host(scope: CoroutineScope): DataStorePrefsStorage {
            val context = mock(ReactApplicationContext::class.java)
            `when`(context.applicationContext).thenReturn(app)
            return DataStorePrefsStorage(context, scope)
        }
        val uiScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val workerScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val nextWorkerScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        try {
            val ui = host(uiScope)
            val wallet = host(workerScope)
            assertEquals(original.values.toSet(), ui.usedCipherNames)
            assertEquals(ui.usedCipherNames, wallet.usedCipherNames)
            wallet.removeEntry("legacy-wallet")
            assertEquals(setOf("lock-cipher"), ui.usedCipherNames)
            workerScope.cancel()
            val next = host(nextWorkerScope)
            assertEquals(setOf("lock-cipher"), next.usedCipherNames)
            uiScope.cancel()
            next.removeEntry("app-lock")
            assertEquals(emptySet<String>(), next.usedCipherNames)
        } finally {
            uiScope.cancel()
            workerScope.cancel()
            nextWorkerScope.cancel()
        }
    }
}
