import Foundation

public struct NativeStoreSnapshot: Codable, Sendable {
    public var agentAvailabilityPolicyVersion: Int?
    public var projects: [Project]
    public var workspaces: [Workspace]
    public var workItems: [WorkItem]
    public var runs: [AgentRun]
    public var artifacts: [Artifact]
    public var capabilities: [Capability]
    public var knowledgeCards: [KnowledgeCard]
    public var automations: [Automation]
    public var agentProfiles: [AgentProfile]
    public var providerProfiles: [ProviderProfile]
    public var auditEvents: [AuditEvent]

    public init(
        projects: [Project] = [],
        workspaces: [Workspace] = [],
        workItems: [WorkItem] = [],
        runs: [AgentRun] = [],
        artifacts: [Artifact] = [],
        capabilities: [Capability] = [],
        knowledgeCards: [KnowledgeCard] = [],
        automations: [Automation] = [],
        agentProfiles: [AgentProfile] = [],
        providerProfiles: [ProviderProfile] = [],
        auditEvents: [AuditEvent] = [],
        agentAvailabilityPolicyVersion: Int? = 1
    ) {
        self.agentAvailabilityPolicyVersion = agentAvailabilityPolicyVersion
        self.projects = projects
        self.workspaces = workspaces
        self.workItems = workItems
        self.runs = runs
        self.artifacts = artifacts
        self.capabilities = capabilities
        self.knowledgeCards = knowledgeCards
        self.automations = automations
        self.agentProfiles = agentProfiles
        self.providerProfiles = providerProfiles
        self.auditEvents = auditEvents
    }

    public init(seed: NativeAppSeed) {
        self.init(
            projects: seed.projects,
            workspaces: seed.workspaces,
            workItems: seed.workItems,
            runs: seed.runs,
            artifacts: seed.artifacts,
            capabilities: seed.capabilities,
            knowledgeCards: seed.knowledgeCards,
            automations: seed.automations,
            agentProfiles: seed.agentProfiles,
            providerProfiles: seed.providerProfiles,
            auditEvents: []
        )
    }

    @discardableResult
    public mutating func applyAgentAvailabilityDefaultsIfNeeded() -> Bool {
        guard (agentAvailabilityPolicyVersion ?? 0) < 1 else { return false }
        let disabledByDefault: Set<NativeAgentKind> = [.claude, .gemini]
        for index in agentProfiles.indices where disabledByDefault.contains(agentProfiles[index].kind) {
            agentProfiles[index].isEnabled = false
        }
        agentAvailabilityPolicyVersion = 1
        return true
    }

    @discardableResult
    public mutating func mergeMissingAgentProfiles(from seed: NativeAppSeed) -> Bool {
        var existingKinds = Set(agentProfiles.map(\.kind))
        var changed = false
        for profile in seed.agentProfiles where !existingKinds.contains(profile.kind) {
            agentProfiles.append(profile)
            existingKinds.insert(profile.kind)
            changed = true
        }
        return changed
    }
}

public protocol WorkspaceStore: Sendable {
    func listWorkspaces() async throws -> [Workspace]
    func saveWorkspace(_ workspace: Workspace) async throws
}

public protocol WorkItemStore: Sendable {
    func listWorkItems(workspaceId: EntityID?) async throws -> [WorkItem]
    func saveWorkItem(_ item: WorkItem) async throws
}

public protocol RunStore: Sendable {
    func listRuns(workItemId: EntityID?) async throws -> [AgentRun]
    func saveRun(_ run: AgentRun) async throws
    func deleteRun(id: EntityID) async throws
}

public protocol ArtifactStore: Sendable {
    func listArtifacts(workItemId: EntityID?) async throws -> [Artifact]
    func saveArtifact(_ artifact: Artifact) async throws
}

public actor InMemoryNativeStore: WorkspaceStore, WorkItemStore, RunStore, ArtifactStore {
    private var workspaces: [EntityID: Workspace]
    private var workItems: [EntityID: WorkItem]
    private var runs: [EntityID: AgentRun]
    private var artifacts: [EntityID: Artifact]

    public init(seed: NativeAppSeed = .preview()) {
        self.workspaces = Dictionary(uniqueKeysWithValues: seed.workspaces.map { ($0.id, $0) })
        self.workItems = Dictionary(uniqueKeysWithValues: seed.workItems.map { ($0.id, $0) })
        self.runs = Dictionary(uniqueKeysWithValues: seed.runs.map { ($0.id, $0) })
        self.artifacts = Dictionary(uniqueKeysWithValues: seed.artifacts.map { ($0.id, $0) })
    }

    public func listWorkspaces() async throws -> [Workspace] {
        workspaces.values.sorted { $0.name < $1.name }
    }

    public func saveWorkspace(_ workspace: Workspace) async throws {
        workspaces[workspace.id] = workspace
    }

    public func listWorkItems(workspaceId: EntityID? = nil) async throws -> [WorkItem] {
        workItems.values
            .filter { workspaceId == nil || $0.workspaceId == workspaceId }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public func saveWorkItem(_ item: WorkItem) async throws {
        workItems[item.id] = item
    }

    public func listRuns(workItemId: EntityID? = nil) async throws -> [AgentRun] {
        runs.values
            .filter { workItemId == nil || $0.workItemId == workItemId }
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    public func saveRun(_ run: AgentRun) async throws {
        runs[run.id] = run
    }

    public func deleteRun(id: EntityID) async throws {
        runs.removeValue(forKey: id)
    }

    public func listArtifacts(workItemId: EntityID? = nil) async throws -> [Artifact] {
        artifacts.values
            .filter { workItemId == nil || $0.workItemId == workItemId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public func saveArtifact(_ artifact: Artifact) async throws {
        artifacts[artifact.id] = artifact
    }
}

public actor JSONNativeStore: WorkspaceStore, WorkItemStore, RunStore, ArtifactStore {
    public let fileURL: URL
    private var snapshot: NativeStoreSnapshot
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileURL: URL = JSONNativeStore.defaultFileURL(), seed: NativeAppSeed = .preview()) {
        self.fileURL = fileURL
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601

        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? decoder.decode(NativeStoreSnapshot.self, from: data) {
            var next = decoded
            let merged = next.mergeMissingAgentProfiles(from: seed)
            let migrated = next.applyAgentAvailabilityDefaultsIfNeeded()
            self.snapshot = next
            if merged || migrated {
                try? FileManager.default.createDirectory(
                    at: fileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                if let data = try? encoder.encode(next) {
                    try? data.write(to: fileURL, options: .atomic)
                }
            }
        } else {
            self.snapshot = NativeStoreSnapshot(seed: seed)
            try? FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if let data = try? encoder.encode(self.snapshot) {
                try? data.write(to: fileURL, options: .atomic)
            }
        }
    }

    public static func defaultFileURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return appSupport
            .appendingPathComponent("PikiclawMacNative", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    public func loadSnapshot() async throws -> NativeStoreSnapshot {
        snapshot
    }

    public func replaceSnapshot(_ next: NativeStoreSnapshot) async throws {
        snapshot = next
        try persist()
    }

    public func appendAuditEvent(_ event: AuditEvent) async throws {
        snapshot.auditEvents.append(event)
        try persist()
    }

    public func listWorkspaces() async throws -> [Workspace] {
        snapshot.workspaces.sorted { $0.name < $1.name }
    }

    public func saveWorkspace(_ workspace: Workspace) async throws {
        upsert(workspace, into: &snapshot.workspaces)
        try persist()
    }

    public func listWorkItems(workspaceId: EntityID? = nil) async throws -> [WorkItem] {
        snapshot.workItems
            .filter { workspaceId == nil || $0.workspaceId == workspaceId }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public func saveWorkItem(_ item: WorkItem) async throws {
        upsert(item, into: &snapshot.workItems)
        try persist()
    }

    public func listRuns(workItemId: EntityID? = nil) async throws -> [AgentRun] {
        snapshot.runs
            .filter { workItemId == nil || $0.workItemId == workItemId }
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    public func saveRun(_ run: AgentRun) async throws {
        upsert(run, into: &snapshot.runs)
        try persist()
    }

    public func deleteRun(id: EntityID) async throws {
        snapshot.runs.removeAll { $0.id == id }
        snapshot.workItems = snapshot.workItems.map { item in
            var next = item
            if next.currentRunId == id {
                next.currentRunId = nil
            }
            return next
        }
        try persist()
    }

    public func listArtifacts(workItemId: EntityID? = nil) async throws -> [Artifact] {
        snapshot.artifacts
            .filter { workItemId == nil || $0.workItemId == workItemId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public func saveArtifact(_ artifact: Artifact) async throws {
        upsert(artifact, into: &snapshot.artifacts)
        try persist()
    }

    private func persist() throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try encoder.encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
    }

    private func upsert<T: Identifiable>(_ value: T, into values: inout [T]) where T.ID: Equatable {
        if let index = values.firstIndex(where: { $0.id == value.id }) {
            values[index] = value
        } else {
            values.append(value)
        }
    }
}
