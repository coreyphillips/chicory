import CoreNFC
import Foundation
import React

/// Larger than any payment request, and small enough to hand to JavaScript whole.
private let maxMessageBytes = 8 * 1024

/// How long the system's sheet may stay up. The app lock allows a prompt 30 seconds, and iOS would hold the sheet for 60.
/// The seam keeps the same deadline (TAP_DEADLINE_MS in src/services/tapReader.ts); this one stands if JavaScript is held up.
private let deadlineSeconds: TimeInterval = 20

/**
 Reads the NDEF message of one tag held to the iPhone, from the payment scanner's button (docs/TAP-TO-PAY.md), and hands
 its records to JavaScript untouched. What a record says is decided there, in src/services/ndef.ts.

 Core NFC reads the tag before this hears of it: it runs the tag's own procedure, loops the chunked reads and reads the
 message to its end, so nothing here speaks to a tag. The sheet's one line comes from JavaScript, so no words live here.
 */
@objc(ChicoryNfc)
class NfcReaderModule: NSObject, RCTInvalidating, NFCNDEFReaderSessionDelegate {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    // All touched on the main queue only. A session holds its delegate weakly, so it is kept here until it ends.
    private var session: NFCNDEFReaderSession?
    private var resolve: RCTPromiseResolveBlock?
    private var reject: RCTPromiseRejectBlock?
    private var deadline: DispatchWorkItem?

    /// No tag reading on this device, or ready to read. An iPhone has no switch for NFC, so it is never "off".
    @objc func status(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve(NFCNDEFReaderSession.readingAvailable ? "ready" : "missing")
    }

    /// Raises the system's sheet with `prompt` as its line, and answers with the records of the first tag read.
    @objc func read(_ prompt: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            // One sheet at a time. A newer read takes over from an older one.
            self.settle(nil, "TAP_CANCELLED", invalidating: true)
            guard NFCNDEFReaderSession.readingAvailable else {
                reject("TAP_FAILED", "NFC is unavailable.", nil)
                return
            }
            let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: true)
            if !prompt.isEmpty { session.alertMessage = prompt }
            self.session = session
            self.resolve = resolve
            self.reject = reject
            let deadline = DispatchWorkItem { self.settle(nil, "TAP_TIMEOUT", invalidating: true) }
            self.deadline = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + deadlineSeconds, execute: deadline)
            session.begin()
        }
    }

    /// Takes the sheet down and ends the read.
    @objc func cancel(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.settle(nil, "TAP_CANCELLED", invalidating: true)
            resolve(nil)
        }
    }

    /// Answers the read once, with records or with why there are none, and lets go of the session. A session that has
    /// read its tag ends itself, with the system's own mark on the sheet, so only a read called off is invalidated here.
    private func settle(_ records: [[String: Any]]?, _ code: String, invalidating: Bool) {
        deadline?.cancel()
        deadline = nil
        let ended = session
        let resolve = self.resolve
        let reject = self.reject
        session = nil
        self.resolve = nil
        self.reject = nil
        if invalidating { ended?.invalidate() }
        if let records { resolve?(records) } else { reject?(code, "The tag gave no payment request.", nil) }
    }

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        guard session === self.session else { return }
        var records: [[String: Any]] = []
        var size = 0
        for message in messages {
            for record in message.records {
                size += record.type.count + record.payload.count
                records.append([
                    "tnf": Int(record.typeNameFormat.rawValue),
                    "type": record.type.base64EncodedString(),
                    "payload": record.payload.base64EncodedString(),
                ])
            }
        }
        if size > maxMessageBytes {
            settle(nil, "TAP_TOO_LARGE", invalidating: false)
        } else {
            settle(records, "", invalidating: false)
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // A session that has answered is no longer this one, so the end that follows its first read is passed over.
        guard session === self.session else { return }
        let code: String
        switch (error as? NFCReaderError)?.code {
        case .readerSessionInvalidationErrorUserCanceled: code = "TAP_CANCELLED"
        case .readerSessionInvalidationErrorSessionTimeout: code = "TAP_TIMEOUT"
        // The build was signed without the right to read tags, so it never can.
        case .readerErrorSecurityViolation, .readerErrorUnsupportedFeature: code = "TAP_UNAVAILABLE"
        default: code = "TAP_FAILED"
        }
        settle(nil, code, invalidating: false)
    }

    func invalidate() {
        DispatchQueue.main.async { self.settle(nil, "TAP_CANCELLED", invalidating: true) }
    }
}
