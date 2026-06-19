import Foundation

public enum WorkspaceTrustState: String, Codable, Sendable, CaseIterable {
    case unknown
    case trusted
    case restricted
    case revoked
}

public struct Workspace: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var name: String
    public var pathDisplay: String
    public var kind: String
    public var createdAt: Date
    public var lastOpenedAt: Date?
    public var gitRemote: String?
    public var currentBranch: String?
    public var trustState: WorkspaceTrustState
    public var instructionsRef: EntityID?
    public var defaultAgentProfileId: EntityID?

    public init(
        id: EntityID = EntityID(),
        name: String,
        pathDisplay: String,
        kind: String = "repo",
        createdAt: Date = Date(),
        lastOpenedAt: Date? = nil,
        gitRemote: String? = nil,
        currentBranch: String? = nil,
        trustState: WorkspaceTrustState = .unknown,
        instructionsRef: EntityID? = nil,
        defaultAgentProfileId: EntityID? = nil
    ) {
        self.id = id
        self.name = name
        self.pathDisplay = pathDisplay
        self.kind = kind
        self.createdAt = createdAt
        self.lastOpenedAt = lastOpenedAt
        self.gitRemote = gitRemote
        self.currentBranch = currentBranch
        self.trustState = trustState
        self.instructionsRef = instructionsRef
        self.defaultAgentProfileId = defaultAgentProfileId
    }
}

