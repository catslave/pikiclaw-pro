import Foundation

public enum RunState: String, Codable, Sendable, CaseIterable {
    case queued
    case starting
    case running
    case waitingForUser
    case cancelling
    case completed
    case failed
    case cancelled
    case stale
}

public enum RunRole: String, Codable, Sendable, CaseIterable {
    case user
    case assistant
    case system
    case tool
}

public struct ContextRef: Hashable, Codable, Sendable {
    public var kind: String
    public var id: EntityID?
    public var label: String
    public var uri: String?

    public init(kind: String, id: EntityID? = nil, label: String, uri: String? = nil) {
        self.kind = kind
        self.id = id
        self.label = label
        self.uri = uri
    }
}

public struct AgentRun: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var workItemId: EntityID?
    public var workspaceId: EntityID
    public var agentProfileId: EntityID
    public var teamProfileId: EntityID?
    public var permissionMode: PermissionMode
    public var modelProfileId: EntityID?
    public var state: RunState
    public var startedAt: Date?
    public var endedAt: Date?
    public var nativeSessionRef: String?
    public var handoverFromRunId: EntityID?
    public var promptSnapshot: String
    public var contextRefs: [ContextRef]
    public var transcript: String

    public init(
        id: EntityID = EntityID(),
        workItemId: EntityID? = nil,
        workspaceId: EntityID,
        agentProfileId: EntityID,
        teamProfileId: EntityID? = nil,
        permissionMode: PermissionMode = .askBeforeEdit,
        modelProfileId: EntityID? = nil,
        state: RunState = .queued,
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        nativeSessionRef: String? = nil,
        handoverFromRunId: EntityID? = nil,
        promptSnapshot: String,
        contextRefs: [ContextRef] = [],
        transcript: String = ""
    ) {
        self.id = id
        self.workItemId = workItemId
        self.workspaceId = workspaceId
        self.agentProfileId = agentProfileId
        self.teamProfileId = teamProfileId
        self.permissionMode = permissionMode
        self.modelProfileId = modelProfileId
        self.state = state
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.nativeSessionRef = nativeSessionRef
        self.handoverFromRunId = handoverFromRunId
        self.promptSnapshot = promptSnapshot
        self.contextRefs = contextRefs
        self.transcript = transcript
    }
}

public struct Turn: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var runId: EntityID
    public var role: RunRole
    public var content: String
    public var createdAt: Date
    public var sequence: Int
    public var nativeEventRef: String?
    public var attachments: [ContextRef]

    public init(
        id: EntityID = EntityID(),
        runId: EntityID,
        role: RunRole,
        content: String,
        createdAt: Date = Date(),
        sequence: Int,
        nativeEventRef: String? = nil,
        attachments: [ContextRef] = []
    ) {
        self.id = id
        self.runId = runId
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.sequence = sequence
        self.nativeEventRef = nativeEventRef
        self.attachments = attachments
    }
}
