import Foundation
import React
import IrohLib

private struct IrohFailure: Error { let message: String }

/** Serialized ownership, with cancellation across every suspension point. */
private actor IrohState {
    struct Link { let owner: String; let connection: Connection; let stream: BiStream }
    var endpoints: [String: Endpoint] = [:]
    var links: [String: Link] = [:]
    var bindings: [String: Task<Endpoint, Error>] = [:]
    var dials: [String: (String, Task<Link, Error>)] = [:]

    func bind(_ id: String, _ secret: String, _ relays: String, _ discovery: Bool) async throws -> String {
        guard let key = Data(base64Encoded: secret), key.count == 32 else { throw IrohFailure(message: "Invalid endpoint key") }
        let urls = relays.isEmpty ? nil : try JSONDecoder().decode([String].self, from: Data(relays.utf8))
        let mode = try urls.map { $0.isEmpty ? RelayMode.disabled() : try RelayMode.customFromUrls(urls: $0) } ?? RelayMode.defaultMode()
        let task = Task { try await Endpoint.bind(options: EndpointOptions(preset: discovery ? presetN0() : presetMinimal(), secretKey: key, alpns: [], relayMode: mode)) }
        bindings[id] = task
        defer { bindings.removeValue(forKey: id) }
        let endpoint = try await task.value
        guard bindings[id] != nil, !task.isCancelled else { try? await endpoint.close(); throw CancellationError() }
        endpoints[id] = endpoint
        return endpoint.id().description
    }
    func connect(_ owner: String, _ id: String, _ peer: String, _ relay: String, _ addresses: String) async throws {
        guard let endpoint = endpoints[owner] else { throw IrohFailure(message: "Iroh endpoint closed") }
        let addr = EndpointAddr(id: try EndpointId.fromString(s: peer), relayUrl: relay.isEmpty ? nil : relay, addresses: try JSONDecoder().decode([String].self, from: Data(addresses.utf8)))
        let task = Task { () throws -> Link in
            let connection = try await endpoint.connect(addr: addr, alpn: Data("beignet/bolt8/1".utf8))
            do {
                try connection.setMaxConcurrentBiStreams(count: 0)
                try connection.setMaxConcurrentUniStreams(count: 0)
                let stream = try await connection.openBi()
                try Task.checkCancellation()
                return Link(owner: owner, connection: connection, stream: stream)
            } catch { try? connection.close(errorCode: 0, reason: Data()); throw error }
        }
        dials[id] = (owner, task)
        defer { dials.removeValue(forKey: id) }
        let link = try await task.value
        let connection = link.connection
        guard dials[id] != nil, endpoints[owner] === endpoint, !task.isCancelled else {
            try? connection.close(errorCode: 0, reason: Data()); throw CancellationError()
        }
        links[id] = link
        // Reject stream credits that were advertised before we set the limit.
        Task { do { _ = try await connection.acceptBi(); try connection.close(errorCode: 1, reason: Data("Unexpected stream".utf8)) } catch {} }
        Task { do { _ = try await connection.acceptUni(); try connection.close(errorCode: 1, reason: Data("Unexpected stream".utf8)) } catch {} }
    }

    func link(_ id: String) throws -> Link {
        guard let link = links[id] else { throw IrohFailure(message: "Iroh connection closed") }
        return link
    }
    func read(_ id: String, _ limit: Double) async throws -> String {
        guard limit >= 1, limit <= 65536, limit.rounded() == limit else { throw IrohFailure(message: "Invalid read size") }
        return try await link(id).stream.recv().read(sizeLimit: UInt32(limit)).base64EncodedString()
    }
    func write(_ id: String, _ data: String) async throws {
        guard data.count <= 350000, let bytes = Data(base64Encoded: data) else { throw IrohFailure(message: "Invalid write size") }
        try await link(id).stream.send().writeAll(buf: bytes)
    }
    func closed(_ id: String) async { if let link = links[id] { _ = await link.connection.closed() } }
    func diagnostics(_ id: String) throws -> String {
        let conn = try link(id).connection
        let path = conn.paths().first { $0.isSelected }
        var result: [String: Any] = ["endpointId": conn.remoteId().description, "path": path?.isIp == true ? "direct" : path?.isRelay == true ? "relay" : "unknown"]
        if let path { result["rttMs"] = path.rttMs }
        return String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!
    }
    func closeConnection(_ id: String) {
        dials.removeValue(forKey: id)?.1.cancel()
        if let link = links.removeValue(forKey: id) { try? link.connection.close(errorCode: 0, reason: Data()) }
    }
    func closeEndpoint(_ id: String) async {
        bindings.removeValue(forKey: id)?.cancel()
        for key in dials.filter({ $0.value.0 == id }).map({ $0.key }) { closeConnection(key) }
        for key in links.filter({ $0.value.owner == id }).map({ $0.key }) { closeConnection(key) }
        if let endpoint = endpoints.removeValue(forKey: id) { try? await endpoint.close() }
    }
    func closeAll() async {
        let ids = Set(endpoints.keys).union(bindings.keys)
        for id in ids { await closeEndpoint(id) }
    }
}

@objc(ChicoryIroh)
class IrohModule: NSObject, RCTInvalidating {
    private let state = IrohState()
    @objc static func requiresMainQueueSetup() -> Bool { false }
    private func run(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock, _ body: @escaping () async throws -> Any?) {
        Task { do { resolve(try await body()) } catch { reject("IROH_ERROR", (error as? IrohFailure)?.message ?? error.localizedDescription, error) } }
    }
    @objc func bind(_ id: String, secret: String, relays: String, discovery: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        run(resolve, reject) { try await self.state.bind(id, secret, relays, discovery) }
    }
    @objc func connect(_ owner: String, id: String, peer: String, relay: String, addresses: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        run(resolve, reject) { try await self.state.connect(owner, id, peer, relay, addresses); return nil }
    }
    @objc func read(_ id: String, limit: Double, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { try await self.state.read(id, limit) } }
    @objc func write(_ id: String, data: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { try await self.state.write(id, data); return nil } }
    @objc func closed(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { await self.state.closed(id); return nil } }
    @objc func diagnostics(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { try await self.state.diagnostics(id) } }
    @objc func closeConnection(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { await self.state.closeConnection(id); return nil } }
    @objc func closeEndpoint(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) { run(resolve, reject) { await self.state.closeEndpoint(id); return nil } }
    func invalidate() { Task { await state.closeAll() } }
}
