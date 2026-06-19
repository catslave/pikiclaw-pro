import Foundation

public enum AutomationKind: String, Codable, Sendable, CaseIterable {
    case scheduledPrompt
    case jiraSync
    case pullRequestWatcher
    case repoWatcher
    case dailyDigest
    case staleRunRecovery
    case knowledgeCandidateReview
    case notificationFollowUp
}

public enum AutomationState: String, Codable, Sendable, CaseIterable {
    case enabled
    case paused
    case running
    case failed
    case disabled
}

public struct Automation: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var workspaceId: EntityID?
    public var kind: AutomationKind
    public var name: String
    public var state: AutomationState
    public var scheduleDescription: String?
    public var lastRunAt: Date?
    public var nextRunAt: Date?

    public init(
        id: EntityID = EntityID(),
        workspaceId: EntityID? = nil,
        kind: AutomationKind,
        name: String,
        state: AutomationState = .paused,
        scheduleDescription: String? = nil,
        lastRunAt: Date? = nil,
        nextRunAt: Date? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.kind = kind
        self.name = name
        self.state = state
        self.scheduleDescription = scheduleDescription
        self.lastRunAt = lastRunAt
        self.nextRunAt = nextRunAt
    }
}

