import Foundation
import Testing
@testable import PikiclawCore

@Test func jsonNativeStorePersistsWorkspace() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    let store = JSONNativeStore(fileURL: file)
    let workspace = Workspace(name: "Temp", pathDisplay: "/tmp/temp", trustState: .trusted)

    try await store.saveWorkspace(workspace)

    let reloaded = JSONNativeStore(fileURL: file)
    let workspaces = try await reloaded.listWorkspaces()
    #expect(workspaces.contains(where: { $0.id == workspace.id && $0.pathDisplay == "/tmp/temp" }))
}

@Test func jsonNativeStorePersistsWorkspaceWorkflowConfig() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-workflow-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    let store = JSONNativeStore(fileURL: file)
    let workspace = Workspace(
        name: "Runtime",
        pathDisplay: "/tmp/runtime",
        trustState: .trusted,
        workflowConfig: WorkspaceWorkflowConfig(
            branchNamePattern: "{ticket}-{slug}",
            baseBranchName: "main",
            codingPromptTemplate: "Code {ticket} on {suggestedBranch}",
            reviewPromptTemplate: "Review {ticket}"
        )
    )

    try await store.saveWorkspace(workspace)

    let reloaded = JSONNativeStore(fileURL: file)
    let saved = try #require(try await reloaded.listWorkspaces().first { $0.id == workspace.id })
    #expect(saved.workflowConfig?.branchNamePattern == "{ticket}-{slug}")
    #expect(saved.workflowConfig?.baseBranchName == "main")
    #expect(saved.workflowConfig?.codingPromptTemplate == "Code {ticket} on {suggestedBranch}")
    #expect(saved.workflowConfig?.reviewPromptTemplate == "Review {ticket}")
}

@Test func jsonNativeStorePreservesPinnedRunWhenSavingOlderRunSnapshot() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-pinned-run-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    let store = JSONNativeStore(fileURL: file)
    let pinnedAt = Date(timeIntervalSince1970: 1_777_777)
    let pinnedRun = AgentRun(
        id: "run-pinned",
        workspaceId: "workspace-1",
        agentProfileId: "agent-1",
        state: .running,
        startedAt: pinnedAt,
        promptSnapshot: "Pinned chat",
        transcript: "Started",
        pinnedAt: pinnedAt
    )
    try await store.saveRun(pinnedRun)

    var olderSnapshot = pinnedRun
    olderSnapshot.transcript = "Still running"
    olderSnapshot.pinnedAt = nil
    try await store.saveRun(olderSnapshot)

    let savedRun = try #require(try await store.listRuns(workItemId: nil).first { $0.id == pinnedRun.id })
    #expect(savedRun.transcript == "Still running")
    #expect(savedRun.pinnedAt == pinnedAt)
    #expect(savedRun.isPinned)
}

@Test func jsonNativeStoreDefaultFileURLHonorsStateFileOverride() {
    let override = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-override-\(UUID().uuidString).json")
    let previous = getenv("PIKICLAW_MAC_NATIVE_STATE_FILE").map { String(cString: $0) }
    setenv("PIKICLAW_MAC_NATIVE_STATE_FILE", override.path, 1)
    defer {
        if let previous {
            setenv("PIKICLAW_MAC_NATIVE_STATE_FILE", previous, 1)
        } else {
            unsetenv("PIKICLAW_MAC_NATIVE_STATE_FILE")
        }
    }

    #expect(JSONNativeStore.defaultFileURL().path == override.path)
}

@Test func jsonNativeStoreMigratesAgentProfilesAndAvailability() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let oldSnapshot = NativeStoreSnapshot(
        agentProfiles: [
            AgentProfile(
                id: "agent-codex",
                kind: .codex,
                displayName: "Codex",
                executableName: "codex"
            )
        ],
        agentAvailabilityPolicyVersion: nil
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(oldSnapshot).write(to: file, options: .atomic)

    let store = JSONNativeStore(fileURL: file, seed: .preview())
    let migrated = try await store.loadSnapshot()
    let profiles = Dictionary(uniqueKeysWithValues: migrated.agentProfiles.map { ($0.kind, $0) })

    #expect(profiles[.codex]?.isEnabled == true)
    #expect(profiles[.cursor] != nil)
    #expect(profiles[.githubCopilot] != nil)
    #expect(profiles[.hermes] != nil)
    #expect(profiles[.gemini]?.isEnabled == false)
    #expect(profiles[.claude]?.isEnabled == false)
    #expect(migrated.agentAvailabilityPolicyVersion == 1)
}

@Test func jsonNativeStoreMigratesEnterpriseAlignmentGoalIntoExistingWorkspace() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-goal-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let workspace = Workspace(
        id: "workspace-existing",
        name: "Existing Workspace",
        pathDisplay: "/tmp/existing",
        trustState: .trusted
    )
    let project = Project(
        id: "project-existing",
        name: "Existing Project",
        workspaceIds: [workspace.id]
    )
    let oldSnapshot = NativeStoreSnapshot(
        projects: [project],
        workspaces: [workspace],
        workItems: [],
        artifacts: [],
        agentProfiles: [
            AgentProfile(
                id: "agent-codex",
                kind: .codex,
                displayName: "Codex",
                executableName: "codex"
            )
        ],
        agentAvailabilityPolicyVersion: nil
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(oldSnapshot).write(to: file, options: .atomic)

    let store = JSONNativeStore(fileURL: file, seed: .preview())
    let migrated = try await store.loadSnapshot()
    let goal = try #require(migrated.workItems.first { $0.id == AgentEnterpriseAlignment.goalWorkItemId })
    let artifact = try #require(migrated.artifacts.first { $0.workItemId == goal.id })

    #expect(goal.workspaceId == workspace.id)
    #expect(goal.projectId == project.id)
    #expect(goal.sourceType == .goal)
    #expect(artifact.workspaceId == workspace.id)
    #expect(artifact.status == .ready)
}

@Test func previewSeedDoesNotStartWithActiveRuns() {
    let seed = NativeAppSeed.preview()
    let activeRuns = seed.runs.filter { run in
        switch run.state {
        case .queued, .starting, .running, .waitingForUser, .cancelling:
            return true
        case .draft, .completed, .failed, .cancelled, .stale:
            return false
        }
    }

    #expect(activeRuns.isEmpty)
}
