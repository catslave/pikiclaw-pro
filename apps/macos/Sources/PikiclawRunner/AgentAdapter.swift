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
        [
            "exec",
            "--color", "never",
            "--sandbox", codexSandbox(for: request.run.permissionMode),
            "--ask-for-approval", "never",
            "-C", request.workspacePath,
            request.prompt
        ]
    }

    public static func geminiArguments(for request: AgentLaunchRequest) -> [String] {
        [
            "--prompt", request.prompt,
            "--approval-mode", geminiApprovalMode(for: request.run.permissionMode)
        ]
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

    private static func geminiApprovalMode(for mode: PermissionMode) -> String {
        switch mode {
        case .readOnly:
            return "plan"
        case .askBeforeEdit:
            return "default"
        case .autopilot:
            return "yolo"
        }
    }
}
