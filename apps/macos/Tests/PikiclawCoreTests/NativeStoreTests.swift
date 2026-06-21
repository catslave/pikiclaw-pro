import Foundation
import Testing
@testable import PikiclawCore

@Test func inMemoryStoreListsSeededCoreObjects() async throws {
    let store = InMemoryNativeStore(seed: .preview())

    let workspaces = try await store.listWorkspaces()
    let workItems = try await store.listWorkItems(workspaceId: workspaces.first?.id)
    let foundationItem = try #require(workItems.first { $0.id.rawValue == "workitem-native-v2" })
    let runs = try await store.listRuns(workItemId: foundationItem.id)
    let artifacts = try await store.listArtifacts(workItemId: nil)

    #expect(workspaces.count == 1)
    #expect(workItems.count == 2)
    #expect(runs.count == 1)
    #expect(artifacts.count == 2)
}

@Test func previewSeedIncludesUsingSuperpowersSkill() throws {
    let seed = NativeAppSeed.preview()
    let skill = try #require(seed.capabilities.first {
        $0.id.rawValue == "capability-skill-global-using-superpowers"
    })

    #expect(skill.kind == .skill)
    #expect(skill.name == "Using Superpowers")
    #expect(skill.scope == .global)
    #expect(skill.installState == "installed")
    #expect(skill.configState == "ready")
    #expect(skill.healthState == .healthy)
}

@Test func previewSeedIncludesEnterpriseAgentParityGoal() throws {
    let seed = NativeAppSeed.preview()
    let goal = try #require(seed.workItems.first { $0.id == AgentEnterpriseAlignment.goalWorkItemId })
    let artifact = try #require(seed.artifacts.first { $0.workItemId == goal.id })

    #expect(goal.sourceType == .goal)
    #expect(goal.state == .active)
    #expect(goal.priority == 0)
    #expect(goal.title.contains("Codex"))
    #expect(goal.title.contains("Claude"))
    #expect(goal.title.contains("Gemini"))
    #expect(goal.acceptanceCriteria.contains("Agent Studio shows parity gaps, readiness, and setup actions"))
    #expect(artifact.kind == .obsidianNote)
    #expect(artifact.uri.contains("mac-native-enterprise-agent-parity-goal.md"))
}

@Test func enterpriseAlignmentSummariesTrackFocusAgentReadiness() throws {
    let snapshot = NativeStoreSnapshot(seed: .preview())
    let parityRows = AgentEnterpriseAlignment.parityRows(snapshot: snapshot)
    let goalRow = try #require(parityRows.first { $0.key == .goalContinuity })
    let cells = Dictionary(uniqueKeysWithValues: goalRow.cells.map { ($0.agentKind, $0) })
    let readinessRows = AgentEnterpriseAlignment.readinessRows(snapshot: snapshot)
    let fleet = try #require(readinessRows.first { $0.key == .agentFleet })
    let goal = try #require(readinessRows.first { $0.key == .goalContinuity })

    #expect(goalRow.coverageLabel == "1/3")
    #expect(cells[.codex]?.mode == .native)
    #expect(cells[.claude]?.mode == .disabled)
    #expect(cells[.gemini]?.mode == .disabled)
    #expect(fleet.value == "1/3")
    #expect(fleet.attention == 2)
    #expect(goal.ready == 1)
}

@Test func enterpriseGoalMissionSummaryKeepsGoalVisibleForMissionControl() throws {
    let snapshot = NativeStoreSnapshot(seed: .preview())
    let summary = try #require(AgentEnterpriseAlignment.missionSummary(snapshot: snapshot))

    #expect(summary.workItemId == AgentEnterpriseAlignment.goalWorkItemId)
    #expect(summary.title.contains("Codex"))
    #expect(summary.title.contains("Claude"))
    #expect(summary.title.contains("Gemini"))
    #expect(summary.state == .active)
    #expect(summary.coverageLabel.contains("/"))
    #expect(summary.readyArtifactCount == 1)
    #expect(summary.totalArtifactCount == 1)
    #expect(summary.readinessReady > 0)
    #expect(summary.readinessAttention > 0)
    #expect(summary.capabilityReady > 0)
    #expect(summary.capabilityAttention > 0)
    #expect(!summary.nextAction.isEmpty)
}

@Test func enterpriseAlignmentTracksIssueWorkflowAcrossFocusAgents() throws {
    let profiles = [
        AgentProfile(id: "agent-codex", kind: .codex, displayName: "Codex", executableName: "codex"),
        AgentProfile(id: "agent-claude", kind: .claude, displayName: "Claude", executableName: "claude"),
        AgentProfile(id: "agent-gemini", kind: .gemini, displayName: "Gemini", executableName: "gemini")
    ]
    let capabilities = [
        Capability(kind: .cliTool, name: "Codex CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy),
        Capability(kind: .cliTool, name: "Claude CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy),
        Capability(kind: .cliTool, name: "Gemini CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy)
    ]
    let snapshot = NativeStoreSnapshot(seed: NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: capabilities,
        knowledgeCards: [],
        automations: [],
        agentProfiles: profiles,
        providerProfiles: []
    ))

    let rows = AgentEnterpriseAlignment.parityRows(snapshot: snapshot)
    let issueRow = try #require(rows.first { $0.key == AgentEnterpriseCapabilityKey.issueWorkflow })
    let modes: [NativeAgentKind: AgentEnterpriseCapabilityMode] = Dictionary(uniqueKeysWithValues: issueRow.cells.map { ($0.agentKind, $0.mode) })

    #expect(AgentEnterpriseCapabilityKey.allCases.contains(.issueWorkflow))
    #expect(AgentEnterpriseCapabilityKey.issueWorkflow.target.contains("paste-ready updates"))
    #expect(issueRow.coverageLabel == "3/3")
    #expect(issueRow.readyCount == 3)
    #expect(modes[NativeAgentKind.codex] == AgentEnterpriseCapabilityMode.native)
    #expect(modes[NativeAgentKind.claude] == AgentEnterpriseCapabilityMode.portable)
    #expect(modes[NativeAgentKind.gemini] == AgentEnterpriseCapabilityMode.portable)
    #expect(issueRow.nextAction.contains("Jira or issue intake"))
}

@Test func agentRunDecodesMissingSideChatFieldsAsStandalone() throws {
    let json = """
    {
      "id": { "rawValue": "run-1" },
      "workspaceId": { "rawValue": "workspace-1" },
      "agentProfileId": { "rawValue": "agent-1" },
      "permissionMode": "askBeforeEdit",
      "state": "completed",
      "promptSnapshot": "Hello",
      "contextRefs": [],
      "transcript": "Done"
    }
    """.data(using: .utf8)!

    let run = try JSONDecoder().decode(AgentRun.self, from: json)
    #expect(run.sideChatOfRunId == nil)
    #expect(run.sideChatRunIds.isEmpty)
}
