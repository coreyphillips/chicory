package com.chicory

import com.asterinet.react.tcpsocket.TcpEventListener
import com.asterinet.react.tcpsocket.TcpSocketModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import java.net.InetAddress
import java.net.ServerSocket
import org.junit.Assert.assertEquals
import org.junit.Test
import org.mockito.Mockito.*

class WalletSocketTeardownTest {
    @Test fun invalidatingTheWalletDisconnectsOnlyItsOwnConnections() {
        val host = "127.0.0.1"
        val address = InetAddress.getByName(host)
        val options = mock(ReadableMap::class.java)
        mockConstruction(TcpEventListener::class.java).use { events ->
            val wallet = TcpSocketModule(mock(ReactApplicationContext::class.java))
            val app = TcpSocketModule(mock(ReactApplicationContext::class.java))
            wallet.initialize()
            app.initialize()
            try {
                ServerSocket(0, 2, address).use { listener ->
                    listener.soTimeout = 5000
                    wallet.connect(1, host, listener.localPort, options)
                    listener.accept().use { walletPeer ->
                        app.connect(1, host, listener.localPort, options)
                        listener.accept().use { appPeer ->
                            wallet.invalidate()
                            walletPeer.soTimeout = 5000
                            assertEquals(-1, walletPeer.getInputStream().read())
                            appPeer.getOutputStream().write(42)
                            verify(events.constructed()[1], timeout(5000)).onData(1, byteArrayOf(42))
                        }
                    }
                }
            } finally {
                wallet.invalidate()
                app.invalidate()
            }
        }
    }
}
