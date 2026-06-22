import Foundation
import PikiclawCore

public struct AgentConnectionKey: Hashable, Codable, Sendable {
    public var agentId: EntityID
    public var agentKind: AgentKind
    public var executableName: String
    public var workspacePath: String
    public var runId: EntityID

    public init(
        agentId: EntityID,
        agentKind: AgentKind,
        executableName: String,
        workspacePath: String,
        runId: EntityID
    ) {
        self.agentId = agentId
        self.agentKind = agentKind
        self.executableName = executableName
        self.workspacePath = workspacePath
        self.runId = runId
    }
}

public protocol ReusableAgentConnection: Sendable {
    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error>
    func close() async
}

public protocol ReusableAgentAdapter: AgentAdapter {
    func makeConnection(
        for key: AgentConnectionKey,
        initialRequest: AgentLaunchRequest
    ) async throws -> any ReusableAgentConnection
}

public final actor AgentConnectionPool {
    public static let shared = AgentConnectionPool()

    private struct Entry {
        var connection: any ReusableAgentConnection
        var lastActivityAt: Date
        var isRunning: Bool
    }

    private var entries: [AgentConnectionKey: Entry] = [:]
    private var pruneTask: Task<Void, Never>?
    private let idleTTL: TimeInterval

    public init(idleTTL: TimeInterval = 600) {
        self.idleTTL = idleTTL
    }

    public func start(
        _ request: AgentLaunchRequest,
        adapter: any AgentAdapter,
        key: AgentConnectionKey
    ) async -> AsyncThrowingStream<RunnerEvent, Error> {
        await pruneIdleConnections(now: Date())

        guard let reusableAdapter = adapter as? any ReusableAgentAdapter else {
            return adapter.start(request)
        }

        do {
            let connection = try await reusableConnection(
                for: key,
                adapter: reusableAdapter,
                request: request
            )
            entries[key]?.isRunning = true
            entries[key]?.lastActivityAt = Date()
            let upstream = connection.start(request)
            return wrappedReusableStream(upstream, key: key)
        } catch {
            return AsyncThrowingStream { continuation in
                continuation.yield(.failed("Connection failed: \(error.localizedDescription)"))
                continuation.finish()
            }
        }
    }

    public func close(for key: AgentConnectionKey) async {
        guard let entry = entries.removeValue(forKey: key) else { return }
        await entry.connection.close()
    }

    public func closeAll() async {
        pruneTask?.cancel()
        pruneTask = nil
        let current = entries
        entries.removeAll()
        for entry in current.values {
            await entry.connection.close()
        }
    }

    private func reusableConnection(
        for key: AgentConnectionKey,
        adapter: any ReusableAgentAdapter,
        request: AgentLaunchRequest
    ) async throws -> any ReusableAgentConnection {
        if let entry = entries[key], !entry.isRunning {
            entries[key]?.lastActivityAt = Date()
            return entry.connection
        }

        if let entry = entries.removeValue(forKey: key) {
            await entry.connection.close()
        }

        let connection = try await adapter.makeConnection(for: key, initialRequest: request)
        entries[key] = Entry(connection: connection, lastActivityAt: Date(), isRunning: false)
        return connection
    }

    private func wrappedReusableStream(
        _ upstream: AsyncThrowingStream<RunnerEvent, Error>,
        key: AgentConnectionKey
    ) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in upstream {
                        continuation.yield(event)
                    }
                    await self.markReusableConnectionIdle(key)
                    continuation.finish()
                } catch {
                    await self.close(for: key)
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
                Task {
                    await self.markReusableConnectionIdle(key)
                }
            }
        }
    }

    private func markReusableConnectionIdle(_ key: AgentConnectionKey) {
        guard var entry = entries[key] else { return }
        entry.isRunning = false
        entry.lastActivityAt = Date()
        entries[key] = entry
        scheduleIdlePrune()
    }

    private func pruneIdleConnections(now: Date) async {
        var expired: [AgentConnectionKey] = []
        for (key, entry) in entries where !entry.isRunning && now.timeIntervalSince(entry.lastActivityAt) >= idleTTL {
            expired.append(key)
        }
        for key in expired {
            await close(for: key)
        }
        if !entries.isEmpty {
            scheduleIdlePrune()
        }
    }

    private func scheduleIdlePrune() {
        pruneTask?.cancel()
        pruneTask = Task { [idleTTL] in
            let delay = UInt64(max(idleTTL, 1) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await self.pruneIdleConnections(now: Date())
        }
    }
}
