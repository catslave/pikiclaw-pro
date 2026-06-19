import Foundation

public struct Project: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var name: String
    public var workspaceIds: [EntityID]
    public var createdAt: Date
    public var lastOpenedAt: Date?
    public var defaultAgentProfileId: EntityID?

    public init(
        id: EntityID = EntityID(),
        name: String,
        workspaceIds: [EntityID],
        createdAt: Date = Date(),
        lastOpenedAt: Date? = nil,
        defaultAgentProfileId: EntityID? = nil
    ) {
        self.id = id
        self.name = name
        self.workspaceIds = workspaceIds
        self.createdAt = createdAt
        self.lastOpenedAt = lastOpenedAt
        self.defaultAgentProfileId = defaultAgentProfileId
    }
}

