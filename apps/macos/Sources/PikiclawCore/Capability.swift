import Foundation

public enum CapabilityKind: String, Codable, Sendable, CaseIterable {
    case skill
    case mcpServer
    case cliTool
    case connector
    case browserAutomation
    case localFileTool
    case externalService
    case builtInSystemTool
}

public enum CapabilityScope: String, Codable, Sendable, CaseIterable {
    case global
    case workspace
    case project
    case agent
    case team
}

public enum CapabilityTrustLevel: String, Codable, Sendable, CaseIterable {
    case unknown
    case trusted
    case restricted
    case quarantined
}

public enum CapabilityHealthState: String, Codable, Sendable, CaseIterable {
    case unknown
    case healthy
    case needsConfiguration
    case unavailable
    case failed
}

public struct Capability: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var kind: CapabilityKind
    public var name: String
    public var scope: CapabilityScope
    public var installState: String
    public var configState: String
    public var trustLevel: CapabilityTrustLevel
    public var permissionPolicy: PermissionMode
    public var healthState: CapabilityHealthState
    public var lastUsedAt: Date?

    public init(
        id: EntityID = EntityID(),
        kind: CapabilityKind,
        name: String,
        scope: CapabilityScope,
        installState: String = "unknown",
        configState: String = "unknown",
        trustLevel: CapabilityTrustLevel = .unknown,
        permissionPolicy: PermissionMode = .askBeforeEdit,
        healthState: CapabilityHealthState = .unknown,
        lastUsedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.scope = scope
        self.installState = installState
        self.configState = configState
        self.trustLevel = trustLevel
        self.permissionPolicy = permissionPolicy
        self.healthState = healthState
        self.lastUsedAt = lastUsedAt
    }
}

