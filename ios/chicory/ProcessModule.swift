import Foundation
import React

/** What the process reports about itself, for the Diagnostics report. */
@objc(ChicoryProcess)
class ProcessModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    /// Every thread in this process as the kernel counts them, the same figure Android reads from /proc/self/task.
    @objc func threadCount(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        var threads: thread_act_array_t?
        var count: mach_msg_type_number_t = 0
        guard task_threads(mach_task_self_, &threads, &count) == KERN_SUCCESS, let list = threads else {
            reject("THREADS_UNREADABLE", "Could not list the process's threads", nil)
            return
        }
        // The list comes with a send right per thread; give those back with the list.
        for index in 0..<Int(count) { mach_port_deallocate(mach_task_self_, list[index]) }
        vm_deallocate(mach_task_self_, vm_address_t(bitPattern: list), vm_size_t(Int(count) * MemoryLayout<thread_t>.stride))
        resolve(Int(count))
    }
}
