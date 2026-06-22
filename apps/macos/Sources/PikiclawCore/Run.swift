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
    case draft
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

public struct AgentRunMessage: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var role: RunRole
    public var content: String
    public var createdAt: Date

    public init(
        id: EntityID = EntityID(),
        role: RunRole,
        content: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

public struct AgentRunQueuedMessage: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var content: String
    public var permissionMode: PermissionMode?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: EntityID = EntityID(),
        content: String,
        permissionMode: PermissionMode? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.permissionMode = permissionMode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
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
    public var sideChatOfRunId: EntityID?
    public var sideChatRunIds: [EntityID]
    public var promptSnapshot: String
    public var contextRefs: [ContextRef]
    public var messages: [AgentRunMessage]
    public var queuedMessages: [AgentRunQueuedMessage]
    public var transcript: String
    public var readAt: Date?
    public var pinnedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id
        case workItemId
        case workspaceId
        case agentProfileId
        case teamProfileId
        case permissionMode
        case modelProfileId
        case state
        case startedAt
        case endedAt
        case nativeSessionRef
        case handoverFromRunId
        case sideChatOfRunId
        case sideChatRunIds
        case promptSnapshot
        case contextRefs
        case messages
        case queuedMessages
        case transcript
        case readAt
        case pinnedAt
    }

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
        sideChatOfRunId: EntityID? = nil,
        sideChatRunIds: [EntityID] = [],
        promptSnapshot: String,
        contextRefs: [ContextRef] = [],
        messages: [AgentRunMessage] = [],
        queuedMessages: [AgentRunQueuedMessage],
        transcript: String = "",
        pinnedAt: Date? = nil
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
        self.sideChatOfRunId = sideChatOfRunId
        self.sideChatRunIds = sideChatRunIds
        self.promptSnapshot = promptSnapshot
        self.contextRefs = contextRefs
        self.messages = messages
        self.queuedMessages = queuedMessages
        self.transcript = transcript
        self.readAt = nil
        self.pinnedAt = pinnedAt
    }

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
        sideChatOfRunId: EntityID? = nil,
        sideChatRunIds: [EntityID] = [],
        promptSnapshot: String,
        contextRefs: [ContextRef] = [],
        messages: [AgentRunMessage] = [],
        transcript: String = "",
        pinnedAt: Date? = nil
    ) {
        self.init(
            id: id,
            workItemId: workItemId,
            workspaceId: workspaceId,
            agentProfileId: agentProfileId,
            teamProfileId: teamProfileId,
            permissionMode: permissionMode,
            modelProfileId: modelProfileId,
            state: state,
            startedAt: startedAt,
            endedAt: endedAt,
            nativeSessionRef: nativeSessionRef,
            handoverFromRunId: handoverFromRunId,
            sideChatOfRunId: sideChatOfRunId,
            sideChatRunIds: sideChatRunIds,
            promptSnapshot: promptSnapshot,
            contextRefs: contextRefs,
            messages: messages,
            queuedMessages: [],
            transcript: transcript,
            pinnedAt: pinnedAt
        )
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(EntityID.self, forKey: .id)
        self.workItemId = try container.decodeIfPresent(EntityID.self, forKey: .workItemId)
        self.workspaceId = try container.decode(EntityID.self, forKey: .workspaceId)
        self.agentProfileId = try container.decode(EntityID.self, forKey: .agentProfileId)
        self.teamProfileId = try container.decodeIfPresent(EntityID.self, forKey: .teamProfileId)
        self.permissionMode = try container.decode(PermissionMode.self, forKey: .permissionMode)
        self.modelProfileId = try container.decodeIfPresent(EntityID.self, forKey: .modelProfileId)
        self.state = try container.decode(RunState.self, forKey: .state)
        self.startedAt = try container.decodeIfPresent(Date.self, forKey: .startedAt)
        self.endedAt = try container.decodeIfPresent(Date.self, forKey: .endedAt)
        self.nativeSessionRef = try container.decodeIfPresent(String.self, forKey: .nativeSessionRef)
        self.handoverFromRunId = try container.decodeIfPresent(EntityID.self, forKey: .handoverFromRunId)
        self.sideChatOfRunId = try container.decodeIfPresent(EntityID.self, forKey: .sideChatOfRunId)
        self.sideChatRunIds = try container.decodeIfPresent([EntityID].self, forKey: .sideChatRunIds) ?? []
        self.promptSnapshot = try container.decode(String.self, forKey: .promptSnapshot)
        self.contextRefs = try container.decodeIfPresent([ContextRef].self, forKey: .contextRefs) ?? []
        self.messages = try container.decodeIfPresent([AgentRunMessage].self, forKey: .messages) ?? []
        self.queuedMessages = try container.decodeIfPresent([AgentRunQueuedMessage].self, forKey: .queuedMessages) ?? []
        self.transcript = try container.decodeIfPresent(String.self, forKey: .transcript) ?? ""
        self.readAt = try container.decodeIfPresent(Date.self, forKey: .readAt)
        self.pinnedAt = try container.decodeIfPresent(Date.self, forKey: .pinnedAt)
    }
}

public extension AgentRun {
    var isCompletedUnread: Bool {
        state == .completed && readAt == nil
    }

    var isPinned: Bool {
        pinnedAt != nil
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
