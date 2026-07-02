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
        let mcpPlan = initialRequest.mcpRequirements.isEmpty
            ? CodexMCPRegistrationPlan()
            : CodexMCPRegistrationPlan.prepare(
                workspacePath: initialRequest.workspacePath,
                baseEnvironment: &environment
            )
        return CodexRPCAgentConnection(
            executablePath: executablePath,
            environment: environment,
            mcpPlan: mcpPlan
        )
    }
}

public final class CodexRPCAgentConnection: ReusableAgentConnection, @unchecked Sendable {
    static let turnEventIdleTimeout: TimeInterval = 4 * 60
    static let threadOpenTimeout: TimeInterval = 90

    private let executablePath: String
    private let client: CodexRPCClient
    private let environment: [String: String]
    private let mcpPlan: CodexMCPRegistrationPlan
    private let threadLock = NSLock()
    private var threadId: String?

    fileprivate init(executablePath: String, environment: [String: String], mcpPlan: CodexMCPRegistrationPlan) {
        self.executablePath = executablePath
        self.environment = environment
        self.mcpPlan = mcpPlan
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
        continuation.yield(.output(Self.thinkingOutput("Starting Codex session.") + "\n"))
        let mcpRegistration = request.mcpRequirements.isEmpty
            ? nil
            : CodexMCPRegistration(plan: mcpPlan, executablePath: executablePath, environment: environment)
        if let mcpRegistration {
            await client.close()
            await mcpRegistration.register()
        }
        defer {
            if let mcpRegistration {
                Task {
                    await mcpRegistration.cleanup()
                    await client.close()
                }
            }
        }
        guard await client.ensureRunning() else {
            let diagnostic = await client.recentStderrSummary()
            continuation.yield(.failed(Self.failureMessage("Failed to start Codex app-server.", diagnostic: diagnostic)))
            continuation.finish()
            return
        }

        let activeThreadId = Self.sanitizedThreadId(currentThreadId())
            ?? Self.sanitizedThreadId(request.run.nativeSessionRef)
        continuation.yield(.output(Self.thinkingOutput(activeThreadId == nil ? "Opening a Codex thread." : "Resuming Codex thread.") + "\n"))
        var threadResp: CodexRPCResponse
        var resolvedActiveThreadId = activeThreadId
        if let activeThreadId {
            threadResp = await client.call(
                "thread/resume",
                params: threadParams(request, threadId: activeThreadId),
                timeout: Self.threadOpenTimeout
            )
            if Self.isTimeoutResponse(threadResp, method: "thread/resume") {
                continuation.yield(.output(Self.thinkingOutput("Resume timed out; opening a fresh Codex thread.") + "\n"))
                await client.close()
                guard await client.ensureRunning() else {
                    let diagnostic = await client.recentStderrSummary()
                    continuation.yield(.failed(Self.failureMessage("Failed to restart Codex app-server after resume timed out.", diagnostic: diagnostic)))
                    continuation.finish()
                    return
                }
                resolvedActiveThreadId = nil
                threadResp = await client.call(
                    "thread/start",
                    params: threadParams(request),
                    timeout: Self.threadOpenTimeout
                )
            }
        } else {
            threadResp = await client.call(
                "thread/start",
                params: threadParams(request),
                timeout: Self.threadOpenTimeout
            )
        }

        if let error = CodexRPCClient.errorMessage(from: threadResp) {
            let diagnostic = await client.recentStderrSummary()
            continuation.yield(.failed(Self.failureMessage(error, diagnostic: diagnostic)))
            continuation.finish()
            return
        }

        let resolvedThreadId = Self.sanitizedThreadId(Self.threadId(from: threadResp.value)) ?? resolvedActiveThreadId
        if let resolvedThreadId {
            setThreadId(resolvedThreadId)
            continuation.yield(.output(Self.threadStartedOutput(threadId: resolvedThreadId)))
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
        await client.setExitHandler {
            turnBox.complete(success: false, error: "Codex app-server exited before the turn completed.")
        }

        continuation.yield(.stateChanged(.running))
        continuation.yield(.output(Self.thinkingOutput("Waiting for Codex response.") + "\n"))
        turnBox.startIdleWatchdog(timeout: Self.turnEventIdleTimeout) { [client] in
            await client.close()
        }
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
            await client.setExitHandler(nil)
            turnBox.cancelIdleWatchdog()
            let diagnostic = await client.recentStderrSummary()
            continuation.yield(.failed(Self.failureMessage(error, diagnostic: diagnostic)))
            continuation.finish()
            return
        }

        await turnBox.waitForCompletion()
        await client.setNotificationHandler(nil)
        await client.setExitHandler(nil)
        turnBox.cancelIdleWatchdog()

        let finalState = turnBox.withLock { $0 }
        if let error = finalState.error {
            let diagnostic = await client.recentStderrSummary()
            continuation.yield(.failed(Self.failureMessage(error, diagnostic: diagnostic)))
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
            "approvalPolicy": Self.codexApprovalPolicy(for: request.run.permissionMode),
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

    private static func codexApprovalPolicy(for mode: PermissionMode) -> String {
        switch mode {
        case .readOnly, .autopilot:
            return "never"
        case .askBeforeEdit:
            return "on-request"
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
        case "item/started":
            if let item = params["item"] as? [String: Any] {
                if let itemId = item["id"] as? String,
                   Self.normalizedItemType(item) == "agentMessage" {
                    let phase = item["phase"] as? String ?? "final_answer"
                    state.withLock { state in
                        state.messagePhases[itemId] = phase
                    }
                }
                if let label = Self.commandExecutionLabel(from: item) {
                    state.recordActivity()
                    continuation.yield(.toolCallStarted(label))
                }
            }
        case "item/agentMessage/delta":
            if let delta = params["delta"] as? String, !delta.isEmpty {
                let itemId = params["itemId"] as? String
                let phase = itemId.flatMap { itemId in
                    state.withLock { $0.messagePhases[itemId] }
                } ?? "final_answer"
                state.recordActivity()
                if phase == "final_answer" {
                    state.withLock { state in
                        if let itemId {
                            state.deltaSeenForItem.insert(itemId)
                        }
                        state.didStreamFinalText = true
                    }
                    continuation.yield(.output(delta))
                } else {
                    let output = state.withLock { state -> String in
                        let key = itemId ?? "commentary"
                        if let itemId {
                            state.deltaSeenForItem.insert(itemId)
                            state.commentaryByItem[itemId, default: ""] += delta
                        }
                        let shouldPrefix = state.streamingThinkingItemIds.insert(key).inserted
                        return shouldPrefix ? Self.thinkingOutput(delta) : delta
                    }
                    continuation.yield(.output(output))
                }
            }
        case "item/completed":
            if let item = params["item"] as? [String: Any] {
                Self.handleCompletedItem(item, state: state, continuation: continuation)
            }
        case "rawResponseItem/completed":
            if let item = params["item"] as? [String: Any] {
                Self.handleCompletedRawResponseItem(item, state: state, continuation: continuation)
            }
        case "item/reasoning/textDelta", "item/reasoning/summaryTextDelta":
            if let delta = params["delta"] as? String, !delta.isEmpty {
                let itemId = params["itemId"] as? String ?? params["id"] as? String
                state.recordActivity()
                let output = state.withLock { state -> String in
                    let key = itemId ?? "reasoning"
                    if let itemId {
                        state.deltaSeenForItem.insert(itemId)
                    }
                    let shouldPrefix = state.streamingThinkingItemIds.insert(key).inserted
                    return shouldPrefix ? Self.thinkingOutput(delta) : delta
                }
                continuation.yield(.output(output))
            }
        case "turn/completed", "turn/failed", "turn/cancelled", "turn/interrupted":
            let turn = params["turn"] as? [String: Any]
            let status = turn?["status"] as? String
            let error = turn?["error"] as? [String: Any]
            let errorMessage = error?["message"] as? String ?? error?["code"] as? String
            let success = method == "turn/completed" && (status == nil || status == "completed")
            state.recordActivity()
            state.complete(
                success: success,
                error: success ? nil : errorMessage ?? Self.turnFailureMessage(method: method, status: status)
            )
        default:
            break
        }
    }

    private static func handleCompletedItem(
        _ item: [String: Any],
        state: LockedValue<CodexRPCTurnState>,
        continuation: AsyncThrowingStream<RunnerEvent, Error>.Continuation
    ) {
        let type = normalizedItemType(item)
        switch type {
        case "agentMessage":
            let itemId = item["id"] as? String
            let text = Self.agentMessageText(from: item)
                ?? itemId.flatMap { id in state.withLock { $0.commentaryByItem[id] } }
            if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let phase = item["phase"] as? String
                    ?? itemId.flatMap { itemId in
                        state.withLock { $0.messagePhases[itemId] }
                    }
                let isFinalAnswer = phase == "final_answer" || phase == nil
                let shouldEmit = state.withLock { state -> Bool in
                    if let itemId, state.deltaSeenForItem.contains(itemId) {
                        return false
                    }
                    if isFinalAnswer, itemId == nil, state.didStreamFinalText {
                        return false
                    }
                    if let itemId {
                        state.deltaSeenForItem.insert(itemId)
                    }
                    if isFinalAnswer {
                        state.didStreamFinalText = true
                    }
                    return true
                }
                if shouldEmit {
                    state.recordActivity()
                    continuation.yield(.output(isFinalAnswer ? text : Self.thinkingOutput(text)))
                }
            }
            if let itemId {
                state.withLock { state in
                    state.messagePhases.removeValue(forKey: itemId)
                    state.commentaryByItem.removeValue(forKey: itemId)
                    state.streamingThinkingItemIds.remove(itemId)
                }
            }
        case "reasoning":
            emitReasoningText(from: item, state: state, continuation: continuation)
        case "commandExecution":
            state.recordActivity()
            continuation.yield(.activity(Date()))
        default:
            break
        }
    }

    private static func handleCompletedRawResponseItem(
        _ item: [String: Any],
        state: LockedValue<CodexRPCTurnState>,
        continuation: AsyncThrowingStream<RunnerEvent, Error>.Continuation
    ) {
        if normalizedItemType(item) == "reasoning" {
            emitReasoningText(from: item, state: state, continuation: continuation)
        }
    }

    private static func emitReasoningText(
        from item: [String: Any],
        state: LockedValue<CodexRPCTurnState>,
        continuation: AsyncThrowingStream<RunnerEvent, Error>.Continuation
    ) {
        guard let text = reasoningText(from: item),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        let itemId = item["id"] as? String
        let shouldEmit = state.withLock { state -> Bool in
            guard let itemId else { return true }
            guard !state.deltaSeenForItem.contains(itemId) else { return false }
            state.deltaSeenForItem.insert(itemId)
            return true
        }
        guard shouldEmit else { return }
        state.recordActivity()
        continuation.yield(.output(Self.thinkingOutput(text)))
    }

    static func agentMessageText(from item: [String: Any]) -> String? {
        if let text = trimmedNonEmptyString(item["text"]) {
            return text
        }
        if let content = item["content"] as? [Any] {
            let text = text(fromContent: content)
            if !text.isEmpty {
                return text
            }
        }
        if let message = item["message"] as? [String: Any] {
            return agentMessageText(from: message)
        }
        return nil
    }

    static func reasoningText(from item: [String: Any]) -> String? {
        if let text = trimmedNonEmptyString(item["text"]) {
            return text
        }
        var parts: [String] = []
        if let summary = item["summary"] as? [Any] {
            parts.append(text(fromContent: summary))
        }
        if let content = item["content"] as? [Any] {
            parts.append(text(fromContent: content))
        }
        let text = parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        return text.isEmpty ? nil : text
    }

    static func commandExecutionLabel(from item: [String: Any]) -> String? {
        guard normalizedItemType(item) == "commandExecution" else { return nil }
        return trimmedNonEmptyString(item["command"])
            ?? trimmedNonEmptyString(item["cmd"])
            ?? trimmedNonEmptyString(item["name"])
            ?? "tool"
    }

    static func normalizedItemType(_ item: [String: Any]) -> String {
        let raw = (item["type"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        switch raw {
        case "agent_message":
            return "agentMessage"
        case "command_execution":
            return "commandExecution"
        case "raw_response_item":
            return "rawResponseItem"
        default:
            return raw
        }
    }

    private static func trimmedNonEmptyString(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : text
    }

    private static func text(fromContent content: [Any]) -> String {
        content
            .compactMap { entry -> String? in
                if let text = entry as? String {
                    return text
                }
                guard let dictionary = entry as? [String: Any] else {
                    return nil
                }
                if let text = trimmedNonEmptyString(dictionary["text"]) {
                    return text
                }
                if let content = dictionary["content"] as? [Any] {
                    let nested = text(fromContent: content)
                    return nested.isEmpty ? nil : nested
                }
                return nil
            }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    static func thinkingOutput(_ text: String) -> String {
        text
            .components(separatedBy: .newlines)
            .map { line in
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return line }
                return trimmed.hasPrefix("Thinking:") ? line : "Thinking: \(line)"
            }
            .joined(separator: "\n")
    }

    static func turnFailureMessage(method: String, status: String?) -> String {
        let statusText = status?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        switch method {
        case "turn/failed":
            return statusText.map { "Codex turn failed: \($0)." } ?? "Codex turn failed."
        case "turn/cancelled":
            return statusText.map { "Codex turn was cancelled: \($0)." } ?? "Codex turn was cancelled."
        case "turn/interrupted":
            return statusText.map { "Codex turn was interrupted: \($0)." } ?? "Codex turn was interrupted."
        default:
            return statusText.map { "Codex turn ended with status \($0)." } ?? "Codex turn did not complete."
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

    static func threadStartedOutput(threadId: String) -> String {
        let payload: [String: Any] = [
            "type": "thread.started",
            "thread_id": threadId
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"type":"thread.started","thread_id":"# + jsonStringLiteral(threadId) + "}\n"
        }
        return text + "\n"
    }

    static func sanitizedThreadId(_ value: String?) -> String? {
        guard var text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            return nil
        }
        for _ in 0..<3 {
            if text.hasPrefix("\\\""), text.hasSuffix("\\\""), text.count >= 4 {
                text = String(text.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }
            guard text.hasPrefix("\""), text.hasSuffix("\"") else {
                break
            }
            if let data = text.data(using: .utf8),
               let decoded = try? JSONSerialization.jsonObject(with: data) as? String {
                text = decoded.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                text = String(text.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return text.isEmpty ? nil : text
    }

    private static func isTimeoutResponse(_ response: CodexRPCResponse, method: String) -> Bool {
        guard let message = CodexRPCClient.errorMessage(from: response) else { return false }
        return message.contains("RPC call '\(method)' timed out")
    }

    static func failureMessage(_ message: String, diagnostic: String?) -> String {
        let cleanMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDiagnostic = diagnostic?
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        guard let cleanDiagnostic, !cleanDiagnostic.isEmpty else {
            return cleanMessage
        }
        return "\(cleanMessage)\nCodex app-server diagnostics:\n\(cleanDiagnostic)"
    }

    private static func jsonStringLiteral(_ value: String) -> String {
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value]),
              let text = String(data: data, encoding: .utf8),
              text.hasPrefix("["),
              text.hasSuffix("]") else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return String(text.dropFirst().dropLast())
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

private struct CodexMCPRegistrationPlan: Sendable {
    var servers: [CodexMCPServer] = []

    static func prepare(workspacePath: String, baseEnvironment: inout [String: String]) -> CodexMCPRegistrationPlan {
        var serversByName: [String: CodexMCPServer] = [:]
        for server in globalServers(environment: baseEnvironment) {
            serversByName[server.name] = server
        }
        for server in workspaceServers(workspacePath: workspacePath, environment: baseEnvironment) {
            if server.disabled {
                serversByName.removeValue(forKey: server.name)
            } else {
                serversByName[server.name] = server
            }
        }

        var servers: [CodexMCPServer] = []
        for var server in serversByName.values.sorted(by: { $0.name < $1.name }) {
            if let token = server.bearerToken {
                let envName = "PIKICLAW_MCP_\(sanitizeEnvName(server.name))_TOKEN"
                baseEnvironment[envName] = token
                server.bearerTokenEnvName = envName
            }
            servers.append(server)
        }
        return CodexMCPRegistrationPlan(servers: servers)
    }

    private static func globalServers(environment: [String: String]) -> [CodexMCPServer] {
        let configPath = environment["PIKICLAW_CONFIG"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".pikiclaw", isDirectory: true)
                .appendingPathComponent("setting.json", isDirectory: false)
                .path
        guard let root = jsonObject(at: configPath),
              let extensions = root["extensions"] as? [String: Any],
              let mcp = extensions["mcp"] as? [String: Any] else {
            return []
        }
        return mcp.compactMap { name, rawConfig in
            guard let config = rawConfig as? [String: Any],
                  !boolValue(config["disabled"]),
                  config["enabled"].map(boolValue) != false else {
                return nil
            }
            return server(name: visibleServerName(name), config: config)
        }
    }

    private static func workspaceServers(workspacePath: String, environment: [String: String]) -> [CodexMCPServer] {
        let configPath = URL(fileURLWithPath: workspacePath, isDirectory: true)
            .appendingPathComponent(".mcp.json", isDirectory: false)
            .path
        guard let root = jsonObject(at: configPath) else { return [] }
        let servers = (root["mcpServers"] as? [String: Any]) ?? root
        return servers.compactMap { name, rawConfig in
            guard let config = rawConfig as? [String: Any] else { return nil }
            if boolValue(config["disabled"]) {
                return CodexMCPServer(name: visibleServerName(name), disabled: true)
            }
            return server(name: visibleServerName(name), config: config)
        }
    }

    private static func server(name: String, config: [String: Any]) -> CodexMCPServer? {
        if let url = stringValue(config["url"]), !url.isEmpty {
            let headers = config["headers"] as? [String: Any]
            return CodexMCPServer(
                name: name,
                transport: .http(url: url),
                bearerToken: bearerToken(from: headers)
            )
        }
        guard let command = stringValue(config["command"]), !command.isEmpty else { return nil }
        let args = (config["args"] as? [Any])?.compactMap(stringValue) ?? []
        let env = (config["env"] as? [String: Any])?.compactMapValues(stringValue) ?? [:]
        return CodexMCPServer(name: name, transport: .stdio(command: command, args: args, env: env))
    }

    private static func jsonObject(at path: String) -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: path),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            return nil
        }
        return dictionary
    }

    private static func visibleServerName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        if trimmed.range(of: #"^pikiclaw(?:[-_]|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return trimmed
        }
        return "pikiclaw-\(trimmed)"
    }

    private static func bearerToken(from headers: [String: Any]?) -> String? {
        guard let entry = headers?.first(where: { $0.key.lowercased() == "authorization" }),
              let value = stringValue(entry.value)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        if value.lowercased().hasPrefix("bearer ") {
            return String(value.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        return value
    }

    private static func sanitizeEnvName(_ name: String) -> String {
        var output = ""
        for scalar in name.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) || scalar == "_" {
                output.unicodeScalars.append(Character(String(scalar).uppercased()).unicodeScalars.first!)
            } else {
                output.append("_")
            }
        }
        if output.first?.isNumber == true {
            output = "_\(output)"
        }
        return output.isEmpty ? "MCP" : output
    }

    private static func stringValue(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            return value
        case let value as NSNumber:
            return value.stringValue
        default:
            return nil
        }
    }

    private static func boolValue(_ value: Any?) -> Bool {
        switch value {
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value.boolValue
        case let value as String:
            return ["true", "yes", "1"].contains(value.lowercased())
        default:
            return false
        }
    }
}

private struct CodexMCPServer: Sendable {
    enum Transport: Sendable {
        case http(url: String)
        case stdio(command: String, args: [String], env: [String: String])
    }

    var name: String
    var transport: Transport = .stdio(command: "", args: [], env: [:])
    var bearerToken: String?
    var bearerTokenEnvName: String?
    var disabled = false
}

private final actor CodexMCPRegistration {
    private let plan: CodexMCPRegistrationPlan
    private let executablePath: String
    private let environment: [String: String]
    private var registeredNames: [String] = []

    init(plan: CodexMCPRegistrationPlan, executablePath: String, environment: [String: String]) {
        self.plan = plan
        self.executablePath = executablePath
        self.environment = environment
    }

    func register() {
        for server in plan.servers {
            guard !server.disabled else { continue }
            let args = codexMcpAddArguments(for: server)
            guard !args.isEmpty else { continue }
            if runCodex(args) || (runCodex(["mcp", "remove", server.name]) && runCodex(args)) {
                registeredNames.append(server.name)
            }
        }
    }

    func cleanup() {
        for name in registeredNames.reversed() {
            _ = runCodex(["mcp", "remove", name])
        }
        registeredNames.removeAll()
    }

    private func codexMcpAddArguments(for server: CodexMCPServer) -> [String] {
        var args = ["mcp", "add"]
        switch server.transport {
        case .http(let url):
            args.append(contentsOf: ["--url", url])
            if let bearerTokenEnvName = server.bearerTokenEnvName {
                args.append(contentsOf: ["--bearer-token-env-var", bearerTokenEnvName])
            }
            args.append(server.name)
        case .stdio(let command, let commandArgs, let env):
            guard !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
            for key in env.keys.sorted() {
                if let value = env[key] {
                    args.append(contentsOf: ["--env", "\(key)=\(value)"])
                }
            }
            args.append(contentsOf: [server.name, "--", command])
            args.append(contentsOf: commandArgs)
        }
        return args
    }

    private func runCodex(_ arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments
        process.environment = environment
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }
}

private struct CodexRPCResponse: @unchecked Sendable {
    var value: [String: Any]
}

private struct CodexRPCTurnState {
    var completed = false
    var error: String?
    var didStreamFinalText = false
    var lastActivityAt = Date()
    var messagePhases: [String: String] = [:]
    var deltaSeenForItem: Set<String> = []
    var commentaryByItem: [String: String] = [:]
    var streamingThinkingItemIds: Set<String> = []
    fileprivate var continuation: CheckedContinuation<Void, Never>?
    fileprivate var idleWatchdog: Task<Void, Never>?

    mutating func finish(success: Bool, error: String?) {
        guard !completed, self.error == nil else { return }
        completed = success
        self.error = error
        idleWatchdog?.cancel()
        idleWatchdog = nil
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

    func recordActivity() {
        withLock { state in
            state.lastActivityAt = Date()
        }
    }

    func startIdleWatchdog(timeout: TimeInterval, onTimeout: @escaping @Sendable () async -> Void) {
        withLock { state in
            state.idleWatchdog?.cancel()
            state.lastActivityAt = Date()
            state.idleWatchdog = Task {
                while !Task.isCancelled {
                    let delay = UInt64(max(timeout, 1) * 1_000_000_000)
                    try? await Task.sleep(nanoseconds: delay)
                    guard !Task.isCancelled else { return }
                    let shouldFail = self.withLock { state -> Bool in
                        guard !state.completed, state.error == nil else { return false }
                        return Date().timeIntervalSince(state.lastActivityAt) >= timeout
                    }
                    if shouldFail {
                        self.complete(success: false, error: "No Codex turn events for \(Int(timeout / 60)) minutes. The model request likely stalled before producing more agent output.")
                        await onTimeout()
                        return
                    }
                }
            }
        }
    }

    func cancelIdleWatchdog() {
        withLock { state in
            state.idleWatchdog?.cancel()
            state.idleWatchdog = nil
        }
    }

    func waitForCompletion() async {
        let didComplete = withLock { $0.completed || $0.error != nil }
        if didComplete { return }

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
}

private final actor CodexRPCClient {
    private let executablePath: String
    private let environment: [String: String]
    private var process: Process?
    private var stdin: Pipe?
    private var stdout: Pipe?
    private var stderr: Pipe?
    private var buffer = ""
    private var stderrBuffer = ""
    private var recentStderrLines: [String] = []
    private var nextId = 1
    private var pending: [Int: CheckedContinuation<CodexRPCResponse, Never>] = [:]
    private var notificationHandler: (@Sendable (String, [String: Any]) -> Void)?
    private var exitHandler: (@Sendable () -> Void)?
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

    func setExitHandler(_ handler: (@Sendable () -> Void)?) {
        exitHandler = handler
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
        exitHandler = nil
    }

    func recentStderrSummary(limit: Int = 6) -> String? {
        let lines = recentStderrLines
            .suffix(max(limit, 1))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else { return nil }
        return lines.joined(separator: "\n")
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
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { await self?.handleStderr(data) }
        }
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

    private func handleStderr(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        stderrBuffer += text
        let lines = stderrBuffer.components(separatedBy: "\n")
        stderrBuffer = lines.last ?? ""
        for line in lines.dropLast() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            recentStderrLines.append(trimmed)
        }
        if recentStderrLines.count > 24 {
            recentStderrLines.removeFirst(recentStderrLines.count - 24)
        }
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
        exitHandler?()
        notificationHandler = nil
        exitHandler = nil
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
