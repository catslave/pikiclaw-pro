import Foundation
import PikiclawCore

struct JiraTicketFetchResult {
    let tickets: [JiraTicket]
    let source: String
}

enum JiraTicketFetcher {
    private static let defaultJiraMCPServiceURL = "http://xia01-i01-dkr01.int.rclabenv.com:8000/mcp/"
    private static let defaultJiraAssignee = "Michael Yang"
    private static let jiraSyncFields = "summary,description,issuetype,status,assignee,reporter,fixVersions,duedate,priority,labels,updated,issuelinks,customfield_10652"

    static func fetch(scope: JiraTicketSyncScope) async throws -> JiraTicketFetchResult {
        let environment = jiraEnvironment()
        let baseURL = firstNonEmpty([
            environment["PIKICLAW_JIRA_BASE_URL"],
            environment["JIRA_BASE_URL"],
            environment["RC_JIRA_BASE_URL"]
        ])

        if let path = environment["PIKICLAW_JIRA_TICKETS_FILE"], !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let url = URL(fileURLWithPath: expandedPath(path))
            let data = try Data(contentsOf: url)
            return JiraTicketFetchResult(
                tickets: try JiraTicketPayloadParser.decodeTickets(from: data, baseURL: baseURL),
                source: "file"
            )
        }

        if let command = environment["PIKICLAW_JIRA_SYNC_COMMAND"], !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let data = try await run(command: command, scope: scope, environment: environment)
            return JiraTicketFetchResult(
                tickets: try JiraTicketPayloadParser.decodeTickets(from: data, baseURL: baseURL),
                source: "command"
            )
        }

        if mcpConfiguration(environment: environment) != nil {
            return try await fetchFromMCP(scope: scope, environment: environment, baseURL: baseURL)
        }

        if let baseURL, !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return try await fetchFromREST(baseURL: baseURL, scope: scope, environment: environment)
        }

        throw JiraTicketFetchError.missingConfiguration
    }

    static func jql(for scope: JiraTicketSyncScope, environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let override = environment["PIKICLAW_JIRA_JQL"], !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return override
        }
        let assignee = assigneeClause(environment: environment)
        switch scope {
        case .mine:
            return "\(assignee) AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC"
        case .currentSprint:
            return "\(assignee) AND sprint in openSprints() AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC"
        case .review:
            return "\(assignee) AND status in (Review, \"In Review\", QA, \"Ready for QA\") ORDER BY updated DESC"
        case .blocked:
            return "\(assignee) AND status in (Blocked, \"In Blocked\") ORDER BY updated DESC"
        }
    }

    static func jiraEnvironment(base: [String: String] = ProcessInfo.processInfo.environment) -> [String: String] {
        guard mcpConfiguration(environment: base) == nil,
              firstNonEmpty([
                  base["PIKICLAW_JIRA_BASE_URL"],
                  base["JIRA_BASE_URL"],
                  base["RC_JIRA_BASE_URL"],
                  base["PIKICLAW_JIRA_TICKETS_FILE"],
                  base["PIKICLAW_JIRA_SYNC_COMMAND"]
              ]) == nil else {
            return base
        }

        var environment = base
        for (key, value) in shellJiraEnvironment() where environment[key] == nil {
            environment[key] = value
        }
        return environment
    }

    static func mcpConfiguration(environment: [String: String]) -> JiraMCPConfiguration? {
        guard let jiraToken = firstNonEmpty([environment["RC_JIRA_READ_TOKEN"]]) else { return nil }
        return JiraMCPConfiguration(
            url: firstNonEmpty([environment["PIKICLAW_JIRA_MCP_SERVICE_URL"]]) ?? defaultJiraMCPServiceURL,
            headers: [
                "jira-read-token": jiraToken,
                "confluence-read-token": firstNonEmpty([environment["RC_CONFLUENCE_READ_TOKEN"]])
            ].compactMapValues { $0 }
        )
    }

    private static func fetchFromMCP(
        scope: JiraTicketSyncScope,
        environment: [String: String],
        baseURL: String?
    ) async throws -> JiraTicketFetchResult {
        guard let config = mcpConfiguration(environment: environment) else {
            throw JiraTicketFetchError.missingConfiguration
        }
        let sessionId = try await initializeMCPSession(config: config)
        _ = try? await listMCPTools(config: config, sessionId: sessionId)

        let queries = [
            jql(for: scope, environment: environment),
            fallbackJQL(for: scope, environment: environment)
        ].reduce(into: [String]()) { values, value in
            if !values.contains(value) { values.append(value) }
        }

        var errors: [String] = []
        for query in queries {
            do {
                let result = try await callMCPTool(
                    config: config,
                    sessionId: sessionId,
                    name: "jira_search",
                    arguments: [
                        "jql": query,
                        "fields": jiraSyncFields,
                        "limit": 50,
                        "start_at": 0
                    ]
                )
                let data = try jiraPayloadData(fromMCPResult: result)
                let tickets = try JiraTicketPayloadParser.decodeTickets(from: data, baseURL: baseURL)
                guard !tickets.isEmpty else {
                    errors.append("\(query): returned 0 tickets")
                    continue
                }
                return JiraTicketFetchResult(
                    tickets: tickets,
                    source: "mcp: \(query)"
                )
            } catch {
                errors.append("\(query): \(error.localizedDescription)")
            }
        }

        throw JiraTicketFetchError.mcpFailed(errors.joined(separator: " | "))
    }

    private static func fetchFromREST(
        baseURL: String,
        scope: JiraTicketSyncScope,
        environment: [String: String]
    ) async throws -> JiraTicketFetchResult {
        let token = firstNonEmpty([
            environment["PIKICLAW_JIRA_API_TOKEN"],
            environment["JIRA_API_TOKEN"],
            environment["PIKICLAW_JIRA_TOKEN"],
            environment["JIRA_TOKEN"]
        ])
        guard let token, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw JiraTicketFetchError.missingToken
        }

        let version = environment["PIKICLAW_JIRA_API_VERSION"] ?? "2"
        let trimmedBase = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(trimmedBase)/rest/api/\(version)/search") else {
            throw JiraTicketFetchError.invalidBaseURL(baseURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(authorizationHeader(token: token, environment: environment), forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "jql": jql(for: scope, environment: environment),
            "maxResults": 50,
            "fields": ["summary", "description", "status", "assignee", "priority", "issuetype", "updated"]
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let detail = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw JiraTicketFetchError.httpStatus(http.statusCode, detail)
        }

        return JiraTicketFetchResult(
            tickets: try JiraTicketPayloadParser.decodeTickets(from: data, baseURL: trimmedBase),
            source: "rest"
        )
    }

    private static func authorizationHeader(token: String, environment: [String: String]) -> String {
        let email = firstNonEmpty([environment["PIKICLAW_JIRA_EMAIL"], environment["JIRA_EMAIL"], environment["RC_JIRA_EMAIL"]])
        guard let email, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "Bearer \(token)"
        }
        let credential = "\(email):\(token)"
        let encoded = Data(credential.utf8).base64EncodedString()
        return "Basic \(encoded)"
    }

    private static func fallbackJQL(for scope: JiraTicketSyncScope, environment: [String: String]) -> String {
        if let override = firstNonEmpty([environment["PIKICLAW_JIRA_FALLBACK_JQL"]]) {
            return override
        }
        switch scope {
        case .currentSprint:
            return "\(assigneeClause(environment: environment)) AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC"
        default:
            return jql(for: scope, environment: environment)
        }
    }

    private static func assigneeClause(environment: [String: String]) -> String {
        let assignee = firstNonEmpty([
            environment["PIKICLAW_JIRA_ASSIGNEE"],
            environment["RC_JIRA_ASSIGNEE"]
        ]) ?? defaultJiraAssignee
        return "assignee = \"\(assignee.replacingOccurrences(of: "\"", with: "\\\""))\""
    }

    private static func initializeMCPSession(config: JiraMCPConfiguration) async throws -> String? {
        let response = try await postMCPJSON(config: config, sessionId: nil, payload: [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": [
                "protocolVersion": "2025-03-26",
                "capabilities": [:],
                "clientInfo": [
                    "name": "pikiclaw-mac-native",
                    "version": "0.0.0"
                ]
            ]
        ])
        _ = try await postMCPJSON(config: config, sessionId: response.sessionId, payload: [
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": [:]
        ])
        return response.sessionId
    }

    private static func listMCPTools(config: JiraMCPConfiguration, sessionId: String?) async throws -> [String] {
        let response = try await postMCPJSON(config: config, sessionId: sessionId, payload: [
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": [:]
        ])
        guard let object = response.payload as? [String: Any],
              let result = object["result"] as? [String: Any],
              let tools = result["tools"] as? [[String: Any]] else {
            return []
        }
        return tools.compactMap { string($0["name"]) }
    }

    private static func callMCPTool(
        config: JiraMCPConfiguration,
        sessionId: String?,
        name: String,
        arguments: [String: Any]
    ) async throws -> Any {
        let response = try await postMCPJSON(config: config, sessionId: sessionId, payload: [
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": [
                "name": name,
                "arguments": arguments
            ]
        ])
        guard let object = response.payload as? [String: Any] else {
            throw JiraTicketFetchError.mcpFailed("Empty MCP response")
        }
        if let error = object["error"] {
            throw JiraTicketFetchError.mcpFailed(String(describing: error))
        }
        return object["result"] ?? [:]
    }

    private static func postMCPJSON(config: JiraMCPConfiguration, sessionId: String?, payload: [String: Any]) async throws -> MCPResponse {
        guard let url = URL(string: config.url) else {
            throw JiraTicketFetchError.invalidBaseURL(config.url)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        for (key, value) in config.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let sessionId {
            request.setValue(sessionId, forHTTPHeaderField: "Mcp-Session-Id")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let detail = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw JiraTicketFetchError.httpStatus(http.statusCode, detail)
        }
        let sessionHeader = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Mcp-Session-Id")
        let json = try parseMCPJSON(from: data)
        return MCPResponse(payload: json, sessionId: sessionHeader)
    }

    private static func parseMCPJSON(from data: Data) throws -> Any {
        let body = String(data: data, encoding: .utf8) ?? ""
        if body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return [:]
        }
        let dataLines = body
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .compactMap { line -> String? in
                guard line.hasPrefix("data:") else { return nil }
                return String(line.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        if !dataLines.isEmpty {
            let payload = dataLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if let eventData = payload.data(using: .utf8), !payload.isEmpty {
                return try JSONSerialization.jsonObject(with: eventData)
            }
        }
        do {
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            let prefix = body.prefix(500)
            throw JiraTicketFetchError.mcpFailed("Invalid MCP JSON response: \(prefix)")
        }
    }

    static func jiraPayloadData(fromMCPResult result: Any) throws -> Data {
        if let object = result as? [String: Any],
           let content = object["content"] as? [[String: Any]],
           let text = content.compactMap({ string($0["text"]) }).first(where: { !$0.isEmpty }) {
            return try normalizedJiraPayloadData(from: text)
        }
        return try normalizedJiraPayloadData(from: result)
    }

    private static func normalizedJiraPayloadData(from text: String) throws -> Data {
        guard let data = text.data(using: .utf8) else {
            throw JiraTicketFetchError.mcpFailed("MCP returned non-UTF8 text")
        }
        let json = try JSONSerialization.jsonObject(with: data)
        return try normalizedJiraPayloadData(from: json)
    }

    private static func normalizedJiraPayloadData(from json: Any) throws -> Data {
        let payload: Any
        if let issues = json as? [[String: Any]] {
            payload = ["issues": issues]
        } else if let object = json as? [String: Any],
                  object["issues"] == nil,
                  let nested = object["result"] as? [String: Any],
                  let issues = nested["issues"] {
            payload = ["issues": issues]
        } else {
            payload = json
        }
        return try JSONSerialization.data(withJSONObject: payload)
    }

    private static func run(command: String, scope: JiraTicketSyncScope, environment: [String: String]) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            var nextEnvironment = environment
            nextEnvironment["PIKICLAW_JIRA_JQL"] = jql(for: scope, environment: environment)
            nextEnvironment["PIKICLAW_JIRA_SYNC_SCOPE"] = scope.rawValue

            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-lc", command]
            process.environment = nextEnvironment

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            try process.run()
            let output = stdout.fileHandleForReading.readDataToEndOfFile()
            let error = stderr.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else {
                let message = String(data: error, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                throw JiraTicketFetchError.commandFailed(Int(process.terminationStatus), message)
            }
            return output
        }.value
    }

    private static func shellJiraEnvironment() -> [String: String] {
        let names = [
            "RC_JIRA_READ_TOKEN",
            "RC_CONFLUENCE_READ_TOKEN",
            "PIKICLAW_JIRA_MCP_SERVICE_URL",
            "PIKICLAW_JIRA_BASE_URL",
            "JIRA_BASE_URL",
            "RC_JIRA_BASE_URL",
            "PIKICLAW_JIRA_API_TOKEN",
            "JIRA_API_TOKEN",
            "PIKICLAW_JIRA_TOKEN",
            "JIRA_TOKEN",
            "PIKICLAW_JIRA_EMAIL",
            "JIRA_EMAIL",
            "RC_JIRA_EMAIL",
            "PIKICLAW_JIRA_JQL",
            "PIKICLAW_JIRA_FALLBACK_JQL",
            "PIKICLAW_JIRA_TICKETS_FILE",
            "PIKICLAW_JIRA_SYNC_COMMAND"
        ]
        let script = names.map { "printf '%s=%s\\n' '\($0)' \"${\($0)-}\"" }.joined(separator: "; ")

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-ilc", script]
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return [:]
        }
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let output = String(data: data, encoding: .utf8) else {
            return [:]
        }

        var environment: [String: String] = [:]
        let allowedNames = Set(names)
        for line in output.split(separator: "\n", omittingEmptySubsequences: false) {
            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator])
            let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if allowedNames.contains(key), !value.isEmpty {
                environment[key] = value
            }
        }
        return environment
    }

    private static func expandedPath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("~/") else { return trimmed }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(String(trimmed.dropFirst(2)))
            .path
    }

    private static func firstNonEmpty(_ values: [String?]) -> String? {
        for value in values {
            if let found = string(value) {
                return found
            }
        }
        return nil
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        if let value = value as? CustomStringConvertible {
            return value.description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        return nil
    }
}

enum JiraTicketFetchError: LocalizedError {
    case missingConfiguration
    case missingToken
    case invalidBaseURL(String)
    case httpStatus(Int, String?)
    case commandFailed(Int, String?)
    case mcpFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingConfiguration:
            return "Set RC_JIRA_READ_TOKEN, PIKICLAW_JIRA_BASE_URL plus a Jira token, PIKICLAW_JIRA_SYNC_COMMAND, or PIKICLAW_JIRA_TICKETS_FILE."
        case .missingToken:
            return "Set PIKICLAW_JIRA_API_TOKEN or JIRA_API_TOKEN for Jira REST sync."
        case .invalidBaseURL(let value):
            return "Invalid Jira base URL: \(value)"
        case .httpStatus(let code, let detail):
            return "Jira REST returned HTTP \(code)\(detail.map { ": \($0)" } ?? "")"
        case .commandFailed(let code, let message):
            return "Jira sync command exited \(code)\(message.map { ": \($0)" } ?? "")"
        case .mcpFailed(let message):
            return "Jira MCP sync failed: \(message)"
        }
    }
}

struct JiraMCPConfiguration: Equatable {
    var url: String
    var headers: [String: String]
}

private struct MCPResponse {
    var payload: Any
    var sessionId: String?
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
