import Foundation

public enum KnowledgeScope: String, Codable, Sendable, CaseIterable {
    case global
    case workspace
    case project
    case agent
}

public struct KnowledgeCard: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var scope: KnowledgeScope
    public var title: String
    public var body: String
    public var sourceRefs: [SourceRef]
    public var artifactRefs: [EntityID]
    public var tags: [String]
    public var confidence: Double
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: EntityID = EntityID(),
        scope: KnowledgeScope,
        title: String,
        body: String,
        sourceRefs: [SourceRef],
        artifactRefs: [EntityID] = [],
        tags: [String] = [],
        confidence: Double = 1.0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.scope = scope
        self.title = title
        self.body = body
        self.sourceRefs = sourceRefs
        self.artifactRefs = artifactRefs
        self.tags = tags
        self.confidence = confidence
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

