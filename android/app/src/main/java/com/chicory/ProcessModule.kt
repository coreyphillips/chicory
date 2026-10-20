package com.chicory

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

/** What the process reports about itself, for the Diagnostics report. */
class ProcessModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "ChicoryProcess"

    /**
     * Every thread in this process as the kernel counts them, not only the ones the
     * Java runtime knows about, so parked pool threads and native threads both show.
     */
    @ReactMethod fun threadCount(promise: Promise) {
        val tasks = File("/proc/self/task").list()
        if (tasks == null) promise.reject("THREADS_UNREADABLE", "Could not read /proc/self/task")
        else promise.resolve(tasks.size)
    }
}

class ProcessPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ProcessModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
