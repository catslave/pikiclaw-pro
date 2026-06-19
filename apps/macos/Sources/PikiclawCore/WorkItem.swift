import Foundation

public enum WorkItemState: String, Codable, Sendable, CaseIterable {
    case inbox
    case planned
    case active
    case blocked
    case review
    case done
    case cancelled
    case archived

    public func canTransition(to next: WorkItemState) -> Bool {
        if self == next { return true }
        switch (self, next) {
        case (.inbox, .planned), (.inbox, .active), (.inbox, .archived):
            return true
        case (.planned, .active), (.planned, .cancelled), (.planned, .archived):
            return true
        case (.active, .blocked), (.active, .review), (.active, .done), (.active, .cancelled):
            return true
        case (.blocked, .active), (.blocked, .cancelled), (.blocked, .archived):
            return true
        case (.review, .active), (.review, .done), (.review, .blocked):
            return true
        case (.done, .archived), (.cancelled, .archived):
            return true
        default:
            return false
        }
    }
}

public enum WorkItemSourceType: String, Codable, Sendable, CaseIterable {
    case manualPrompt
    case todo
    case jira
    case note
    case chatSelection
    case git
    case fileEvidence
    case scheduledAutomation
    case connectorImport
    case voiceDelegation
}

public struct SourceRef: Hashable, Codable, Sendable {
    public var kind: String
    public var label: String
    public var uri: String?

    public init(kind: String, label: String, uri: String? = nil) {
        self.kind = kind
        self.label = label
        self.uri = uri
    }
}

public struct WorkItem: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var workspaceId: EntityID
    public var projectId: EntityID?
    public var title: String
    public var description: String
    public var sourceType: WorkItemSourceType
    public var sourceRefs: [SourceRef]
    public var state: WorkItemState
    public var priority: Int
    public var acceptanceCriteria: [String]
    public var createdAt: Date
    public var updatedAt: Date
    public var dueAt: Date?
    public var externalRefs: [SourceRef]
    public var currentRunId: EntityID?

    public init(
        id: EntityID = EntityID(),
        workspaceId: EntityID,
        projectId: EntityID? = nil,
        title: String,
        description: String = "",
        sourceType: WorkItemSourceType = .manualPrompt,
        sourceRefs: [SourceRef] = [],
        state: WorkItemState = .inbox,
        priority: Int = 0,
        acceptanceCriteria: [String] = [],
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        dueAt: Date? = nil,
        externalRefs: [SourceRef] = [],
        currentRunId: EntityID? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.title = title
        self.description = description
        self.sourceType = sourceType
        self.sourceRefs = sourceRefs
        self.state = state
        self.priority = priority
        self.acceptanceCriteria = acceptanceCriteria
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.dueAt = dueAt
        self.externalRefs = externalRefs
        self.currentRunId = currentRunId
    }
}
