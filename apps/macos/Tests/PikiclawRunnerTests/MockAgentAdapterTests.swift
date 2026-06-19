import Testing
@testable import PikiclawCore
@testable import PikiclawRunner

@Test func mockAgentAdapterEmitsRunningOutputAndCompletion() async throws {
    let workspaceId = EntityID("workspace")
    let run = AgentRun(
        workspaceId: workspaceId,
        agentProfileId: EntityID("agent"),
        promptSnapshot: "test"
    )
    let request = AgentLaunchRequest(workspacePath: "/tmp", prompt: "test", run: run)
    let adapter = MockAgentAdapter(output: ["one", "two"])

    var events: [RunnerEvent] = []
    for try await event in adapter.start(request) {
        events.append(event)
    }

    #expect(events.first == .stateChanged(.running))
    #expect(events.contains(.output("one")))
    #expect(events.last == .completed(exitCode: 0))
}

