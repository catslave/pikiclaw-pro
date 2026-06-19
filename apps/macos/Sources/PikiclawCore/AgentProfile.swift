import Foundation

public enum NativeAgentKind: String, Codable, Sendable, CaseIterable {
    case claude
    case codex
    case cursor
    case gemini
    case githubCopilot
    case hermes
    case customCLI
}

public struct AgentProfile: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var kind: NativeAgentKind
    public var displayName: String
    public var executableName: String
    public var defaultProviderProfileId: EntityID?
    public var defaultPermissionMode: PermissionMode
    public var isEnabled: Bool

    public init(
        id: EntityID = EntityID(),
        kind: NativeAgentKind,
        displayName: String,
        executableName: String,
        defaultProviderProfileId: EntityID? = nil,
        defaultPermissionMode: PermissionMode = .askBeforeEdit,
        isEnabled: Bool = true
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.executableName = executableName
        self.defaultProviderProfileId = defaultProviderProfileId
        self.defaultPermissionMode = defaultPermissionMode
        self.isEnabled = isEnabled
    }
}
