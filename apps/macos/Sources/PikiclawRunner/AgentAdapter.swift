import Foundation
import PikiclawCore

public enum AgentKind: String, Codable, Sendable, CaseIterable {
    case claude
    case codex
    case cursor
    case gemini
    case githubCopilot
    case hermes
    case customCLI
}

public struct AgentDescriptor: Hashable, Codable, Sendable {
    public var id: EntityID
    public var kind: AgentKind
    public var displayName: String
    public var executableName: String

    public init(id: EntityID = EntityID(), kind: AgentKind, displayName: String, executableName: String) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.executableName = executableName
    }
}

public struct AgentDetection: Hashable, Codable, Sendable {
    public var isAvailable: Bool
    public var executablePath: String?
    public var authState: String
    public var detail: String

    public init(isAvailable: Bool, executablePath: String? = nil, authState: String = "unknown", detail: String = "") {
        self.isAvailable = isAvailable
        self.executablePath = executablePath
        self.authState = authState
        self.detail = detail
    }
}

public struct AgentLaunchRequest: Hashable, Codable, Sendable {
    public var workspacePath: String
    public var prompt: String
    public var run: AgentRun
    public var environment: [String: String]
    public var arguments: [String]
    public var stdinText: String?

    public init(
        workspacePath: String,
        prompt: String,
        run: AgentRun,
        environment: [String: String] = [:],
        arguments: [String] = [],
        stdinText: String? = nil
    ) {
        self.workspacePath = workspacePath
        self.prompt = prompt
        self.run = run
        self.environment = environment
        self.arguments = arguments
        self.stdinText = stdinText
    }
}

public enum RunnerEvent: Hashable, Codable, Sendable {
    case stateChanged(RunState)
    case output(String)
    case toolCallStarted(String)
    case artifactCreated(EntityID)
    case completed(exitCode: Int32)
    case failed(String)
}

public protocol AgentAdapter: Sendable {
    var descriptor: AgentDescriptor { get }

    func detect() async -> AgentDetection
    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error>
}

public enum NativeAgentCommandBuilder {
    public static func codexArguments(for request: AgentLaunchRequest) -> [String] {
        if let nativeSessionRef = request.run.nativeSessionRef?.trimmingCharacters(in: .whitespacesAndNewlines),
           !nativeSessionRef.isEmpty {
            return [
                "--ask-for-approval", "never",
                "--sandbox", codexSandbox(for: request.run.permissionMode),
                "-C", request.workspacePath,
                "exec",
                "resume",
                "--json",
                nativeSessionRef,
                "-"
            ]
        }

        return [
            "--ask-for-approval", "never",
            "exec",
            "--json",
            "--color", "never",
            "--sandbox", codexSandbox(for: request.run.permissionMode),
            "-C", request.workspacePath,
            "-"
        ]
    }

    public static func geminiArguments(for request: AgentLaunchRequest) -> [String] {
        [
            "--prompt", request.prompt,
            "--approval-mode", geminiApprovalMode(for: request.run.permissionMode)
        ]
    }

    public static func claudeArguments(for request: AgentLaunchRequest) -> [String] {
        [
            "--print",
            "--output-format", "text",
            "--permission-mode", claudePermissionMode(for: request.run.permissionMode),
            request.prompt
        ]
    }

    public static func cursorArguments(for request: AgentLaunchRequest) -> [String] {
        var arguments = [
            "--print",
            "--output-format", "text",
            "--trust",
            "--workspace", request.workspacePath
        ]

        switch request.run.permissionMode {
        case .readOnly:
            arguments.append(contentsOf: ["--mode", "plan"])
        case .askBeforeEdit:
            break
        case .autopilot:
            arguments.append("--yolo")
        }

        arguments.append(request.prompt)
        return arguments
    }

    public static func githubCopilotArguments(for request: AgentLaunchRequest) -> [String] {
        var arguments = [
            "copilot",
            "--no-color",
            "--no-ask-user",
            "--output-format", "text",
            "-C", request.workspacePath
        ]

        switch request.run.permissionMode {
        case .readOnly:
            arguments.append("--plan")
        case .askBeforeEdit:
            break
        case .autopilot:
            arguments.append("--yolo")
        }

        arguments.append(contentsOf: ["-p", request.prompt])
        return arguments
    }

    public static func hermesArguments(for request: AgentLaunchRequest) -> [String] {
        var arguments = [
            "chat",
            "--quiet",
            "--source", "pikiclaw-native",
            "--query", request.prompt
        ]

        if request.run.permissionMode == .autopilot {
            arguments.append("--yolo")
        }

        return arguments
    }

    public static func customCLIArguments(for request: AgentLaunchRequest) -> [String] {
        [request.prompt]
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

    private static func claudePermissionMode(for mode: PermissionMode) -> String {
        switch mode {
        case .readOnly:
            return "plan"
        case .askBeforeEdit:
            return "acceptEdits"
        case .autopilot:
            return "bypassPermissions"
        }
    }

    private static func geminiApprovalMode(for mode: PermissionMode) -> String {
        switch mode {
        case .readOnly:
            return "plan"
        case .askBeforeEdit:
            return "auto_edit"
        case .autopilot:
            return "yolo"
        }
    }
}
