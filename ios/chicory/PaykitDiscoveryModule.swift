import Foundation
import React
import PaykitLookup

/** Public Paykit Payment List lookups, answered by the paykit-lookup Rust library. Nothing is stored. */
@objc(PaykitDiscovery)
class PaykitDiscoveryModule: NSObject {
    // Concurrent, because each lookup blocks its thread until the network answers.
    private let queue = DispatchQueue(label: "com.chicory.paykit-discovery", qos: .userInitiated, attributes: .concurrent)
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func getPaymentList(_ pubky: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            // A C string ends at the first NUL, which would look up only the text before it. Keep such input invalid.
            guard let raw = chicory_paykit_get_payment_list(pubky.replacingOccurrences(of: "\0", with: "\u{FFFD}")) else {
                return reject("LOOKUP_FAILED", "The lookup returned nothing", nil)
            }
            defer { chicory_paykit_free(raw) }
            let envelope = (try? JSONSerialization.jsonObject(with: Data(bytes: raw, count: strlen(raw)))) as? [String: Any]
            if let list = envelope?["ok"] as? [Any], let data = try? JSONSerialization.data(withJSONObject: list), let json = String(data: data, encoding: .utf8) {
                resolve(json)
            } else if let failure = envelope?["error"] as? [String: Any] {
                reject(failure["code"] as? String == "INVALID_PUBKY" ? "INVALID_PUBKY" : "LOOKUP_FAILED", failure["message"] as? String ?? "The lookup failed", nil)
            } else {
                reject("LOOKUP_FAILED", "The lookup answer could not be read", nil)
            }
        }
    }
}
