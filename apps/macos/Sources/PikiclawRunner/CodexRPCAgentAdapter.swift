import Foundation
import PikiclawCore

public struct CodexRPCAgentAdapter: ReusableAgentAdapter {
    public let descriptor: AgentDescriptor

    public init(descriptor: AgentDescriptor) {
        self.descriptor = descriptor
    }

    public func detect() async -> AgentDetection {
        let environment = NativeExecutableResolver.executionEnvironment()
        let path = NativeExecutableResolver.findExecutable(named: descriptor.executableName, environment: environment)
        return AgentDetection(
            isAvailable: path != nil,
            executablePath: path,
            authState: path == nil ? "unavailable" : "unknown",
            detail: path == nil ? "\(descriptor.executableName) was not found on PATH." : "Codex app-server ready."
        )
    }

    public func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let key = AgentConnectionKey(
                        agentId: descriptor.id,
                        agentKind: descriptor.kind,
                        executableName: descriptor.executableName,
                        workspacePath: request.workspacePath,
                        runId: request.run.id
                    )
                    let connection = try await makeConnection(for: key, initialRequest: request)
                    for try await event in connection.start(request) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                    await connection.close()
                } catch {
                    continuation.yield(.failed(error.localizedDescription))
                    continuation.finish()
                }
            }
        }
    }

    public func makeConnection(
        for key: AgentConnectionKey,
        initialRequest: AgentLaunchRequest
    ) async throws -> any ReusableAgentConnection {
        var environment = NativeExecutableResolver.executionEnvironment(requestEnvironment: initialRequest.environment)
        guard let executablePath = NativeExecutableResolver.findExecutable(named: descriptor.executableName, environment: environment) else {
            throw CodexRPCError.executableMissing(descriptor.executableName)
        }
        environment = NativeExecutableResolver.environmentIncludingExecutableDirectory(executablePath, environment: environment)
        return CodexRPCAgentConnection(
            executablePath: executablePath,
            environment: environment
        )
    }
}

public final class CodexRPCAgentConnection: ReusableAgentConnection, @unchecked Sendable {
    private let client: CodexRPCClient
    private let threadLock = NSLock()
    private var threadId: String?

    init(executablePath: String, environment: [String: String]) {
        self.client = CodexRPCClient(executablePath: executablePath, environment: environment)
    }

    public func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                await runTurn(request, continuation: continuation)
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    public func close() async {
        await client.close()
    }

    private func runTurn(
        _ request: AgentLaunchRequest,
        continuation: AsyncThrowingStream<RunnerEvent, Error>.Continuation
    ) async {
        continuation.yield(.stateChanged(.starting))
        guard await client.ensureRunning() else {
            continuation.yield(.failed("Failed to start Codex app-server."))
            continuation.finish()
            return
        }

        let activeThreadId = currentThreadId() ?? request.run.nativeSessionRef?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let threadResp: CodexRPCResponse
        if let activeThreadId {
            threadResp = await client.call(
                "thread/resume",
                params: threadParams(request, threadId: activeThreadId),
                timeout: 60
            )
        } else {
            threadResp = await client.call(
                "thread/start",
                params: threadParams(request),
                timeout: 60
            )
        }

        if let error = CodexRPCClient.errorMessage(from: threadResp) {
            continuation.yield(.failed(error))
            continuation.finish()
            return
        }

        let resolvedThreadId = Self.threadId(from: threadResp.value) ?? activeThreadId
        if let resolvedThreadId {
            setThreadId(resolvedThreadId)
            continuation.yield(.output("{\"type\":\"thread.started\",\"thread_id\":\"\(Self.jsonEscaped(resolvedThreadId))\"}\n"))
        }

        guard let turnThreadId = resolvedThreadId else {
            continuation.yield(.failed("Codex app-server did not return a thread id."))
            continuation.finish()
            return
        }

        let turnBox = LockedValue<CodexRPCTurnState>(CodexRPCTurnState())
        await client.setNotificationHandler { method, params in
            Self.handleNotification(method: method, params: params, threadId: turnThreadId, state: turnBox, continuation: continuation)
        }

        continuation.yield(.stateChanged(.running))
        let turnResp = await client.call(
            "turn/start",
            params: [
                "threadId": turnThreadId,
                "input": [["type": "text", "text": request.prompt]]
            ],
            timeout: 60
        )

        if let error = CodexRPCClient.errorMessage(from: turnResp) {
            await client.setNotificationHandler(nil)
            continuation.yield(.failed(error))
            continuation.finish()
            return
        }

        await turnBox.waitForCompletion(timeout: 24 * 60 * 60)
        await client.setNotificationHandler(nil)

        let finalState = turnBox.withLock { $0 }
        if let error = finalState.error {
            continuation.yield(.failed(error))
        } else {
            continuation.yield(.completed(exitCode: finalState.completed ? 0 : 1))
        }
        continuation.finish()
    }

    private func currentThreadId() -> String? {
        threadLock.lock()
        defer { threadLock.unlock() }
        return threadId
    }

    private func setThreadId(_ value: String) {
        threadLock.lock()
        threadId = value
        threadLock.unlock()
    }

    private func threadParams(_ request: AgentLaunchRequest, threadId: String? = nil) -> [String: Any] {
        var params: [String: Any] = [
            "cwd": request.workspacePath,
            "approvalPolicy": "never",
            "sandbox": Self.codexSandbox(for: request.run.permissionMode)
        ]
        if let threadId {
            params["threadId"] = threadId
        }
        return params
    }

    private static func codexSandbox(for mode: PermissionMode) -> String {
        switch mode {
        case .readOnly:
            return "read-only"
        case .askBeforeEdit:
            return "workspace-write"
        case .autopilot:
            return "danger-full-access"
        }
    }

    private static func handleNotification(
        method: String,
        params: [String: Any],
        threadId: String,
        state: LockedValue<CodexRPCTurnState>,
        continuation: AsyncThrowingStream<RunnerEvent, Error>.Continuation
    ) {
        if let eventThreadId = params["threadId"] as? String, eventThreadId != threadId {
            return
        }

        switch method {
        case "item/agentMessage/delta":
            if let delta = params["delta"] as? String, !delta.isEmpty {
                state.withLock { state in
                    state.didStreamText = true
                }
                continuation.yield(.output(delta))
            }
        case "item/completed":
            if let item = params["item"] as? [String: Any],
               item["type"] as? String == "agentMessage",
               let text = item["text"] as? String,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let shouldEmit = state.withLock { state -> Bool in
                    guard !state.didStreamText else { return false }
                    state.didStreamText = true
                    return true
                }
                if shouldEmit {
                    continuation.yield(.output(text))
                }
            }
        case "item/reasoning/textDelta", "item/reasoning/summaryTextDelta":
            break
        case "turn/completed":
            let turn = params["turn"] as? [String: Any]
            let status = turn?["status"] as? String
            let error = turn?["error"] as? [String: Any]
            let errorMessage = error?["message"] as? String ?? error?["code"] as? String
            state.complete(success: status == nil || status == "completed", error: errorMessage)
        default:
            break
        }
    }

    private static func threadId(from response: [String: Any]) -> String? {
        guard let result = response["result"] as? [String: Any],
              let thread = result["thread"] as? [String: Any],
              let id = thread["id"] as? String,
              !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return id.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func jsonEscaped(_ value: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [value]), encoding: .utf8))?
            .dropFirst()
            .dropLast()
            .description ?? value
    }
}

private enum CodexRPCError: LocalizedError {
    case executableMissing(String)

    var errorDescription: String? {
        switch self {
        case .executableMissing(let name):
            return "\(name) was not found on PATH."
        }
    }
}

private struct CodexRPCResponse: @unchecked Sendable {
    var value: [String: Any]
}

private struct CodexRPCTurnState {
    var completed = false
    var error: String?
    var didStreamText = false
    fileprivate var continuation: CheckedContinuation<Void, Never>?

    mutating func finish(success: Bool, error: String?) {
        completed = success
        self.error = error
        continuation?.resume()
        continuation = nil
    }
}

private extension LockedValue where Value == CodexRPCTurnState {
    func complete(success: Bool, error: String?) {
        withLock { state in
            state.finish(success: success, error: error)
        }
    }

    func waitForCompletion(timeout: TimeInterval) async {
        let didComplete = withLock { $0.completed || $0.error != nil }
        if didComplete { return }

        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await withCheckedContinuation { continuation in
                    self.withLock { state in
                        if state.completed || state.error != nil {
                            continuation.resume()
                        } else {
                            state.continuation = continuation
                        }
                    }
                }
            }
            group.addTask {
                let delay = UInt64(max(timeout, 1) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: delay)
                self.complete(success: false, error: "Timed out waiting for Codex turn completion.")
            }
            await group.next()
            group.cancelAll()
        }
    }
}

private final actor CodexRPCClient {
    private let executablePath: String
    private let environment: [String: String]
    private var process: Process?
    private var stdin: Pipe?
    private var stdout: Pipe?
    private var stderr: Pipe?
    private var buffer = ""
    private var nextId = 1
    private var pending: [Int: CheckedContinuation<CodexRPCResponse, Never>] = [:]
    private var notificationHandler: (@Sendable (String, [String: Any]) -> Void)?
    private var startTask: Task<Bool, Never>?

    init(executablePath: String, environment: [String: String]) {
        self.executablePath = executablePath
        self.environment = environment
    }

    func ensureRunning() async -> Bool {
        if process != nil { return true }
        if let startTask { return await startTask.value }
        let task = Task { await start() }
        startTask = task
        let result = await task.value
        startTask = nil
        return result
    }

    func setNotificationHandler(_ handler: (@Sendable (String, [String: Any]) -> Void)?) {
        notificationHandler = handler
    }

    func call(_ method: String, params: [String: Any]? = nil, timeout: TimeInterval = 30) async -> CodexRPCResponse {
        guard let process, let stdin, process.isRunning else {
            return CodexRPCResponse(value: ["error": ["message": "Codex app-server is not running."]])
        }
        let id = nextId
        nextId += 1
        return await withCheckedContinuation { continuation in
            pending[id] = continuation
            var message: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method]
            if let params {
                message["params"] = params
            }
            write(message, to: stdin)
            Task {
                let delay = UInt64(max(timeout, 1) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: delay)
                await self.resolvePending(id: id, response: ["error": ["message": "RPC call '\(method)' timed out."]])
            }
        }
    }

    func close() {
        stdout?.fileHandleForReading.readabilityHandler = nil
        stderr?.fileHandleForReading.readabilityHandler = nil
        try? stdin?.fileHandleForWriting.close()
        process?.terminate()
        process = nil
        stdin = nil
        stdout = nil
        stderr = nil
        for (_, continuation) in pending {
            continuation.resume(returning: CodexRPCResponse(value: ["error": ["message": "Codex app-server closed."]]))
        }
        pending.removeAll()
        notificationHandler = nil
    }

    static func errorMessage(from response: CodexRPCResponse) -> String? {
        guard let error = response.value["error"] as? [String: Any] else { return nil }
        if let message = error["message"] as? String, !message.isEmpty {
            return message
        }
        return String(describing: error)
    }

    private func start() async -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = ["app-server", "-c", "features.goals=true"]
        process.environment = environment

        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { await self?.handleStdout(data) }
        }
        stderr.fileHandleForReading.readabilityHandler = { _ in }
        process.terminationHandler = { [weak self] _ in
            Task {
                await self?.handleProcessExit()
            }
        }

        do {
            try process.run()
        } catch {
            return false
        }

        self.process = process
        self.stdin = stdin
        self.stdout = stdout
        self.stderr = stderr

        let response = await call(
            "initialize",
            params: [
                "clientInfo": ["name": "pikiclaw-mac", "version": "0.2.0"],
                "capabilities": ["experimentalApi": true]
            ],
            timeout: 30
        )
        if Self.errorMessage(from: response) != nil {
            close()
            return false
        }
        return true
    }

    private func handleStdout(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""
        for line in lines.dropLast() {
            handleLine(line)
        }
    }

    private func handleLine(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        if let id = message["id"] as? Int, let continuation = pending.removeValue(forKey: id) {
            continuation.resume(returning: CodexRPCResponse(value: message))
            return
        }

        guard let method = message["method"] as? String else { return }
        if message["id"] != nil {
            respond(to: message["id"]!, result: defaultResponse(for: method))
            return
        }
        let params = message["params"] as? [String: Any] ?? [:]
        notificationHandler?(method, params)
    }

    private func handleProcessExit() {
        process = nil
        stdin = nil
        stdout = nil
        stderr = nil
        for (_, continuation) in pending {
            continuation.resume(returning: CodexRPCResponse(value: ["error": ["message": "Codex app-server exited."]]))
        }
        pending.removeAll()
        notificationHandler = nil
    }

    private func resolvePending(id: Int, response: [String: Any]) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        continuation.resume(returning: CodexRPCResponse(value: response))
    }

    private func respond(to id: Any, result: [String: Any]) {
        guard let stdin else { return }
        write(["jsonrpc": "2.0", "id": id, "result": result], to: stdin)
    }

    private func write(_ message: [String: Any], to pipe: Pipe) {
        guard JSONSerialization.isValidJSONObject(message),
              let data = try? JSONSerialization.data(withJSONObject: message),
              var text = String(data: data, encoding: .utf8) else {
            return
        }
        text.append("\n")
        if let payload = text.data(using: .utf8) {
            try? pipe.fileHandleForWriting.write(contentsOf: payload)
        }
    }

    private func defaultResponse(for method: String) -> [String: Any] {
        switch method {
        case "item/commandExecution/requestApproval":
            return ["decision": "accept"]
        case "item/fileChange/requestApproval":
            return ["decision": "accept"]
        case "item/permissions/requestApproval":
            return ["permissions": [:], "scope": "turn"]
        case "item/tool/requestUserInput":
            return ["answers": [:]]
        default:
            return [:]
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
