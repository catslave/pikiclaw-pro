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
