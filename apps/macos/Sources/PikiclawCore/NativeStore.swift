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
    public var jiraSync: JiraSyncState?

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
        agentAvailabilityPolicyVersion: Int? = 1,
        jiraSync: JiraSyncState? = nil
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
        self.jiraSync = jiraSync
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
            auditEvents: seed.auditEvents,
            jiraSync: JiraSyncState()
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

    @discardableResult
    public mutating func mergeMissingCapabilities(from seed: NativeAppSeed) -> Bool {
        var existingIds = Set(capabilities.map(\.id))
        var changed = false
        for capability in seed.capabilities where !existingIds.contains(capability.id) {
            capabilities.append(capability)
            existingIds.insert(capability.id)
            changed = true
        }
        return changed
    }

    @discardableResult
    public mutating func ensureEnterpriseAlignmentGoal(fallbackSeed seed: NativeAppSeed) -> Bool {
        guard !workItems.contains(where: { $0.id == AgentEnterpriseAlignment.goalWorkItemId }) else {
            return false
        }
        guard let workspaceId = workspaces.first?.id ?? seed.workspaces.first?.id else {
            return false
        }
        let projectId = projects.first { project in
            project.workspaceIds.contains(workspaceId)
        }?.id ?? seed.projects.first?.id
        workItems.append(AgentEnterpriseAlignment.goalWorkItem(
            workspaceId: workspaceId,
            projectId: projectId
        ))
        return true
    }

    @discardableResult
    public mutating func ensureEnterpriseAlignmentGoalArtifact(fallbackSeed seed: NativeAppSeed) -> Bool {
        let artifactId = EntityID("artifact-enterprise-agent-parity-goal")
        guard !artifacts.contains(where: { $0.id == artifactId }) else {
            return false
        }
        let goal = workItems.first(where: { $0.id == AgentEnterpriseAlignment.goalWorkItemId })
        guard let workspaceId = goal?.workspaceId ?? workspaces.first?.id ?? seed.workspaces.first?.id else {
            return false
        }
        artifacts.append(Artifact(
            id: artifactId,
            workspaceId: workspaceId,
            workItemId: AgentEnterpriseAlignment.goalWorkItemId,
            kind: .obsidianNote,
            title: "Enterprise Agent Parity Goal",
            uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/mac-native-enterprise-agent-parity-goal.md",
            status: .ready,
            provenance: "Goal tracker"
        ))
        return true
    }

    @discardableResult
    public mutating func applyJiraTickets(
        _ tickets: [JiraTicket],
        workspaceId: EntityID,
        projectId: EntityID? = nil
    ) -> JiraTicketApplySummary {
        var created = 0
        var updated = 0
        var unchanged = 0
        var selectedWorkItemId: EntityID?
        let syncedKeys = Set(tickets.map { $0.key.uppercased() })
        let protectedWorkItemIds = Set(runs.compactMap(\.workItemId) + artifacts.compactMap(\.workItemId))

        if !syncedKeys.isEmpty {
            workItems.removeAll { item in
                guard item.sourceType == .jira, !protectedWorkItemIds.contains(item.id) else { return false }
                guard let key = nativeStoreJiraKey(for: item) else { return true }
                return !syncedKeys.contains(key)
            }
        }

        for ticket in tickets {
            let normalizedKey = ticket.key.uppercased()
            if let index = workItems.firstIndex(where: {
                $0.jira?.key.uppercased() == normalizedKey
                    || $0.sourceRefs.contains(where: { $0.kind == "jira" && $0.label.uppercased() == normalizedKey })
            }) {
                let current = workItems[index]
                let next = current.updatedFromJiraTicket(ticket)
                selectedWorkItemId = selectedWorkItemId ?? next.id
                var comparableNext = next
                comparableNext.updatedAt = current.updatedAt
                if comparableNext == current {
                    unchanged += 1
                } else {
                    updated += 1
                    workItems[index] = next
                }
            } else {
                let item = WorkItem.fromJiraTicket(ticket, workspaceId: workspaceId, projectId: projectId)
                selectedWorkItemId = selectedWorkItemId ?? item.id
                created += 1
                workItems.append(item)
            }
        }

        workItems.sort { $0.updatedAt > $1.updatedAt }
        return JiraTicketApplySummary(
            created: created,
            updated: updated,
            unchanged: unchanged,
            selectedWorkItemId: selectedWorkItemId
        )
    }
}

private func nativeStoreJiraKey(for item: WorkItem) -> String? {
    if let key = item.jira?.key.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
        return key.uppercased()
    }
    let label = item.sourceRefs.first { $0.kind == "jira" }?
        .label
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return label.isEmpty ? nil : label.uppercased()
}

public extension WorkItem {
    static func fromJiraTicket(_ ticket: JiraTicket, workspaceId: EntityID, projectId: EntityID? = nil) -> WorkItem {
        WorkItem(
            id: EntityID("jira-\(ticket.key.lowercased())"),
            workspaceId: workspaceId,
            projectId: projectId,
            title: "\(ticket.key): \(ticket.title)",
            description: jiraDescription(for: ticket),
            sourceType: .jira,
            sourceRefs: [
                SourceRef(kind: "jira", label: ticket.key, uri: ticket.url),
                SourceRef(kind: "jira-status", label: ticket.status ?? "Unknown")
            ],
            state: state(forJiraStatus: ticket.status),
            priority: priorityRank(ticket.priority),
            acceptanceCriteria: [
                "Understand Jira scope and acceptance boundary",
                "Run the implementation or investigation from this Work Item",
                "Capture durable outputs before Jira write-back"
            ],
            externalRefs: ticket.url.map { [SourceRef(kind: "jira", label: "Open \(ticket.key)", uri: $0)] } ?? [],
            jira: JiraWorkItemFields(ticket: ticket)
        )
    }

    func updatedFromJiraTicket(_ ticket: JiraTicket) -> WorkItem {
        var next = self
        next.title = "\(ticket.key): \(ticket.title)"
        next.description = Self.jiraDescription(for: ticket)
        next.sourceType = .jira
        next.sourceRefs = [
            SourceRef(kind: "jira", label: ticket.key, uri: ticket.url),
            SourceRef(kind: "jira-status", label: ticket.status ?? "Unknown")
        ]
        if let url = ticket.url {
            next.externalRefs = [SourceRef(kind: "jira", label: "Open \(ticket.key)", uri: url)]
        }
        next.priority = Self.priorityRank(ticket.priority)
        next.jira = JiraWorkItemFields(ticket: ticket)
        if next.state == .inbox || next.state == .planned {
            next.state = Self.state(forJiraStatus: ticket.status)
        }
        next.updatedAt = Date()
        return next
    }

    private static func jiraDescription(for ticket: JiraTicket) -> String {
        [
            "Jira: \(ticket.key)",
            ticket.status.map { "Status: \($0)" },
            ticket.sprint.map { "Sprint: \($0)" },
            ticket.assignee.map { "Assignee: \($0)" },
            "",
            ticket.description.isEmpty ? ticket.title : ticket.description
        ]
            .compactMap { $0 }
            .joined(separator: "\n")
    }

    private static func state(forJiraStatus status: String?) -> WorkItemState {
        let value = (status ?? "").lowercased()
        if value.contains("cancel") { return .cancelled }
        if value.contains("done") || value.contains("closed") || value.contains("resolved") { return .done }
        if value.contains("block") { return .blocked }
        if value.contains("review") || value.contains("qa") { return .review }
        if value.contains("progress") || value.contains("doing") { return .active }
        return .planned
    }

    private static func priorityRank(_ priority: String?) -> Int {
        let value = (priority ?? "").lowercased()
        if value.contains("blocker") || value.contains("highest") || value.contains("critical") { return 0 }
        if value.contains("high") { return 1 }
        if value.contains("low") { return 3 }
        return 2
    }
}

private extension JiraWorkItemFields {
    init(ticket: JiraTicket) {
        self.init(
            key: ticket.key,
            url: ticket.url,
            status: ticket.status,
            assignee: ticket.assignee,
            priority: ticket.priority,
            issueType: ticket.issueType,
            sprint: ticket.sprint,
            remoteUpdatedAt: ticket.updatedAt
        )
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
        var next = run
        if next.pinnedAt == nil {
            next.pinnedAt = runs[run.id]?.pinnedAt
        }
        runs[run.id] = next
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
            let mergedCapabilities = next.mergeMissingCapabilities(from: seed)
            let mergedGoalWorkItems = next.ensureEnterpriseAlignmentGoal(fallbackSeed: seed)
            let mergedGoalArtifacts = next.ensureEnterpriseAlignmentGoalArtifact(fallbackSeed: seed)
            let migrated = next.applyAgentAvailabilityDefaultsIfNeeded()
            self.snapshot = next
            if merged || mergedCapabilities || mergedGoalWorkItems || mergedGoalArtifacts || migrated {
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
        if let override = ProcessInfo.processInfo.environment["PIKICLAW_MAC_NATIVE_STATE_FILE"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
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
        var next = run
        if next.pinnedAt == nil,
           let existing = snapshot.runs.first(where: { $0.id == run.id })?.pinnedAt {
            next.pinnedAt = existing
        }
        upsert(next, into: &snapshot.runs)
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
