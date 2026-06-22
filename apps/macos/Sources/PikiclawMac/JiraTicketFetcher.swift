import Foundation
import PikiclawCore

struct JiraTicketFetchResult {
    let tickets: [JiraTicket]
    let source: String
}

enum JiraWriteBackReadinessState: String, Equatable, Sendable {
    case ready
    case missingConfiguration
    case invalidBaseURL
}

struct JiraWriteBackReadiness: Equatable, Sendable {
    var state: JiraWriteBackReadinessState
    var title: String
    var detail: String
    var missingItems: [String]

    var isReady: Bool {
        state == .ready
    }
}

struct JiraWriteBackSetupGuide: Equatable, Sendable {
    var envFilePath: String
    var envDirectoryPath: String
    var revealDirectoryPath: String
    var envDirectoryExists: Bool
    var envFileExists: Bool
    var summary: String
    var template: String
    var missingItems: [String]
}

enum JiraTicketFetcher {
    private static let defaultJiraMCPServiceURL = "http://xia01-i01-dkr01.int.rclabenv.com:8000/mcp/"
    private static let defaultJiraAssignee = "Michael Yang"
    private static let jiraSkillRelativePath = ".pikiclaw/skills/jira/SKILL.md"
    private static let defaultJiraEnvRelativePath = ".pikiclaw/local/jira.env"
    private static let jiraSyncFields = "summary,description,issuetype,status,assignee,reporter,fixVersions,duedate,priority,labels,updated,issuelinks,customfield_10652"
    private static let jiraEnvironmentNames = [
        "RC_JIRA_READ_TOKEN",
        "RC_CONFLUENCE_READ_TOKEN",
        "PIKICLAW_JIRA_MCP_SERVICE_URL",
        "PIKICLAW_JIRA_BASE_URL",
        "JIRA_BASE_URL",
        "RC_JIRA_BASE_URL",
        "PIKICLAW_JIRA_API_VERSION",
        "PIKICLAW_JIRA_API_TOKEN",
        "JIRA_API_TOKEN",
        "PIKICLAW_JIRA_TOKEN",
        "JIRA_TOKEN",
        "PIKICLAW_JIRA_WRITE_TOKEN",
        "JIRA_WRITE_TOKEN",
        "PIKICLAW_JIRA_WRITE_EMAIL",
        "JIRA_WRITE_EMAIL",
        "PIKICLAW_JIRA_EMAIL",
        "JIRA_EMAIL",
        "RC_JIRA_EMAIL",
        "PIKICLAW_JIRA_ASSIGNEE",
        "RC_JIRA_ASSIGNEE",
        "PIKICLAW_JIRA_JQL",
        "PIKICLAW_JIRA_FALLBACK_JQL",
        "PIKICLAW_JIRA_TICKETS_FILE",
        "PIKICLAW_JIRA_SYNC_COMMAND"
    ]
    private static let jiraSkillConfigurationNames = [
        "RC_JIRA_READ_TOKEN",
        "RC_CONFLUENCE_READ_TOKEN",
        "PIKICLAW_JIRA_ENV_FILE",
        "PIKICLAW_JIRA_MCP_SERVICE_URL",
        "PIKICLAW_JIRA_ASSIGNEE",
        "RC_JIRA_ASSIGNEE",
        "PIKICLAW_JIRA_JQL",
        "PIKICLAW_JIRA_FALLBACK_JQL"
    ]

    static func fetch(scope: JiraTicketSyncScope, workspacePath: String? = nil) async throws -> JiraTicketFetchResult {
        let environment = jiraEnvironment(workspacePath: workspacePath)
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

    static func postComment(issueKey: String, comment: String, workspacePath: String? = nil) async throws {
        let environment = jiraEnvironment(workspacePath: workspacePath)
        let request = try jiraCommentRequest(issueKey: issueKey, comment: comment, environment: environment)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let detail = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw JiraTicketFetchError.httpStatus(http.statusCode, detail)
        }
    }

    static func writeBackReadiness(workspacePath: String? = nil, loadShellEnvironment: Bool = false) -> JiraWriteBackReadiness {
        writeBackReadiness(environment: jiraEnvironment(
            workspacePath: workspacePath,
            loadShellEnvironment: loadShellEnvironment
        ))
    }

    static func writeBackReadiness(environment: [String: String]) -> JiraWriteBackReadiness {
        let baseURL = Self.jiraBaseURL(environment: environment)
        let token = Self.jiraWriteBackToken(environment: environment)
        var missing: [String] = []
        if baseURL == nil {
            missing.append("Jira base URL")
        }
        if token == nil {
            missing.append("write-capable token")
        }
        if !missing.isEmpty {
            return JiraWriteBackReadiness(
                state: .missingConfiguration,
                title: "Write-back setup needed",
                detail: "Configure \(missing.joined(separator: " and ")) before posting a Jira update.",
                missingItems: missing
            )
        }

        guard let baseURL, Self.jiraBaseURLIsValid(baseURL) else {
            return JiraWriteBackReadiness(
                state: .invalidBaseURL,
                title: "Write-back URL invalid",
                detail: "Check PIKICLAW_JIRA_BASE_URL before posting a Jira update.",
                missingItems: []
            )
        }

        return JiraWriteBackReadiness(
            state: .ready,
            title: "Write-back ready",
            detail: "Jira base URL and write-capable token are configured.",
            missingItems: []
        )
    }

    static func writeBackSetupGuide(
        workspacePath: String?,
        readiness: JiraWriteBackReadiness? = nil
    ) -> JiraWriteBackSetupGuide {
        let resolvedReadiness = readiness ?? writeBackReadiness(workspacePath: workspacePath, loadShellEnvironment: false)
        let envFilePath = jiraEnvironmentFilePath(workspacePath: workspacePath)
        let envURL = URL(fileURLWithPath: envFilePath)
        let envDirectoryPath = envURL.deletingLastPathComponent().path
        let envFileExists = fileExists(atPath: envFilePath, expectingDirectory: false)
        let envDirectoryExists = fileExists(atPath: envDirectoryPath, expectingDirectory: true)
        let revealDirectoryPath = existingDirectoryPath(for: envDirectoryPath)
        let missing = resolvedReadiness.missingItems
        let missingText = missing.isEmpty ? "All write-back keys are configured." : "Missing: \(missing.joined(separator: ", "))."
        let template = """
        # Pikiclaw Jira write-back settings. Keep this file private and out of git.
        PIKICLAW_JIRA_BASE_URL=https://jira.example.com
        PIKICLAW_JIRA_WRITE_TOKEN=
        PIKICLAW_JIRA_WRITE_EMAIL=
        # Optional:
        PIKICLAW_JIRA_API_VERSION=3
        """
        return JiraWriteBackSetupGuide(
            envFilePath: envFilePath,
            envDirectoryPath: envDirectoryPath,
            revealDirectoryPath: revealDirectoryPath,
            envDirectoryExists: envDirectoryExists,
            envFileExists: envFileExists,
            summary: "\(missingText) Store secrets only in this private env file or your shell.",
            template: template,
            missingItems: missing
        )
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

    static func jiraCommentRequest(issueKey: String, comment: String, environment: [String: String]) throws -> URLRequest {
        let trimmedIssueKey = issueKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedIssueKey.isEmpty else {
            throw JiraTicketFetchError.mcpFailed("Jira issue key is empty")
        }
        let trimmedComment = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedComment.isEmpty else {
            throw JiraTicketFetchError.mcpFailed("Jira comment is empty")
        }
        guard let baseURL = jiraBaseURL(environment: environment) else {
            throw JiraTicketFetchError.missingConfiguration
        }
        let token = jiraWriteBackToken(environment: environment)
        guard let token, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw JiraTicketFetchError.missingToken
        }

        let version = environment["PIKICLAW_JIRA_API_VERSION"] ?? "2"
        let trimmedBase = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let encodedIssueKey = trimmedIssueKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "\(trimmedBase)/rest/api/\(version)/issue/\(encodedIssueKey)/comment") else {
            throw JiraTicketFetchError.invalidBaseURL(baseURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(authorizationHeader(token: token, environment: environment, writeBack: true), forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["body": trimmedComment])
        return request
    }

    static func jiraEnvironment(
        base: [String: String] = ProcessInfo.processInfo.environment,
        workspacePath: String? = nil,
        loadShellEnvironment: Bool = true
    ) -> [String: String] {
        var environment = base
        for (key, value) in skillJiraEnvironment(workspacePath: workspacePath) {
            environment[key] = value
        }

        guard mcpConfiguration(environment: environment) == nil,
              firstNonEmpty([
                  environment["PIKICLAW_JIRA_BASE_URL"],
                  environment["JIRA_BASE_URL"],
                  environment["RC_JIRA_BASE_URL"],
                  environment["PIKICLAW_JIRA_TICKETS_FILE"],
                  environment["PIKICLAW_JIRA_SYNC_COMMAND"]
              ]) == nil else {
            return environment
        }

        guard loadShellEnvironment else { return environment }

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

    private static func authorizationHeader(token: String, environment: [String: String], writeBack: Bool = false) -> String {
        let writeEmail = writeBack ? firstNonEmpty([environment["PIKICLAW_JIRA_WRITE_EMAIL"], environment["JIRA_WRITE_EMAIL"]]) : nil
        let email = writeEmail ?? firstNonEmpty([environment["PIKICLAW_JIRA_EMAIL"], environment["JIRA_EMAIL"], environment["RC_JIRA_EMAIL"]])
        guard let email, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "Bearer \(token)"
        }
        let credential = "\(email):\(token)"
        let encoded = Data(credential.utf8).base64EncodedString()
        return "Basic \(encoded)"
    }

    private static func jiraBaseURL(environment: [String: String]) -> String? {
        firstNonEmpty([
            environment["PIKICLAW_JIRA_BASE_URL"],
            environment["JIRA_BASE_URL"],
            environment["RC_JIRA_BASE_URL"]
        ])
    }

    private static func jiraWriteBackToken(environment: [String: String]) -> String? {
        firstNonEmpty([
            environment["PIKICLAW_JIRA_WRITE_TOKEN"],
            environment["JIRA_WRITE_TOKEN"],
            environment["PIKICLAW_JIRA_API_TOKEN"],
            environment["JIRA_API_TOKEN"],
            environment["PIKICLAW_JIRA_TOKEN"],
            environment["JIRA_TOKEN"]
        ])
    }

    private static func jiraBaseURLIsValid(_ baseURL: String) -> Bool {
        let trimmedBase = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmedBase),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host?.isEmpty == false else {
            return false
        }
        return true
    }

    private static func fileExists(atPath path: String, expectingDirectory: Bool) -> Bool {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
            return false
        }
        return isDirectory.boolValue == expectingDirectory
    }

    private static func existingDirectoryPath(for path: String) -> String {
        var url = URL(fileURLWithPath: path, isDirectory: true)
        while url.path != "/" {
            if fileExists(atPath: url.path, expectingDirectory: true) {
                return url.path
            }
            url.deleteLastPathComponent()
        }
        return "/"
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
        let names = jiraEnvironmentNames
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

    static func skillJiraEnvironment(workspacePath: String?) -> [String: String] {
        guard let workspacePath = workspacePath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !workspacePath.isEmpty else {
            return [:]
        }
        let workspaceURL = URL(fileURLWithPath: expandedPath(workspacePath), isDirectory: true)
        let skillURL = workspaceURL.appendingPathComponent(jiraSkillRelativePath)
        var environment = skillJiraConfiguration(from: skillURL)

        let envPath = firstNonEmpty([environment["PIKICLAW_JIRA_ENV_FILE"]]) ?? defaultJiraEnvRelativePath
        let envURL = workspaceResolvedURL(envPath, workspaceURL: workspaceURL)
        for (key, value) in jiraEnvironmentFile(at: envURL) where environment[key] == nil {
            environment[key] = value
        }
        return environment
    }

    static func jiraEnvironmentFilePath(workspacePath: String?) -> String {
        guard let workspacePath = workspacePath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !workspacePath.isEmpty else {
            return defaultJiraEnvRelativePath
        }
        let workspaceURL = URL(fileURLWithPath: expandedPath(workspacePath), isDirectory: true)
        let skillURL = workspaceURL.appendingPathComponent(jiraSkillRelativePath)
        let skillEnvironment = skillJiraConfiguration(from: skillURL)
        let envPath = firstNonEmpty([skillEnvironment["PIKICLAW_JIRA_ENV_FILE"]]) ?? defaultJiraEnvRelativePath
        return workspaceResolvedURL(envPath, workspaceURL: workspaceURL).path
    }

    private static func skillJiraConfiguration(from url: URL) -> [String: String] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
            return [:]
        }
        var environment: [String: String] = [:]
        for line in contents.components(separatedBy: .newlines) {
            for name in jiraSkillConfigurationNames {
                guard environment[name] == nil,
                      let value = skillValue(named: name, in: line) else {
                    continue
                }
                environment[name] = value
            }
        }
        return environment
    }

    private static func jiraEnvironmentFile(at url: URL) -> [String: String] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
            return [:]
        }
        let allowedNames = Set(jiraEnvironmentNames)
        var environment: [String: String] = [:]
        for line in contents.components(separatedBy: .newlines) {
            guard let assignment = environmentAssignment(in: line),
                  allowedNames.contains(assignment.key) else {
                continue
            }
            environment[assignment.key] = assignment.value
        }
        return environment
    }

    private static func environmentAssignment(in line: String) -> (key: String, value: String)? {
        var trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { return nil }
        if trimmed.hasPrefix("export ") {
            trimmed = String(trimmed.dropFirst("export ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let separator = trimmed.firstIndex(of: "=") else { return nil }
        let key = String(trimmed[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
        let value = String(trimmed[trimmed.index(after: separator)...])
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'")))
        guard !key.isEmpty, let normalizedValue = value.nilIfEmpty else {
            return nil
        }
        return (key, normalizedValue)
    }

    private static func skillValue(named name: String, in line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixes = [
            "- `\(name)`:",
            "`\(name)`:",
            "\(name)=",
            "\(name):"
        ]
        guard let prefix = prefixes.first(where: { trimmed.hasPrefix($0) }) else {
            return nil
        }
        return trimmed
            .dropFirst(prefix.count)
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "`\"'")))
            .nilIfEmpty
    }

    private static func workspaceResolvedURL(_ path: String, workspaceURL: URL) -> URL {
        let expanded = expandedPath(path)
        guard !expanded.hasPrefix("/") else {
            return URL(fileURLWithPath: expanded)
        }
        return workspaceURL.appendingPathComponent(expanded)
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
            return "Set RC_JIRA_READ_TOKEN in .pikiclaw/local/jira.env or shell, PIKICLAW_JIRA_BASE_URL plus a Jira token, PIKICLAW_JIRA_SYNC_COMMAND, or PIKICLAW_JIRA_TICKETS_FILE."
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
