import Foundation

public enum AuditEventKind: String, Codable, Sendable, CaseIterable {
    case permissionDecision
    case capabilityInvocation
    case credentialAccess
    case workspaceAccess
    case runStateChange
    case artifactCreated
    case automationStateChange
}

public struct AuditEvent: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var kind: AuditEventKind
    public var actor: String
    public var summary: String
    public var createdAt: Date
    public var runId: EntityID?
    public var workItemId: EntityID?
    public var workspaceId: EntityID?
    public var capabilityId: EntityID?

    public init(
        id: EntityID = EntityID(),
        kind: AuditEventKind,
        actor: String,
        summary: String,
        createdAt: Date = Date(),
        runId: EntityID? = nil,
        workItemId: EntityID? = nil,
        workspaceId: EntityID? = nil,
        capabilityId: EntityID? = nil
    ) {
        self.id = id
        self.kind = kind
        self.actor = actor
        self.summary = summary
        self.createdAt = createdAt
        self.runId = runId
        self.workItemId = workItemId
        self.workspaceId = workspaceId
        self.capabilityId = capabilityId
    }
}

