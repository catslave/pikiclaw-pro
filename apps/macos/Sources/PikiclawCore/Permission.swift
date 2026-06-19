import Foundation

public enum PermissionMode: String, Codable, Sendable, CaseIterable {
    case readOnly
    case askBeforeEdit
    case autopilot
}

public enum CapabilityActionKind: String, Codable, Sendable, CaseIterable {
    case read
    case write
    case execute
    case network
    case externalWriteback
    case destructive
}

public enum PermissionDecision: String, Codable, Sendable, CaseIterable {
    case allow
    case ask
    case deny
}

public struct PermissionPolicy: Hashable, Codable, Sendable {
    public var mode: PermissionMode

    public init(mode: PermissionMode) {
        self.mode = mode
    }

    public func decision(for action: CapabilityActionKind) -> PermissionDecision {
        switch mode {
        case .readOnly:
            return action == .read ? .allow : .deny
        case .askBeforeEdit:
            return action == .read ? .allow : .ask
        case .autopilot:
            return action == .destructive || action == .externalWriteback ? .ask : .allow
        }
    }
}

public struct ToolCall: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var runId: EntityID
    public var capabilityId: EntityID
    public var name: String
    public var argumentsRedacted: String
    public var permissionDecision: PermissionDecision
    public var state: String
    public var startedAt: Date
    public var endedAt: Date?
    public var resultSummary: String?
    public var artifactRefs: [EntityID]

    public init(
        id: EntityID = EntityID(),
        runId: EntityID,
        capabilityId: EntityID,
        name: String,
        argumentsRedacted: String = "",
        permissionDecision: PermissionDecision,
        state: String = "pending",
        startedAt: Date = Date(),
        endedAt: Date? = nil,
        resultSummary: String? = nil,
        artifactRefs: [EntityID] = []
    ) {
        self.id = id
        self.runId = runId
        self.capabilityId = capabilityId
        self.name = name
        self.argumentsRedacted = argumentsRedacted
        self.permissionDecision = permissionDecision
        self.state = state
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.resultSummary = resultSummary
        self.artifactRefs = artifactRefs
    }
}

