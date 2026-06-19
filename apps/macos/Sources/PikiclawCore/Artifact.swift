import Foundation

public enum ArtifactKind: String, Codable, Sendable, CaseIterable {
    case patch
    case pullRequest
    case markdownReport
    case obsidianNote
    case screenshot
    case document
    case traceBundle
    case generatedCode
    case reviewComment
    case verificationResult
    case commandOutputSummary
}

public enum ArtifactStatus: String, Codable, Sendable, CaseIterable {
    case draft
    case ready
    case verified
    case failed
    case superseded
}

public struct Artifact: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var workspaceId: EntityID
    public var workItemId: EntityID?
    public var runId: EntityID?
    public var kind: ArtifactKind
    public var title: String
    public var uri: String
    public var contentHash: String?
    public var status: ArtifactStatus
    public var provenance: String
    public var createdAt: Date
    public var verifiedAt: Date?
    public var sourceRefs: [SourceRef]

    public init(
        id: EntityID = EntityID(),
        workspaceId: EntityID,
        workItemId: EntityID? = nil,
        runId: EntityID? = nil,
        kind: ArtifactKind,
        title: String,
        uri: String,
        contentHash: String? = nil,
        status: ArtifactStatus = .draft,
        provenance: String,
        createdAt: Date = Date(),
        verifiedAt: Date? = nil,
        sourceRefs: [SourceRef] = []
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.workItemId = workItemId
        self.runId = runId
        self.kind = kind
        self.title = title
        self.uri = uri
        self.contentHash = contentHash
        self.status = status
        self.provenance = provenance
        self.createdAt = createdAt
        self.verifiedAt = verifiedAt
        self.sourceRefs = sourceRefs
    }
}

